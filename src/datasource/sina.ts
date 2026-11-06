/**
 * Sina quote fallback — the last link in the quote chain.
 * Requires a finance.sina.com.cn Referer and returns GBK.
 */

import { httpRequest, exchangePrefix, num, type Quote } from "./types.ts";

const SOURCE = "sina";

export async function sinaQuote(code: string): Promise<Quote> {
  const sym = exchangePrefix(code) + code;
  const text = await httpRequest(`https://hq.sinajs.cn/list=${sym}`, {
    encoding: "gbk",
    headers: { Referer: "https://finance.sina.com.cn/" },
  });
  const m = text.match(/="([^"]*)"/);
  if (!m || !m[1]) throw new Error("新浪行情返回为空");
  const f = m[1].split(",");
  if (f.length < 32) throw new Error("新浪行情字段不足");

  const prevClose = num(f[2]) ?? 0;
  const price = num(f[3]) ?? 0;
  const change = price - prevClose;

  return {
    code,
    name: f[0],
    price,
    prevClose,
    open: num(f[1]) ?? 0,
    high: num(f[4]) ?? 0,
    low: num(f[5]) ?? 0,
    change: Number(change.toFixed(3)),
    changePct: prevClose ? Number(((change / prevClose) * 100).toFixed(3)) : 0,
    turnoverRate: null,
    totalMarketCap: null,
    floatMarketCap: null,
    peTtm: null,
    pb: null,
    industry: null,
    region: null,
    concepts: [],
    source: SOURCE,
    asOf: f[30] && f[31] ? `${f[30]}T${f[31]}` : null,
  };
}
