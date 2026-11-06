/**
 * Eastmoney (东方财富) data source — primary for search, financials and quotes.
 *
 * These are public JSON endpoints that need no API key, so the plugin stays
 * zero-config. Note they are undocumented and rate-limited: push2 endpoints
 * can start closing connections under sustained load, which is exactly why
 * every call here has a fallback in ./index.ts.
 */

import { httpRequest, normalizeCode, num, type FinancialPeriod, type Kline, type Quote, type StockHit } from "./types.ts";

const SOURCE = "eastmoney";
const SUGGEST_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8";

const secid = (code: string): string => {
  const c = normalizeCode(code);
  return `${/^(60|68|9|5)/.test(c) ? 1 : 0}.${c}`;
};

/** Fuzzy search by code, Chinese name, or pinyin initials. */
export async function eastmoneySearch(keyword: string, limit = 10): Promise<StockHit[]> {
  const url =
    "https://searchapi.eastmoney.com/api/suggest/get" +
    `?input=${encodeURIComponent(keyword)}&type=14&token=${SUGGEST_TOKEN}`;
  const json = JSON.parse(await httpRequest(url, { headers: { Referer: "https://quote.eastmoney.com/" } }));
  const rows: any[] = json?.QuotationCodeTable?.Data ?? [];
  return rows
    .filter((r) => String(r.Classify ?? "") === "AStock" || /A股/.test(String(r.SecurityTypeName ?? "")))
    .slice(0, limit)
    .map((r) => ({ code: String(r.Code), name: String(r.Name), pinyin: String(r.PinYin ?? ""), market: String(r.SecurityTypeName ?? "") }));
}

export async function eastmoneyQuote(code: string): Promise<Quote> {
  const c = normalizeCode(code);
  const fields = [
    "f43", "f57", "f58", "f59", "f60", "f44", "f45", "f46", "f47",
    "f84", "f85", "f116", "f117", "f162", "f167", "f173", "f168",
    "f127", "f128", "f129", "f169", "f170",
  ].join(",");
  const json = JSON.parse(
    await httpRequest(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid(c)}&fields=${fields}`, {
      headers: { Referer: "https://quote.eastmoney.com/" },
    })
  );
  const d = json?.data;
  if (!d || !d.f58) throw new Error("东财行情返回为空");

  const pct = (v: any): number | null => {
    const n = num(v);
    return n === null ? null : n / 100;
  };

  return {
    code: String(d.f57 ?? c),
    name: String(d.f58),
    price: pct(d.f43) ?? 0,
    prevClose: pct(d.f60) ?? 0,
    open: pct(d.f46) ?? 0,
    high: pct(d.f44) ?? 0,
    low: pct(d.f45) ?? 0,
    change: pct(d.f169) ?? 0,
    changePct: pct(d.f170) ?? 0,
    // f168 is the turnover rate scaled by 100; f47 is traded volume in lots.
    turnoverRate: pct(d.f168),
    totalMarketCap: num(d.f116),
    floatMarketCap: num(d.f117),
    peTtm: pct(d.f162),
    pb: pct(d.f167),
    industry: d.f127 && d.f127 !== "-" ? String(d.f127) : null,
    region: d.f128 && d.f128 !== "-" ? String(d.f128) : null,
    concepts: d.f129 && d.f129 !== "-" ? String(d.f129).split(",").filter(Boolean) : [],
    source: SOURCE,
    asOf: null,
  };
}

export async function eastmoneyKline(code: string, limit = 60): Promise<Kline[]> {
  const c = normalizeCode(code);
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
    `?secid=${secid(c)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101&lmt=${limit}`;
  const json = JSON.parse(
    await httpRequest(url, { headers: { Referer: "https://quote.eastmoney.com/" } })
  );
  const rows: string[] = json?.data?.klines ?? [];
  if (!rows.length) throw new Error("东财 K 线返回为空");
  return rows.map((line) => {
    const [date, open, close, high, low, volume] = line.split(",");
    return {
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
    };
  });
}

/** Reported financial periods, newest first. This endpoint is far more stable than push2. */
export async function eastmoneyFinancials(code: string, periods = 8): Promise<FinancialPeriod[]> {
  const c = normalizeCode(code);
  const params = new URLSearchParams({
    reportName: "RPT_LICO_FN_CPD",
    columns: "ALL",
    filter: `(SECURITY_CODE="${c}")`,
    pageSize: String(periods),
    sortColumns: "REPORTDATE",
    sortTypes: "-1",
    source: "WEB",
    client: "WEB",
  });
  const json = JSON.parse(
    await httpRequest(`https://datacenter-web.eastmoney.com/api/data/v1/get?${params}`, {
      headers: { Referer: "https://data.eastmoney.com/" },
    })
  );
  const rows: any[] = json?.result?.data ?? [];
  if (!rows.length) throw new Error(`查不到财报数据: ${c}`);
  return rows.map((r) => ({
    reportDate: String(r.REPORTDATE ?? "").slice(0, 10),
    periodLabel: String(r.DATATYPE ?? ""),
    basicEps: num(r.BASIC_EPS),
    bps: num(r.BPS),
    revenue: num(r.TOTAL_OPERATE_INCOME),
    netProfit: num(r.PARENT_NETPROFIT),
    roe: num(r.WEIGHTAVG_ROE),
    grossMargin: num(r.XSMLL),
    revenueYoY: num(r.YSTZ),
    netProfitYoY: num(r.SJLTZ),
    dividendYield: num(r.ZXGXL),
    dividendPlan: r.ASSIGNDSCRPT ? String(r.ASSIGNDSCRPT) : null,
  }));
}
