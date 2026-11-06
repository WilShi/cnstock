/**
 * Resilient A-share data access.
 *
 * Every public quote endpoint we rely on is undocumented and can rate-limit or
 * drop connections without notice (Eastmoney push2 was observed doing exactly
 * that during development). So each capability walks a fallback chain and
 * reports which upstream actually answered.
 */

import { DataSourceError, type FinancialPeriod, type Kline, type Quote, type StockHit } from "./types.ts";
import { eastmoneyFinancials, eastmoneyKline, eastmoneyQuote, eastmoneySearch } from "./eastmoney.ts";
import { tencentKline, tencentQuote } from "./tencent.ts";
import { sinaQuote } from "./sina.ts";

export * from "./types.ts";
export { eastmoneySearch };

interface Attempt {
  source: string;
  error: string;
}

async function firstSuccess<T>(
  capability: string,
  steps: { source: string; run: () => Promise<T> }[]
): Promise<T> {
  const attempts: Attempt[] = [];
  for (const step of steps) {
    try {
      return await step.run();
    } catch (e) {
      attempts.push({ source: step.source, error: (e as Error).message });
    }
  }
  throw new DataSourceError(
    `${capability} 全部数据源均失败: ` + attempts.map((a) => `${a.source}(${a.error})`).join("; "),
    attempts
  );
}

/** Search A-share tickers by code / name / pinyin. */
export async function searchStocks(keyword: string, limit = 10): Promise<StockHit[]> {
  return firstSuccess("股票检索", [
    { source: "eastmoney", run: () => eastmoneySearch(keyword, limit) },
  ]);
}

/** Real-time quote with valuation ratios. Tries Eastmoney, then Tencent, then Sina. */
export async function getQuote(code: string): Promise<Quote> {
  return firstSuccess("实时行情", [
    { source: "eastmoney", run: () => eastmoneyQuote(code) },
    { source: "tencent", run: () => tencentQuote(code) },
    { source: "sina", run: () => sinaQuote(code) },
  ]);
}

/** Daily K-line, oldest first. */
export async function getKline(code: string, limit = 60): Promise<Kline[]> {
  return firstSuccess("历史K线", [
    { source: "eastmoney", run: () => eastmoneyKline(code, limit) },
    { source: "tencent", run: () => tencentKline(code, limit) },
  ]);
}

/** Reported financial periods, newest first. Only Eastmoney exposes this. */
export async function getFinancials(code: string, periods = 8): Promise<FinancialPeriod[]> {
  return firstSuccess("财务报表", [
    { source: "eastmoney", run: () => eastmoneyFinancials(code, periods) },
  ]);
}
