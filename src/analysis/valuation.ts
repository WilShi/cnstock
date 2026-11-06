/**
 * Valuation engine.
 *
 * Deliberately conservative and explicit about its assumptions: every number
 * fed into a model is either reported data or a user-supplied assumption, and
 * the output always shows the basis so the agent can explain itself.
 */

import type { FinancialPeriod, Quote } from "../datasource/types.ts";

export interface TtmFigure {
  value: number | null;
  /** Human-readable explanation of how the figure was derived. */
  basis: string;
}

/**
 * Trailing-twelve-month figure from cumulative quarterly reports.
 *
 * A-share reports are cumulative (Q3 = Jan..Sep), so TTM is
 * latest cumulative + last full year - same period last year.
 */
export function computeTtm(periods: FinancialPeriod[], key: "netProfit" | "revenue"): TtmFigure {
  if (!periods.length) return { value: null, basis: "无财报数据" };
  const sorted = [...periods].sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  const latest = sorted[0];
  const latestVal = latest[key];
  if (latestVal === null) return { value: null, basis: `${latest.periodLabel} 无该项数据` };

  const [y, m, d] = latest.reportDate.split("-");
  const isAnnual = m === "12" && d === "31";
  if (isAnnual) return { value: latestVal, basis: `${latest.periodLabel}（年报，直接作为 TTM）` };

  const annual = sorted.find((p) => p.reportDate === `${Number(y) - 1}-12-31`);
  const sameLastYear = sorted.find((p) => p.reportDate === `${Number(y) - 1}-${m}-${d}`);
  if (annual?.[key] === null || annual === undefined || sameLastYear?.[key] === null || sameLastYear === undefined) {
    return {
      value: latestVal,
      basis: `${latest.periodLabel} 累计值（缺上年同期数据，未能折算 TTM，直接沿用累计值）`,
    };
  }
  const ttm = latestVal + (annual[key] as number) - (sameLastYear[key] as number);
  return {
    value: ttm,
    basis: `TTM = ${latest.periodLabel}累计 + ${Number(y) - 1}年报 - ${Number(y) - 1}年同期`,
  };
}

export interface DcfAssumptions {
  /** Annual growth rate for the explicit forecast window, e.g. 0.08 for 8%. */
  growthRate: number;
  /** Perpetual growth after the forecast window. */
  terminalGrowth: number;
  /** Required return / discount rate. */
  discountRate: number;
  /** Explicit forecast years. */
  years: number;
}

export interface DcfResult {
  fairValue: number | null;
  fairValuePerShare: number | null;
  marginOfSafety: number | null;
  enterpriseValue: number | null;
  assumptions: DcfAssumptions;
  basis: string;
  /** Per-year discounted cash flow, for transparency. */
  schedule: { year: number; cashflow: number; discounted: number }[];
}

/**
 * Two-stage DCF on net profit as a proxy for owner earnings.
 *
 * This is intentionally a simple, explainable model — not a bank-grade one.
 * Net profit overstates cash flow for capital-heavy businesses, which the
 * report generator calls out as a caveat.
 */
export function runDcf(
  ttmNetProfit: number | null,
  sharesOutstanding: number | null,
  assumptions: DcfAssumptions
): DcfResult {
  const { growthRate, terminalGrowth, discountRate, years } = assumptions;
  const schedule: DcfResult["schedule"] = [];

  if (ttmNetProfit === null || ttmNetProfit <= 0 || !sharesOutstanding || sharesOutstanding <= 0) {
    return {
      fairValue: null,
      fairValuePerShare: null,
      marginOfSafety: null,
      enterpriseValue: null,
      assumptions,
      basis: "净利润缺失或为负，DCF 不适用（亏损公司应改用 PS/重置成本等口径）",
      schedule,
    };
  }
  if (discountRate <= terminalGrowth) {
    return {
      fairValue: null, fairValuePerShare: null, marginOfSafety: null, enterpriseValue: null,
      assumptions, basis: "折现率必须大于永续增速，否则模型无解", schedule,
    };
  }

  let pv = 0;
  for (let i = 1; i <= years; i++) {
    const cashflow = ttmNetProfit * Math.pow(1 + growthRate, i);
    const discounted = cashflow / Math.pow(1 + discountRate, i);
    pv += discounted;
    schedule.push({ year: i, cashflow, discounted });
  }
  const terminalCashflow = ttmNetProfit * Math.pow(1 + growthRate, years) * (1 + terminalGrowth);
  const terminalValue = terminalCashflow / (discountRate - terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + discountRate, years);
  const enterpriseValue = pv + pvTerminal;

  return {
    fairValue: enterpriseValue,
    fairValuePerShare: enterpriseValue / sharesOutstanding,
    marginOfSafety: null,
    enterpriseValue,
    assumptions,
    basis: `两阶段 DCF：前 ${years} 年按 ${(growthRate * 100).toFixed(1)}% 增长，之后永续 ${(terminalGrowth * 100).toFixed(1)}%，折现率 ${(discountRate * 100).toFixed(1)}%；以净利润近似所有者收益`,
    schedule,
  };
}

export type ValuationModel = "dcf" | "pb-roe" | "unsupported";

export interface ModelChoice {
  model: ValuationModel;
  reason: string;
}

/**
 * Pick a valuation model appropriate to the business.
 *
 * Banks/insurers are excluded from DCF on purpose: their net profit is not a
 * proxy for free cash flow (deposits and loan-loss provisioning dominate), so
 * a DCF on them produces meaningless "margin of safety" numbers. They get a
 * justified-PB model instead, which is the standard approach for financials.
 */
export function pickValuationModel(name: string, industry: string | null, ttmNetProfit: number | null): ModelChoice {
  const hay = `${name} ${industry ?? ""}`;
  if (/银行|保险|证券|信托|券商/.test(hay)) {
    return { model: "pb-roe", reason: "金融类公司净利不等同自由现金流，DCF 不适用，改用 PB-ROE 合理估值" };
  }
  if (ttmNetProfit === null || ttmNetProfit <= 0) {
    return { model: "unsupported", reason: "亏损或缺少净利润数据，DCF/PE 均不适用" };
  }
  return { model: "dcf", reason: "非金融类盈利公司，适用两阶段 DCF" };
}

export interface PbRoeAssumptions {
  /** Required return on equity. */
  requiredReturn: number;
  /** Sustainable growth. */
  sustainableGrowth: number;
}

export interface PbRoeResult {
  fairPb: number | null;
  fairValuePerShare: number | null;
  basis: string;
  assumptions: PbRoeAssumptions;
}

/**
 * Justified PB from the Gordon-growth form of the PB-ROE relation:
 *   PB = (ROE - g) / (r - g)
 */
export function runPbRoe(
  bps: number | null,
  roePercent: number | null,
  assumptions: PbRoeAssumptions
): PbRoeResult {
  const { requiredReturn, sustainableGrowth } = assumptions;
  const roe = roePercent === null ? null : roePercent / 100;
  if (bps === null || bps <= 0 || roe === null) {
    return { fairPb: null, fairValuePerShare: null, basis: "缺少每股净资产或 ROE，无法用 PB-ROE 模型", assumptions };
  }
  if (requiredReturn <= sustainableGrowth) {
    return { fairPb: null, fairValuePerShare: null, basis: "要求回报率必须大于永续增速", assumptions };
  }
  const fairPb = (roe - sustainableGrowth) / (requiredReturn - sustainableGrowth);
  return {
    fairPb,
    fairValuePerShare: bps * fairPb,
    basis: `合理 PB = (ROE ${(roe * 100).toFixed(2)}% - g ${(sustainableGrowth * 100).toFixed(1)}%) / (r ${(requiredReturn * 100).toFixed(1)}% - g) = ${fairPb.toFixed(2)}；每股净资产 ${bps.toFixed(2)} 元`,
    assumptions,
  };
}

/** Price implied by the current PE relative to a target PE. */
export function impliedPriceByPe(eps: number | null, targetPe: number): number | null {
  if (eps === null || eps <= 0) return null;
  return eps * targetPe;
}

/** How much growth the current price implies, given a discount rate. */
export function impliedGrowth(
  price: number,
  ttmNetProfit: number | null,
  sharesOutstanding: number | null,
  assumptions: Pick<DcfAssumptions, "terminalGrowth" | "discountRate" | "years">,
  lo = -0.2,
  hi = 0.6
): number | null {
  if (!ttmNetProfit || ttmNetProfit <= 0 || !sharesOutstanding) return null;
  const target = price * sharesOutstanding;
  let a = lo, b = hi;
  for (let i = 0; i < 60; i++) {
    const mid = (a + b) / 2;
    const ev = runDcf(ttmNetProfit, sharesOutstanding, { ...assumptions, growthRate: mid }).enterpriseValue;
    if (ev === null) return null;
    if (ev < target) a = mid; else b = mid;
  }
  return (a + b) / 2;
}

export function formatMoney(v: number | null, unit: "元" | "亿元" = "元"): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (unit === "亿元") return `${(v / 1e8).toFixed(2)} 亿元`;
  return `${v.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元`;
}

export function formatPct(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export type { Quote };
