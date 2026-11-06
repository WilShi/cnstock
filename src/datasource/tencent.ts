/**
 * Tencent quote fallback.
 *
 * Used when Eastmoney's push2 endpoints rate-limit or block the client
 * (observed in practice: push2 returns an empty socket close under load).
 * Responses are GBK encoded so they must be decoded explicitly.
 */

import { httpRequest, exchangePrefix, num, type Kline, type Quote } from "./types.ts";

const SOURCE = "tencent";

export async function tencentQuote(code: string): Promise<Quote> {
  const sym = exchangePrefix(code) + code;
  const text = await httpRequest(`https://qt.gtimg.cn/q=${sym}`, {
    encoding: "gbk",
    headers: { Referer: "https://gu.qq.com/" },
  });
  const m = text.match(/="([^"]*)"/);
  if (!m) throw new Error("腾讯行情返回格式异常");
  const f = m[1].split("~");
  if (f.length < 48 || !f[3]) throw new Error("腾讯行情缺少数据");

  // Market cap fields are reported in 亿元.
  const yiToYuan = (v: number | null) => (v === null ? null : v * 1e8);

  return {
    code: f[2] || code,
    name: f[1],
    price: num(f[3]) ?? 0,
    prevClose: num(f[4]) ?? 0,
    open: num(f[5]) ?? 0,
    change: num(f[31]) ?? 0,
    changePct: num(f[32]) ?? 0,
    high: num(f[33]) ?? 0,
    low: num(f[34]) ?? 0,
    turnoverRate: num(f[38]),
    peTtm: num(f[39]),
    // Field layout verified against a live 600519 payload:
    // 44 = total market cap(亿), 45 = free-float cap(亿), 46 = PB, 47 = limit-up price.
    totalMarketCap: yiToYuan(num(f[44])),
    floatMarketCap: yiToYuan(num(f[45])),
    pb: num(f[46]),
    industry: null,
    region: null,
    concepts: [],
    source: SOURCE,
    asOf: f[30] ? formatTs(f[30]) : null,
  };
}

function formatTs(raw: string): string | null {
  if (!/^[0-9]{14}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;
}

export async function tencentKline(code: string, limit = 60): Promise<Kline[]> {
  const sym = exchangePrefix(code) + code;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${limit},qfq`;
  const json = JSON.parse(await httpRequest(url, { headers: { Referer: "https://gu.qq.com/" } }));
  const node = json?.data?.[sym];
  const rows: any[] = node?.qfqday ?? node?.day ?? [];
  if (!rows.length) throw new Error("腾讯 K 线返回为空");
  return rows.map((r) => ({
    date: String(r[0]),
    open: Number(r[1]),
    close: Number(r[2]),
    high: Number(r[3]),
    low: Number(r[4]),
    volume: Number(r[5]),
  }));
}
