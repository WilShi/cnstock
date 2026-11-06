#!/usr/bin/env node
/**
 * cnstock command line interface.
 *
 * Every command prints human-readable text by default; pass --json for the raw
 * value so output can be piped into jq or another program.
 */

import {
  getFinancials, getKline, getQuote, searchStocks,
  type FinancialPeriod, type Kline, type Quote,
} from "./datasource/index.ts";
import { computeTtm, formatMoney, formatPct, impliedGrowth, pickValuationModel, runDcf, runPbRoe, type DcfAssumptions } from "./analysis/valuation.ts";
import { buildReport } from "./analysis/report.ts";

const VERSION = "0.1.0";

const USAGE = [
  "cnstock — 中国股票数据命令行工具（免 API Key）",
  "",
  "用法：cnstock <命令> [参数] [选项]",
  "",
  "命令：",
  "  search <关键词>          按代码、名称或拼音检索标的",
  "  quote <代码>             实时行情与估值指标",
  "  kline <代码>             日 K 线",
  "  financials <代码>        财报摘要与 TTM 折算",
  "  value <代码>             估值测算（自动选模型）",
  "  report <代码>            完整 Markdown 研究简报",
  "",
  "选项：",
  "  --json                   输出 JSON",
  "  --days <n>               K 线条数，默认 60",
  "  --periods <n>            财报期数，默认 8",
  "  --growth <r>             净利润增速假设，默认 0.08",
  "  --discount <r>           折现率假设，默认 0.10",
  "  --terminal <r>           永续增速假设，默认 0.025",
  "  -h, --help               显示帮助",
  "  -v, --version            显示版本",
  "",
  "示例：",
  "  cnstock quote 600519",
  "  cnstock report 600519 > 茅台.md",
  "  cnstock quote 600519 --json | jq .price",
].join("\n");

interface Args {
  command: string;
  positional: string[];
  json: boolean;
  numbers: Record<string, number>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const numbers: Record<string, number> = {};
  let json = false;
  const numericFlags = new Set(["days", "periods", "growth", "discount", "terminal"]);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { json = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (numericFlags.has(key) && next !== undefined) {
        const n = Number(next);
        if (!Number.isFinite(n)) throw new Error(`参数 --${key} 需要一个数字，收到 "${next}"`);
        numbers[key] = n;
        i++;
      }
      continue;
    }
    positional.push(a);
  }
  return { command: positional.shift() ?? "", positional, json, numbers };
}

/** Visual width of a string, counting CJK characters as two columns. */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}

function pad(s: string, target: number): string {
  const gap = target - width(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

function table(rows: [string, string][]): string {
  const w = Math.max(...rows.map(([k]) => width(k)));
  return rows.map(([k, v]) => `  ${pad(k, w)}  ${v}`).join("\n");
}

function printQuote(q: Quote): void {
  console.log(`${q.name}（${q.code}）`);
  console.log(table([
    ["最新价", `${q.price} 元`],
    ["涨跌幅", `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%（${q.change >= 0 ? "+" : ""}${q.change}）`],
    ["今开/最高/最低", `${q.open} / ${q.high} / ${q.low}`],
    ["总市值", formatMoney(q.totalMarketCap, "亿元")],
    ["PE(TTM)", q.peTtm === null ? "—" : q.peTtm.toFixed(2)],
    ["PB", q.pb === null ? "—" : q.pb.toFixed(2)],
    ["换手率", q.turnoverRate === null ? "—" : `${q.turnoverRate}%`],
    ["行业", q.industry ?? "（当前数据源未返回）"],
    ["数据源", q.source],
  ]));
}

function printKline(code: string, bars: Kline[]): void {
  if (!bars.length) { console.log("未取到 K 线数据"); return; }
  const first = bars[0], last = bars[bars.length - 1];
  const pct = ((last.close - first.close) / first.close) * 100;
  console.log(`${code} 最近 ${bars.length} 个交易日`);
  console.log(table([
    ["区间", `${first.date} 至 ${last.date}`],
    ["区间涨跌", `${pct.toFixed(2)}%`],
    ["区间最高", String(Math.max(...bars.map((b) => b.high)))],
    ["区间最低", String(Math.min(...bars.map((b) => b.low)))],
    ["最新收盘", String(last.close)],
  ]));
  console.log("");
  console.log("  日期          开盘      收盘      最高      最低      成交量");
  for (const b of bars.slice(-10)) {
    console.log(`  ${b.date}  ${pad(String(b.open), 8)}  ${pad(String(b.close), 8)}  ${pad(String(b.high), 8)}  ${pad(String(b.low), 8)}  ${b.volume}`);
  }
}

function printFinancials(code: string, periods: FinancialPeriod[]): void {
  const latest = periods[0];
  const ttmNp = computeTtm(periods, "netProfit");
  const ttmRev = computeTtm(periods, "revenue");
  console.log(`${code} 财报摘要`);
  console.log(table([
    ["最新报告期", `${latest?.periodLabel ?? "—"}（${latest?.reportDate ?? "—"}）`],
    ["TTM 营业收入", formatMoney(ttmRev.value, "亿元")],
    ["TTM 归母净利", formatMoney(ttmNp.value, "亿元")],
    ["TTM 口径", ttmNp.basis],
    ["ROE", formatPct(latest?.roe ?? null)],
    ["毛利率", formatPct(latest?.grossMargin ?? null)],
    ["营收同比", formatPct(latest?.revenueYoY ?? null)],
    ["净利同比", formatPct(latest?.netProfitYoY ?? null)],
  ]));
  console.log("");
  console.log("  报告期        营收(亿)   净利(亿)   ROE      毛利率    营收同比  净利同比");
  for (const p of periods) {
    console.log(`  ${p.reportDate}  ${pad(p.revenue === null ? "—" : (p.revenue / 1e8).toFixed(1), 9)}  ${pad(p.netProfit === null ? "—" : (p.netProfit / 1e8).toFixed(1), 8)}  ${pad(formatPct(p.roe), 7)}  ${pad(formatPct(p.grossMargin), 8)}  ${pad(formatPct(p.revenueYoY), 8)}  ${formatPct(p.netProfitYoY)}`);
  }
}

async function runValue(code: string, numbers: Record<string, number>): Promise<void> {
  const assumptions: DcfAssumptions = {
    growthRate: numbers.growth ?? 0.08,
    terminalGrowth: numbers.terminal ?? 0.025,
    discountRate: numbers.discount ?? 0.10,
    years: Math.max(1, Math.round(numbers.years ?? 5)),
  };
  const [q, fins] = await Promise.all([getQuote(code), getFinancials(code, 8)]);
  const shares = q.totalMarketCap && q.price ? q.totalMarketCap / q.price : null;
  const ttmNp = computeTtm(fins, "netProfit");
  const latest = fins[0];
  const choice = pickValuationModel(q.name, q.industry, ttmNp.value);

  console.log(`${q.name}（${q.code}）现价 ${q.price} 元`);
  console.log(`  模型：${choice.model} —— ${choice.reason}`);

  if (choice.model === "dcf") {
    const dcf = runDcf(ttmNp.value, shares, assumptions);
    if (dcf.fairValuePerShare !== null) {
      const upside = ((dcf.fairValuePerShare - q.price) / q.price) * 100;
      console.log(`  内在价值：${dcf.fairValuePerShare.toFixed(2)} 元（${upside >= 0 ? "低估" : "高估"} ${Math.abs(upside).toFixed(1)}%）`);
      const ig = impliedGrowth(q.price, ttmNp.value, shares, assumptions);
      if (ig !== null) console.log(`  当前股价隐含 5 年增速：${(ig * 100).toFixed(1)}%`);
    } else {
      console.log(`  ${dcf.basis}`);
    }
    console.log(`  假设：增速 ${(assumptions.growthRate * 100).toFixed(1)}% / 永续 ${(assumptions.terminalGrowth * 100).toFixed(1)}% / 折现 ${(assumptions.discountRate * 100).toFixed(1)}%`);
  } else if (choice.model === "pb-roe") {
    const pb = runPbRoe(latest?.bps ?? null, latest?.roe ?? null, {
      requiredReturn: assumptions.discountRate,
      sustainableGrowth: assumptions.terminalGrowth,
    });
    if (pb.fairValuePerShare !== null) {
      const upside = ((pb.fairValuePerShare - q.price) / q.price) * 100;
      console.log(`  合理每股价值：${pb.fairValuePerShare.toFixed(2)} 元（${upside >= 0 ? "低估" : "高估"} ${Math.abs(upside).toFixed(1)}%）`);
    }
    console.log(`  ${pb.basis}`);
  } else {
    console.log(`  ${choice.reason}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const { command, positional, json, numbers } = parseArgs(argv);

  if (!command || command === "-h" || command === "--help" || command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === "-v" || command === "--version" || command === "version") {
    console.log(VERSION);
    return 0;
  }

  const target = positional[0];
  const needCode = () => {
    if (!target) throw new Error(`${command} 需要一个股票代码，例如 cnstock ${command} 600519`);
    return target;
  };

  switch (command) {
    case "search": {
      const hits = await searchStocks(target ?? "", 10);
      if (json) { console.log(JSON.stringify(hits, null, 2)); return 0; }
      if (!hits.length) { console.log("未找到匹配的标的"); return 0; }
      console.log("  代码    名称        市场");
      for (const h of hits) console.log(`  ${pad(h.code, 6)}  ${pad(h.name, 10)}  ${h.market}`);
      return 0;
    }
    case "quote": {
      const q = await getQuote(needCode());
      if (json) { console.log(JSON.stringify(q, null, 2)); return 0; }
      printQuote(q);
      return 0;
    }
    case "kline": {
      const bars = await getKline(needCode(), Math.min(Math.max(numbers.days ?? 60, 5), 250));
      if (json) { console.log(JSON.stringify(bars, null, 2)); return 0; }
      printKline(needCode(), bars);
      return 0;
    }
    case "financials": {
      const periods = await getFinancials(needCode(), numbers.periods ?? 8);
      if (json) { console.log(JSON.stringify(periods, null, 2)); return 0; }
      printFinancials(needCode(), periods);
      return 0;
    }
    case "value": {
      const code = needCode();
      if (json) {
        const q = await getQuote(code);
        const fins = await getFinancials(code, 8);
        console.log(JSON.stringify({ quote: q, financials: fins }, null, 2));
        return 0;
      }
      await runValue(code, numbers);
      return 0;
    }
    case "report": {
      const code = needCode();
      const [q, fins, bars] = await Promise.all([getQuote(code), getFinancials(code, 8), getKline(code, 120).catch(() => [] as Kline[])]);
      const md = buildReport({
        quote: q, financials: fins, klines: bars,
        shares: q.totalMarketCap && q.price ? q.totalMarketCap / q.price : null,
        assumptions: {
          growthRate: numbers.growth ?? 0.08,
          terminalGrowth: numbers.terminal ?? 0.025,
          discountRate: numbers.discount ?? 0.10,
          years: 5,
        },
      });
      if (json) { console.log(JSON.stringify({ code, markdown: md }, null, 2)); return 0; }
      console.log(md);
      return 0;
    }
    default:
      console.error(`未知命令：${command}\n`);
      console.log(USAGE);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`错误：${(err as Error).message}`);
    process.exit(1);
  },
);
