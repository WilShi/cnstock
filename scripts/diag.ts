import { getStatements } from "../src/datasource/statements.ts";
import { interestBearingDebt } from "../src/analysis/redflags.ts";

for (const [code, name] of [["600079", "人福医药"], ["000636", "风华高科"]]) {
  const s = await getStatements(code, 5);
  console.log(`\n##### ${name}（${code}）为什么没触发`);
  const f = (v: number | null) => v === null ? "—" : (v / 1e8).toFixed(2) + "亿";
  for (let i = 0; i < Math.min(3, s.balances.length); i++) {
    const b = s.balances[i], inc = s.incomes[i], cf = s.cashflows[i];
    const gw = b.goodwill ?? 0, eq = b.totalParentEquity ?? 0;
    const cash = b.monetaryFunds ?? 0, ta = b.totalAssets ?? 0;
    console.log(`  ${b.reportDate}  商誉/净资产=${eq > 0 ? ((gw/eq)*100).toFixed(1) : "—"}%  现金/总资产=${ta > 0 ? ((cash/ta)*100).toFixed(1) : "—"}%  有息/总资产=${ta > 0 ? ((interestBearingDebt(b)/ta)*100).toFixed(1) : "—"}%`);
    console.log(`       净利 ${f(inc?.parentNetProfit ?? null)}  经营现金流 ${f(cf?.netcashOperate ?? null)}`);
  }
  const cashSum = s.cashflows.slice(0,3).reduce((a,c)=>a+(c.netcashOperate??0),0);
  const profSum = s.incomes.slice(0,3).reduce((a,c)=>a+(c.parentNetProfit??0),0);
  console.log(`  3年累计：净利 ${f(profSum)}  经营现金流 ${f(cashSum)}  比值 ${profSum>0?(cashSum/profSum).toFixed(2):"—"}`);
}
