/** 规则集对比实验：找出哪种规则组合真正能区分 ST。 */
import { getStockList, getMarketYear, type MarketRow } from "../src/datasource/market.ts";

const [list, y23, y24, y25] = await Promise.all([getStockList(), getMarketYear(2023), getMarketYear(2024), getMarketYear(2025)]);
const codes = new Set(list.map((s) => s.code));

type Predicate = (a: MarketRow | undefined, b: MarketRow | undefined, c: MarketRow | undefined) => boolean;

const RULES: Record<string, Predicate> = {
  "净资产为负": (a, b, c) => !!c && c.totalParentEquity !== null && c.totalParentEquity < 0,
  "当期亏损": (a, b, c) => !!c && c.parentNetProfit !== null && c.parentNetProfit < 0,
  "连续两年亏损": (a, b, c) => !!b && !!c && (b.parentNetProfit ?? 0) < 0 && (c.parentNetProfit ?? 0) < 0,
  "连续三年亏损": (a, b, c) => !!a && !!b && !!c && (a.parentNetProfit ?? 0) < 0 && (b.parentNetProfit ?? 0) < 0 && (c.parentNetProfit ?? 0) < 0,
  "经营现金流连负": (a, b, c) => !!b && !!c && (b.netcashOperate ?? 0) < 0 && (c.netcashOperate ?? 0) < 0,
  "高商誉>50%": (a, b, c) => !!c && (c.goodwill ?? 0) > 0 && (c.totalParentEquity ?? 0) > 0 && ((c.goodwill! / c.totalParentEquity!) * 100) > 50,
  "净利现价比<0.3": (a, b, c) => {
    const ys = [a, b, c]; let cash = 0, prof = 0;
    for (const y of ys) { if (!y || y.netcashOperate === null || y.parentNetProfit === null) return false; cash += y.netcashOperate; prof += y.parentNetProfit; }
    return prof > 0 && cash / prof < 0.3;
  },
  "营收连续下滑": (a, b, c) => !!a && !!b && !!c && (a.totalRevenue ?? 0) > (b.totalRevenue ?? 0) && (b.totalRevenue ?? 0) > (c.totalRevenue ?? 0),
};

const rows: { code: string; name: string; st: boolean; y: [MarketRow | undefined, MarketRow | undefined, MarketRow | undefined] }[] = [];
for (const s of list) {
  if (!codes.has(s.code)) continue;
  const c = y25.get(s.code);
  if (!c || c.totalParentEquity === null) continue;
  rows.push({ code: s.code, name: s.name, st: s.isSt, y: [y23.get(s.code), y24.get(s.code), c] });
}
const stRows = rows.filter((r) => r.st);
const normRows = rows.filter((r) => !r.st);

console.log(`样本：ST ${stRows.length} 家，正常 ${normRows.length} 家\n`);
console.log("规则".padEnd(20), "ST命中".padStart(9), "正常误报".padStart(10), "提升倍数".padStart(9));

const results: { name: string; lift: number; stHit: number }[] = [];
for (const [name, pred] of Object.entries(RULES)) {
  const stHit = stRows.filter((r) => pred(r.y[0], r.y[1], r.y[2])).length / stRows.length;
  const normHit = normRows.filter((r) => pred(r.y[0], r.y[1], r.y[2])).length / normRows.length;
  const lift = normHit === 0 ? Infinity : stHit / normHit;
  results.push({ name, lift, stHit });
  console.log(
    name.padEnd(20),
    (stHit * 100).toFixed(1).padStart(8) + "%",
    (normHit * 100).toFixed(1).padStart(9) + "%",
    lift.toFixed(2).padStart(8) + "x",
  );
}

console.log("\n按提升倍数排序:");
for (const r of results.sort((a, b) => b.lift - a.lift)) {
  if (!Number.isFinite(r.lift)) continue;
  console.log(`  ${r.name.padEnd(20)} ${r.lift.toFixed(2)}x  (ST 命中 ${(r.stHit * 100).toFixed(1)}%)`);
}
