/**
 * 财务红旗规则库（v0.1）。
 *
 * 设计原则：每条规则输出可解释的证据，不输出打分。
 * 宁可漏报不可误报 —— 假阳性会迅速摧毁工具的可信度。
 */

import type { BalanceSheet, CashflowStatement, IncomeStatement } from "../datasource/statements.ts";

export type Severity = "info" | "warn" | "critical";

export interface Flag {
  rule: string;
  severity: Severity;
  /** 触发时的判定值，例如 "0.42" */
  value: string;
  /** 阈值说明 */
  threshold: string;
  /** 原始数据依据，用于人工复核 */
  evidence: string;
}

export interface StatementSet {
  balances: BalanceSheet[];
  incomes: IncomeStatement[];
  cashflows: CashflowStatement[];
}

const yi = (v: number | null): string => (v === null ? "—" : (v / 1e8).toFixed(2) + " 亿");

/** 有息负债 = 短贷 + 长贷 + 应付债券 + 一年内到期非流动负债 */
export function interestBearingDebt(b: BalanceSheet): number {
  return (b.shortLoan ?? 0) + (b.longLoan ?? 0) + (b.bondPayable ?? 0) + (b.noncurrentLiab1Year ?? 0);
}

/**
 * 规则 1：净利现价比。
 *
 * 近 N 年累计经营现金流 / 累计净利润。低于 1 说明利润没有变成现金。
 * 这是财务异常最可靠的单条信号，也是大多数爆雷案最先露出破绽的地方。
 */
export function ruleCashConversion(s: StatementSet, years = 3): Flag | null {
  const n = Math.min(years, s.cashflows.length, s.incomes.length);
  if (n < 2) return null;
  let cash = 0, profit = 0;
  for (let i = 0; i < n; i++) {
    const c = s.cashflows[i]?.netcashOperate;
    const p = s.incomes[i]?.parentNetProfit;
    if (c === null || c === undefined || p === null || p === undefined) return null;
    cash += c; profit += p;
  }
  if (profit <= 0) return null;
  const ratio = cash / profit;
  const severity: Severity | null = ratio < 0.3 ? "critical" : ratio < 0.7 ? "warn" : null;
  if (!severity) return null;
  return {
    rule: "净利现价比",
    severity,
    value: ratio.toFixed(2),
    threshold: "< 0.70 关注，< 0.30 重大",
    evidence: `近 ${n} 年累计净利 ${yi(profit)}，累计经营现金流 ${yi(cash)}`,
  };
}

/**
 * 规则 2：商誉占净资产比例。
 * 一次减值可以直接吃掉大半净资产，且减值时点完全由管理层决定。
 */
export function ruleGoodwillRatio(s: StatementSet): Flag | null {
  const b = s.balances[0];
  if (!b || b.goodwill === null || b.totalParentEquity === null) return null;
  if (b.goodwill <= 0 || b.totalParentEquity <= 0) return null;
  const ratio = (b.goodwill / b.totalParentEquity) * 100;
  const severity: Severity | null = ratio > 50 ? "critical" : ratio > 30 ? "warn" : null;
  if (!severity) return null;
  return {
    rule: "商誉占净资产",
    severity,
    value: ratio.toFixed(1) + "%",
    threshold: "> 30% 关注，> 50% 重大",
    evidence: `${b.reportDate} 商誉 ${yi(b.goodwill)}，归母净资产 ${yi(b.totalParentEquity)}`,
  };
}

/**
 * 规则 3：存贷双高。
 *
 * 账上趴着大量现金，同时还在大额有息负债 —— 现金和负债同时"高"在商业上是矛盾的。
 * 这是纯三表数据就能算出的强信号，不需要任何额外数据源。
 */
export function ruleCashAndDebt(s: StatementSet): Flag | null {
  const b = s.balances[0];
  if (!b || b.totalAssets === null || b.monetaryFunds === null) return null;
  const debt = interestBearingDebt(b);
  const cashRatio = (b.monetaryFunds / b.totalAssets) * 100;
  const debtRatio = (debt / b.totalAssets) * 100;
  if (cashRatio > 15 && debtRatio > 15) {
    return {
      rule: "存贷双高",
      severity: cashRatio > 25 && debtRatio > 25 ? "critical" : "warn",
      value: `现金 ${cashRatio.toFixed(1)}% / 有息负债 ${debtRatio.toFixed(1)}%`,
      threshold: "货币资金与有息负债均占 > 15% 总资产",
      evidence: `${b.reportDate} 货币资金 ${yi(b.monetaryFunds)}，有息负债 ${yi(debt)}，总资产 ${yi(b.totalAssets)}`,
    };
  }
  return null;
}

/**
 * 规则 4：净资产为负。
 * 严格说这不是"红旗"而是已经倒下 —— 但必须单独列出，因为它决定了其他比率全部失效。
 */
export function ruleNegativeEquity(s: StatementSet): Flag | null {
  const b = s.balances[0];
  if (!b || b.totalParentEquity === null) return null;
  if (b.totalParentEquity >= 0) return null;
  return {
    rule: "净资产为负",
    severity: "critical",
    value: yi(b.totalParentEquity),
    threshold: "< 0",
    evidence: `${b.reportDate} 归母净资产为负，其他财务比率均失真`,
  };
}

/** 跑全部规则。 */
export function runRules(sets: StatementSet): Flag[] {
  const flags: Flag[] = [];
  for (const fn of [ruleNegativeEquity, ruleGoodwillRatio, ruleCashConversion, ruleCashAndDebt]) {
    const f = fn(sets);
    if (f) flags.push(f);
  }
  const order: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}
