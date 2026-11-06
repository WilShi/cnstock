/** 组合规则实验：在单条规则的基础上找最优组合。 */
import { getStockList, getMarketYear, type MarketRow } from "../src/datasource/market.ts";

const [list, y22, y23, y24, y25] = await Promise.all([
  getStockList(), getMarketYear(2022), getMarketYear(2023), getMarketYear(2024), getMarketYear(2025),
]);
const codes = new Set(list.map((s) => s.code));

type Y = [MarketRow | undefined, MarketRow | undefined, MarketRow | undefined, MarketRow | undefined];

const SIGNALS = {
  negEquity: (y: Y) => !!y[3] && (y[3].totalParentEquity ?? 0) < 0,
  loss2y: (y: Y) => !!y[2] && !!y[3] && (y[2].parentNetProfit ?? 0) < 0 && (y[3].parentNetProfit ?? 0) < 0,
  ocfNeg2y: (y: Y) => !!y[2] && !!y[3] && (y[2].netcashOperate ?? 0) < 0 && (y[3].netcashOperate ?? 0) < 0,
  highGoodwill: (y: Y) => !!y[3] && (y[3].goodwill ?? 0) > 0 && (y[3].totalParentEquity ?? 0) > 0 && ((y[3].goodwill! / y[3].totalParentEquity!) * 100) > 30,
  revenueDown2: (y: Y) => !!y[1] && !!y[2] && !!y[3] && (y[1].totalRevenue ?? 0) > (y[2].totalRevenue ?? 0) && (y[2].totalRevenue ?? 0) > (y[3].totalRevenue ?? 0),
};

const rows: { st: boolean; y: Y }[] = [];
for (const s of list) {
  if (!codes.has(s.code)) continue;
  const c = y25.get(s.code);
  if (!c || c.totalParentEquity === null) continue;
  rows.push({ st: s.isSt, y: [y22.get(s.code), y23.get(s.code), y24.get(s.code), c] });
}
const stRows = rows.filter((r) => r.st);
const normRows = rows.filter((r) => !r.st);

function evaluate(combo: (keyof typeof SIGNALS)[]) {
  const hit = (r: { y: Y }) => combo.some((k) => SIGNALS[k](r.y));
  const stHit = stRows.filter(hit).length / stRows.length;
  const normHit = normRows.filter(hit).length / normRows.length;
  return { stHit, normHit, lift: normHit === 0 ? Infinity : stHit / normHit, flagged: normRows.filter(hit).length };
}

const COMBOS: { name: string; combo: (keyof typeof SIGNALS)[] }[] = [
  { name: "仅净资产为负", combo: ["negEquity"] },
  { name: "净资产+连续亏损", combo: ["negEquity", "loss2y"] },
  { name: "净资产+亏损+现金流", combo: ["negEquity", "loss2y", "ocfNeg2y"] },
  { name: "净资产+亏损+现金流+商誉", combo: ["negEquity", "loss2y", "ocfNeg2y", "highGoodwill"] },
  { name: "全部五条", combo: ["negEquity", "loss2y", "ocfNeg2y", "highGoodwill", "revenueDown2"] },
  { name: "亏损+现金流+商誉(不含净资产)", combo: ["loss2y", "ocfNeg2y", "highGoodwill"] },
  { name: "亏损+商誉", combo: ["loss2y", "highGoodwill"] },
];

console.log(`样本：ST ${stRows.length} 家，正常 ${normRows.length} 家\n`);
console.log("组合".padEnd(30), "ST命中".padStart(9), "正常误报".padStart(10), "提升".padStart(8), "标记数".padStart(8));
for (const { name, combo } of COMBOS) {
  const r = evaluate(combo);
  console.log(
    name.padEnd(30),
    (r.stHit * 100).toFixed(1).padStart(8) + "%",
    (r.normHit * 100).toFixed(1).padStart(9) + "%",
    (Number.isFinite(r.lift) ? r.lift.toFixed(2) : "inf").padStart(7) + "x",
    String(r.flagged).padStart(8),
  );
}
