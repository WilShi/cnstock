/**
 * Markdown research report generator.
 *
 * The report is assembled from data that was already fetched and computed, so
 * every number is traceable. Disclaimers are part of the output rather than an
 * afterthought: this is a research aid, not investment advice.
 */

import type { FinancialPeriod, Kline, Quote } from "../datasource/types.ts";
import { computeTtm, formatMoney, formatPct, pickValuationModel, runDcf, runPbRoe, impliedGrowth, type DcfAssumptions } from "./valuation.ts";

export interface ReportInput {
  quote: Quote;
  financials: FinancialPeriod[];
  klines: Kline[];
  shares: number | null;
  assumptions: DcfAssumptions;
}

const pctOf = (v: number | null) => (v === null ? "—" : formatPct(v));

function trendArrow(v: number | null): string {
  if (v === null) return "—";
  return v > 0 ? `↑ ${v.toFixed(2)}%` : v < 0 ? `↓ ${Math.abs(v).toFixed(2)}%` : "持平";
}

/** Build a full Chinese-language research note as Markdown. */
export function buildReport(input: ReportInput): string {
  const { quote: q, financials, klines, shares, assumptions } = input;
  const latest = financials[0];
  const ttmNp = computeTtm(financials, "netProfit");
  const ttmRev = computeTtm(financials, "revenue");
  const choice = pickValuationModel(q.name, q.industry, ttmNp.value);

  const lines: string[] = [];
  lines.push(`# ${q.name}（${q.code}）研究简报`);
  lines.push("");
  lines.push(`> 数据来源：${q.source}｜生成时间：${new Date().toISOString().slice(0, 16).replace("T", " ")}｜本简报由 dsh-astock 自动生成，不构成投资建议`);
  lines.push("");

  lines.push("## 一、行情与估值快照");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("| --- | --- |");
  lines.push(`| 最新价 | ${q.price} 元 |`);
  lines.push(`| 涨跌幅 | ${q.changePct.toFixed(2)}%（${q.change >= 0 ? "+" : ""}${q.change}） |`);
  lines.push(`| 总市值 | ${formatMoney(q.totalMarketCap, "亿元")} |`);
  lines.push(`| PE(TTM) | ${q.peTtm === null ? "—" : q.peTtm.toFixed(2)} |`);
  lines.push(`| PB | ${q.pb === null ? "—" : q.pb.toFixed(2)} |`);
  lines.push(`| 每股净资产 | ${latest?.bps?.toFixed(2) ?? "—"} 元 |`);
  lines.push(`| 所属行业 | ${q.industry ?? "（当前数据源未返回）"} |`);
  lines.push("");

  lines.push("## 二、经营质量");
  lines.push("");
  lines.push(`- **TTM 营业收入**：${formatMoney(ttmRev.value, "亿元")}（${ttmRev.basis}）`);
  lines.push(`- **TTM 归母净利润**：${formatMoney(ttmNp.value, "亿元")}（${ttmNp.basis}）`);
  lines.push(`- **最新报告期**：${latest?.periodLabel ?? "—"}（${latest?.reportDate ?? "—"}）`);
  lines.push(`- **ROE（加权）**：${pctOf(latest?.roe ?? null)}｜**毛利率**：${pctOf(latest?.grossMargin ?? null)}`);
  lines.push(`- **营收同比**：${trendArrow(latest?.revenueYoY ?? null)}｜**净利同比**：${trendArrow(latest?.netProfitYoY ?? null)}`);
  lines.push("");

  if (financials.length > 1) {
    lines.push("### 近几期趋势");
    lines.push("");
    lines.push("| 报告期 | 营收(亿) | 净利(亿) | ROE | 毛利率 | 营收同比 | 净利同比 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const p of financials.slice(0, 6)) {
      lines.push(
        `| ${p.reportDate} | ${p.revenue === null ? "—" : (p.revenue / 1e8).toFixed(1)} | ${p.netProfit === null ? "—" : (p.netProfit / 1e8).toFixed(1)} | ${pctOf(p.roe)} | ${pctOf(p.grossMargin)} | ${pctOf(p.revenueYoY)} | ${pctOf(p.netProfitYoY)} |`
      );
    }
    lines.push("");
  }

  lines.push("## 三、估值");
  lines.push("");
  lines.push(`模型选择：**${choice.model === "dcf" ? "两阶段 DCF" : choice.model === "pb-roe" ? "PB-ROE 合理估值" : "不适用"}** —— ${choice.reason}`);
  lines.push("");
  if (choice.model === "dcf") {
    const dcf = runDcf(ttmNp.value, shares, assumptions);
    if (dcf.fairValuePerShare !== null) {
      const upside = ((dcf.fairValuePerShare - q.price) / q.price) * 100;
      lines.push(`- DCF 每股内在价值：**${dcf.fairValuePerShare.toFixed(2)} 元**（现价 ${q.price} 元，${upside >= 0 ? "低估" : "高估"} ${Math.abs(upside).toFixed(1)}%）`);
      lines.push(`- 假设：前 ${assumptions.years} 年增速 ${(assumptions.growthRate * 100).toFixed(1)}%，永续 ${(assumptions.terminalGrowth * 100).toFixed(1)}%，折现率 ${(assumptions.discountRate * 100).toFixed(1)}%`);
      const ig = impliedGrowth(q.price, ttmNp.value, shares, assumptions);
      if (ig !== null) lines.push(`- 当前股价隐含的 5 年增速：**${(ig * 100).toFixed(1)}%**（高于该值则说明市场预期更乐观）`);
    } else {
      lines.push(`- ${dcf.basis}`);
    }
  } else if (choice.model === "pb-roe") {
    const pb = runPbRoe(latest?.bps ?? null, latest?.roe ?? null, { requiredReturn: assumptions.discountRate, sustainableGrowth: assumptions.terminalGrowth });
    if (pb.fairValuePerShare !== null) {
      const upside = ((pb.fairValuePerShare - q.price) / q.price) * 100;
      lines.push(`- 合理每股价值：**${pb.fairValuePerShare.toFixed(2)} 元**（现价 ${q.price} 元，${upside >= 0 ? "低估" : "高估"} ${Math.abs(upside).toFixed(1)}%）`);
      lines.push(`- ${pb.basis}`);
    } else {
      lines.push(`- ${pb.basis}`);
    }
  } else {
    lines.push(`- ${choice.reason}，建议改用 PS、重置成本或并购价值等口径。`);
  }
  lines.push("");

  if (klines.length >= 20) {
    lines.push("## 四、价格走势");
    lines.push("");
    const first = klines[0];
    const last = klines[klines.length - 1];
    const windowPct = ((last.close - first.close) / first.close) * 100;
    const highs = Math.max(...klines.map((k) => k.high));
    const lows = Math.min(...klines.map((k) => k.low));
    lines.push(`- 区间：${first.date} 至 ${last.date}（${klines.length} 个交易日）`);
    lines.push(`- 区间涨跌：**${windowPct.toFixed(2)}%**`);
    lines.push(`- 区间最高 / 最低：${highs.toFixed(2)} / ${lows.toFixed(2)}`);
    lines.push("");
  }

  lines.push("## 五、风险提示");
  lines.push("");
  lines.push("- 估值模型基于公开数据与简化假设，对增速、折现率的选取高度敏感，结果仅供研究参考；");
  lines.push("- 净利润并不等于自由现金流，资本开支重的行业其 DCF 结果会偏乐观；");
  lines.push("- 行情与财务数据来自第三方公开接口，可能存在延迟、缺失或口径差异；");
  lines.push("- 本简报不构成任何投资建议，据此操作风险自担。");
  lines.push("");

  return lines.join("\n");
}

export type { Quote, FinancialPeriod, Kline };
