/** Shared types for the A-share data layer. */

export interface StockHit {
  code: string;
  name: string;
  pinyin: string;
  market: string;
}

export interface Quote {
  code: string;
  name: string;
  /** Price, in CNY. */
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  /** Turnover rate in percent. */
  turnoverRate: number | null;
  /** Total market cap, in CNY. */
  totalMarketCap: number | null;
  /** Free-float market cap, in CNY. */
  floatMarketCap: number | null;
  peTtm: number | null;
  pb: number | null;
  industry: string | null;
  region: string | null;
  concepts: string[];
  /** Which upstream source answered. */
  source: string;
  /** Data timestamp as reported by the source (ISO-ish), if any. */
  asOf: string | null;
}

export interface Kline {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface FinancialPeriod {
  reportDate: string;
  periodLabel: string;
  basicEps: number | null;
  bps: number | null;
  revenue: number | null;
  netProfit: number | null;
  roe: number | null;
  grossMargin: number | null;
  revenueYoY: number | null;
  netProfitYoY: number | null;
  dividendYield: number | null;
  dividendPlan: string | null;
}

export class DataSourceError extends Error {
  readonly attempts: { source: string; error: string }[];

  constructor(message: string, attempts: { source: string; error: string }[] = []) {
    super(message);
    this.name = "DataSourceError";
    this.attempts = attempts;
  }
}

/** Shared HTTP helper: timeout via AbortSignal, browser-ish UA, JSON or text. */
export async function httpRequest(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; encoding?: "utf8" | "gbk" } = {}
): Promise<string> {
  const { timeoutMs = 8000, headers = {}, encoding = "utf8" } = opts;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "*/*",
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (encoding === "gbk") {
      const buf = Buffer.from(await res.arrayBuffer());
      return new TextDecoder("gbk").decode(buf);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize "sh600519" / "600519.SH" / "600519" -> "600519". */
export function normalizeCode(input: string): string {
  const c = input
    .trim()
    .toUpperCase()
    .replace(/^(SH|SZ|BJ)/, "")
    .replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^[0-9]{6}$/.test(c)) throw new Error(`不是合法的 6 位 A 股代码: ${input}`);
  return c;
}

/** Exchange prefix used by Tencent / Sina style endpoints. */
export function exchangePrefix(code: string): "sh" | "sz" | "bj" {
  if (/^(60|68|9|5)/.test(code)) return "sh";
  if (/^(4|8)/.test(code)) return "bj";
  return "sz";
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export { num };
