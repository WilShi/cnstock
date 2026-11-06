/**
 * 全市场数据：股票列表 + 按报告期批量取三表。
 *
 * 关键优化：东方财富的 datacenter 接口支持按「报告期」批量返回全市场数据，
 * 不需要逐只股票请求。全市场 5000+ 家只需几十个请求而不是上万个。
 */

import { httpRequest } from "./types.ts";

const DATA_API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA_REFERER = { Referer: "https://data.eastmoney.com/" };

export interface StockMeta {
  code: string;
  name: string;
  industry: string | null;
  /** 名称含 ST / *ST，视为已被交易所风险警示 */
  isSt: boolean;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** 全 A 股列表（含 ST 标记与行业）。 */
export async function getStockList(): Promise<StockMeta[]> {
  const out: StockMeta[] = [];
  // The clist endpoint caps a page at 100 regardless of pz, so page until
  // the reported total is reached instead of trusting the page length.
  const pageSize = 100;
  let total = Infinity;
  for (let pn = 1; pn <= Math.ceil(total / pageSize) && pn < 200; pn++) {
    const url =
      "https://push2.eastmoney.com/api/qt/clist/get" +
      `?pn=${pn}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3` +
      "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
      "&fields=f12,f14,f100";
    const res = await httpRequest(url, { headers: { Referer: "https://quote.eastmoney.com/" }, timeoutMs: 20000 });
    const payload = JSON.parse(res)?.data ?? {};
    if (typeof payload.total === "number") total = payload.total;
    const diff: any[] = payload.diff ?? [];
    for (const d of diff) {
      const code = String(d.f12 ?? "");
      const name = String(d.f14 ?? "");
      if (!/^\d{6}$/.test(code)) continue;
      out.push({
        code,
        name,
        industry: d.f100 && d.f100 !== "-" ? String(d.f100) : null,
        isSt: /ST/i.test(name),
      });
    }
    if (!diff.length) break;
  }
  return out;
}

/** 按报告期批量抓取某张表，最多重试若干次。 */
async function bulkReport(reportName: string, reportDate: string, pageSize = 500): Promise<any[]> {
  const rows: any[] = [];
  let pages = 1;
  for (let page = 1; page <= pages && page < 60; page++) {
    const params = new URLSearchParams({
      reportName,
      columns: "ALL",
      filter: `(REPORT_DATE='${reportDate}')`,
      pageSize: String(pageSize),
      pageNumber: String(page),
      source: "WEB",
      client: "WEB",
    });
    let json: any = null;
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        json = JSON.parse(await httpRequest(`${DATA_API}?${params}`, { headers: UA_REFERER, timeoutMs: 40000 }));
        if (json?.success === false) throw new Error(String(json?.message ?? "接口返回失败"));
        break;
      } catch (e) {
        lastError = (e as Error).message;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    // 分页失败必须报错，不能静默返回部分数据 —— 否则同一份数据两次扫描结果会不一致。
    if (json === null) {
      throw new Error(`${reportName} 第 ${page} 页抓取失败（已重试 4 次）：${lastError}`);
    }
    const data: any[] = json?.result?.data ?? [];
    if (typeof json?.result?.pages === "number") pages = json.result.pages;
    rows.push(...data);
    if (!json?.result || !data.length) break;
  }
  return rows;
}

export interface MarketRow {
  code: string;
  reportDate: string;
  totalAssets: number | null;
  totalParentEquity: number | null;
  goodwill: number | null;
  monetaryFunds: number | null;
  interestDebt: number | null;
  totalRevenue: number | null;
  parentNetProfit: number | null;
  netcashOperate: number | null;
}

/**
 * 抓取指定年报期的全市场三表并合并。
 *
 * 三次批量请求（资产负债表 / 利润表 / 现金流量表）后按代码 join。
 */
export async function getMarketYear(year: number): Promise<Map<string, MarketRow>> {
  const reportDate = `${year}-12-31`;
  const [balances, incomes, cashflows] = await Promise.all([
    bulkReport("RPT_F10_FINANCE_GBALANCE", reportDate),
    bulkReport("RPT_DMSK_FN_INCOME", reportDate),
    bulkReport("RPT_DMSK_FN_CASHFLOW", reportDate),
  ]);

  const byCode = new Map<string, MarketRow>();
  const ensure = (code: string): MarketRow => {
    let row = byCode.get(code);
    if (!row) {
      row = {
        code, reportDate,
        totalAssets: null, totalParentEquity: null, goodwill: null,
        monetaryFunds: null, interestDebt: null,
        totalRevenue: null, parentNetProfit: null, netcashOperate: null,
      };
      byCode.set(code, row);
    }
    return row;
  };

  for (const b of balances) {
    const code = String(b.SECURITY_CODE ?? "");
    if (!/^\d{6}$/.test(code)) continue;
    const row = ensure(code);
    row.totalAssets = n(b.TOTAL_ASSETS);
    row.totalParentEquity = n(b.TOTAL_PARENT_EQUITY);
    row.goodwill = n(b.GOODWILL);
    row.monetaryFunds = n(b.MONETARYFUNDS);
    row.interestDebt =
      (n(b.SHORT_LOAN) ?? 0) + (n(b.LONG_LOAN) ?? 0) +
      (n(b.BOND_PAYABLE) ?? 0) + (n(b.NONCURRENT_LIAB_1YEAR) ?? 0);
  }
  for (const i of incomes) {
    const code = String(i.SECURITY_CODE ?? "");
    if (!/^\d{6}$/.test(code)) continue;
    const row = ensure(code);
    row.totalRevenue = n(i.TOTAL_OPERATE_INCOME);
    row.parentNetProfit = n(i.PARENT_NETPROFIT);
  }
  for (const c of cashflows) {
    const code = String(c.SECURITY_CODE ?? "");
    if (!/^\d{6}$/.test(code)) continue;
    ensure(code).netcashOperate = n(c.NETCASH_OPERATE);
  }
  return byCode;
}
