/**
 * 分层财务筛查。
 *
 * 分层是 v0.2 全市场验证得出的结论：单一规则集无法同时做到高精确率和高召回。
 * 因此按置信度分层呈现，而不是给出一个总分。
 *
 * 验证依据（2026-11-06，A 股 5563 家，ST 313 家做验证集）：
 *   净资产为负             ST 命中 27.6%  正常误报 0.8%   提升 34.72x
 *   连续两年亏损            ST 命中 49.8%  正常误报 16.9%  提升 2.95x
 *   经营现金流连负          ST 命中 20.2%  正常误报 8.3%   提升 2.43x
 *   高商誉 > 30%           覆盖较少，作为辅助信号
 *
 * 注意：净利现价比等「造假检测」类规则未纳入本筛查 ——
 * 它们在 ST 验证集中是反指标（0.16x），且缺乏有效的横截面验证方法。
 */

import type { MarketRow } from "../datasource/market.ts";

export type Tier = "red" | "yellow" | "green";

export interface Signal {
  /** 规则名 */
  rule: string;
  /** 判定值 */
  value: string;
  /** 原始数据依据 */
  evidence: string;
  /** 该规则的验证提升倍数 */
  lift: number;
}

export interface Screening {
  code: string;
  name: string;
  industry: string | null;
  isSt: boolean;
  tier: Tier;
  signals: Signal[];
}

export interface YearSet {
  y22?: MarketRow;
  y23?: MarketRow;
  y24?: MarketRow;
  y25?: MarketRow;
}

const yi = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : (v / 1e8).toFixed(2) + " 亿";

export function screenOne(code: string, name: string, industry: string | null, isSt: boolean, ys: YearSet): Screening {
  const signals: Signal[] = [];
  const cur = ys.y25;
  const prev = ys.y24;

  if (!cur || cur.totalParentEquity === null) {
    return { code, name, industry, isSt, tier: "green", signals };
  }

  // 红：净资产为负（34.72x）
  if (cur.totalParentEquity < 0) {
    signals.push({
      rule: "净资产为负",
      value: yi(cur.totalParentEquity),
      evidence: `${cur.reportDate} 归母净资产为负；此时其他财务比率均失真`,
      lift: 34.72,
    });
  }

  // 黄：连续两年亏损（2.95x）
  if (prev && prev.parentNetProfit !== null && cur.parentNetProfit !== null &&
      prev.parentNetProfit < 0 && cur.parentNetProfit < 0) {
    signals.push({
      rule: "连续两年亏损",
      value: `${yi(prev.parentNetProfit)} / ${yi(cur.parentNetProfit)}`,
      evidence: `${prev.reportDate} 与 ${cur.reportDate} 归母净利均为负`,
      lift: 2.95,
    });
  }

  // 黄：经营现金流连负（2.43x）
  if (prev && prev.netcashOperate !== null && cur.netcashOperate !== null &&
      prev.netcashOperate < 0 && cur.netcashOperate < 0) {
    signals.push({
      rule: "经营现金流连负",
      value: `${yi(prev.netcashOperate)} / ${yi(cur.netcashOperate)}`,
      evidence: `${prev.reportDate} 与 ${cur.reportDate} 经营活动现金流净额均为负`,
      lift: 2.43,
    });
  }

  // 黄：商誉占净资产过高
  if (cur.goodwill !== null && cur.goodwill > 0 && cur.totalParentEquity > 0) {
    const ratio = (cur.goodwill / cur.totalParentEquity) * 100;
    if (ratio > 30) {
      signals.push({
        rule: "商誉占净资产过高",
        value: ratio.toFixed(1) + "%",
        evidence: `商誉 ${yi(cur.goodwill)} / 归母净资产 ${yi(cur.totalParentEquity)}`,
        lift: 2.45,
      });
    }
  }

  const hasRed = signals.some((s) => s.lift >= 10);
  const tier: Tier = hasRed ? "red" : signals.length > 0 ? "yellow" : "green";
  return { code, name, industry, isSt, tier, signals };
}

export const TIER_LABEL: Record<Tier, string> = {
  red: "[红] 高危",
  yellow: "[黄] 关注",
  green: "[绿] 未见异常",
};
