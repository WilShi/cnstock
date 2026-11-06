/**
 * ST 验证：用交易所已经认定的问题公司（ST/*ST）作为验证集，
 * 检查红旗规则能否把它们与正常公司区分开。
 *
 * 这是比手工挑 10 个样本更有说服力的检验 —— 样本量 313 家 vs 5250 家。
 */

import { getStockList, getMarketYear, type MarketRow } from "../src/datasource/market.ts";

interface Flags {
  negativeEquity: boolean;
  goodwillHigh: boolean;
  cashConversionBad: boolean;
  cashAndDebt: boolean;
  any: boolean;
  critical: number;
}

function evaluate(y23: MarketRow | undefined, y24: MarketRow | undefined, y25: MarketRow | undefined): Flags {
  const f: Flags = { negativeEquity: false, goodwillHigh: false, cashConversionBad: false, cashAndDebt: false, any: false, critical: 0 };
  const cur = y25;
  if (!cur) return f;

  // 净资产为负
  if (cur.totalParentEquity !== null && cur.totalParentEquity < 0) { f.negativeEquity = true; f.critical++; }

  // 商誉占净资产
  if (cur.goodwill !== null && cur.goodwill > 0 && cur.totalParentEquity !== null && cur.totalParentEquity > 0) {
    const r = (cur.goodwill / cur.totalParentEquity) * 100;
    if (r > 30) f.goodwillHigh = true;
    if (r > 50) f.critical++;
  }

  // 净利现价比（3 年累计）
  const years = [y23, y24, y25];
  let cash = 0, profit = 0, ok = true;
  for (const y of years) {
    if (!y || y.netcashOperate === null || y.parentNetProfit === null) { ok = false; break; }
    cash += y.netcashOperate; profit += y.parentNetProfit;
  }
  if (ok && profit > 0) {
    const ratio = cash / profit;
    if (ratio < 0.7) f.cashConversionBad = true;
    if (ratio < 0.3) f.critical++;
  }

  // 存贷双高
  if (cur.totalAssets && cur.monetaryFunds !== null && cur.interestDebt !== null) {
    const c = (cur.monetaryFunds / cur.totalAssets) * 100;
    const d = (cur.interestDebt / cur.totalAssets) * 100;
    if (c > 15 && d > 15) f.cashAndDebt = true;
  }

  f.any = f.negativeEquity || f.goodwillHigh || f.cashConversionBad || f.cashAndDebt;
  return f;
}

console.time("全市场数据");
const [list, y23, y24, y25] = await Promise.all([
  getStockList(),
  getMarketYear(2023),
  getMarketYear(2024),
  getMarketYear(2025),
]);
console.timeEnd("全市场数据");

const codes = new Set(list.map((s) => s.code));
const stat = {
  stTotal: 0, stFlagged: 0, stCritical: 0,
  normalTotal: 0, normalFlagged: 0, normalCritical: 0,
};
const stHits: string[] = [];
const stMiss: string[] = [];
const normalHits: { code: string; name: string; f: Flags }[] = [];

for (const s of list) {
  if (!codes.has(s.code)) continue;
  const y25row = y25.get(s.code);
  // 只评估有 2025 年报数据的公司，避免把新上市/停牌算成正常
  if (!y25row || y25row.totalParentEquity === null) continue;

  const f = evaluate(y23.get(s.code), y24.get(s.code), y25row);
  if (s.isSt) {
    stat.stTotal++;
    if (f.any) { stat.stFlagged++; stHits.push(`${s.code} ${s.name}`); }
    else stMiss.push(`${s.code} ${s.name}`);
    if (f.critical > 0) stat.stCritical++;
  } else {
    stat.normalTotal++;
    if (f.any) { stat.normalFlagged++; normalHits.push({ code: s.code, name: s.name, f }); }
    if (f.critical > 0) stat.normalCritical++;
  }
}

const pct = (a: number, b: number) => b ? ((a / b) * 100).toFixed(1) + "%" : "—";

console.log("");
console.log("========== ST 验证结果 ==========");
console.log(`ST / *ST 公司      : ${stat.stTotal} 家，被标记 ${stat.stFlagged} 家（${pct(stat.stFlagged, stat.stTotal)}）`);
console.log(`正常公司           : ${stat.normalTotal} 家，被标记 ${stat.normalFlagged} 家（${pct(stat.normalFlagged, stat.normalTotal)}）`);
console.log("");
console.log(`命中率（ST 被标记）  : ${pct(stat.stFlagged, stat.stTotal)}`);
console.log(`误报率（正常被标记） : ${pct(stat.normalFlagged, stat.normalTotal)}`);
console.log(`提升倍数            : ${((stat.stFlagged / stat.stTotal) / (stat.normalFlagged / stat.normalTotal)).toFixed(2)}x`);
console.log("");
console.log("ST 命中样例:", stHits.slice(0, 8).join(" | "));
console.log("ST 未命中样例:", stMiss.slice(0, 8).join(" | "));
console.log("");
const top = normalHits.filter((x) => x.f.critical > 0).slice(0, 10);
console.log(`正常公司中被判「重大」的 ${stat.normalCritical} 家，前 10：`);
for (const t of top) {
  const parts = [];
  if (t.f.negativeEquity) parts.push("净资产为负");
  if (t.f.goodwillHigh) parts.push("高商誉");
  if (t.f.cashConversionBad) parts.push("现金流背离");
  if (t.f.cashAndDebt) parts.push("存贷双高");
  console.log(`  ${t.code} ${t.name}  ${parts.join(" / ")}`);
}
