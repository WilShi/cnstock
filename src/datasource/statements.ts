/**
 * 三表数据获取：资产负债表、利润表、现金流量表。
 *
 * 全部来自东方财富公开接口，零 token。资产负债表用完整版（319 字段），
 * 因为简版（RPT_DMSK_FN_BALANCE）没有商誉字段。
 */

import { httpRequest, normalizeCode } from "./types.ts";

const DATA_API = "https://datacenter-web.eastmoney.com/api/data/v1/get";

export interface BalanceSheet {
  reportDate: string;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalParentEquity: number | null;
  goodwill: number | null;
  monetaryFunds: number | null;
  accountsRece: number | null;
  inventory: number | null;
  shortLoan: number | null;
  longLoan: number | null;
  bondPayable: number | null;
  noncurrentLiab1Year: number | null;
  otherRece: number | null;
}

export interface IncomeStatement {
  reportDate: string;
  totalRevenue: number | null;
  operateCost: number | null;
  parentNetProfit: number | null;
  totalProfit: number | null;
  financeExpense: number | null;
  investIncome: number | null;
}

export interface CashflowStatement {
  reportDate: string;
  netcashOperate: number | null;
  constructLongAsset: number | null;
  netcashInvest: number | null;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

async function fetchReport(reportName: string, code: string, limit: number, annualOnly: boolean): Promise<any[]> {
  const params = new URLSearchParams({
    reportName,
    columns: "ALL",
    filter: `(SECURITY_CODE="${code}")`,
    pageSize: String(limit),
    sortColumns: "REPORT_DATE",
    sortTypes: "-1",
    source: "WEB",
    client: "WEB",
  });
  const res = await httpRequest(`${DATA_API}?${params}`, {
    headers: { Referer: "https://data.eastmoney.com/" },
    timeoutMs: 20000,
  });
  const json = JSON.parse(res);
  const rows: any[] = json?.result?.data ?? [];
  if (!annualOnly) return rows;
  // REPORT_DATE arrives as "2025-12-31 00:00:00", so match the substring, not the suffix.
  return rows.filter((r) => String(r.REPORT_DATE ?? "").includes("-12-31"));
}

/** 年报序列，最新在前。只取 12-31 的报告期。 */
export async function getAnnualBalances(code: string, years = 5): Promise<BalanceSheet[]> {
  const rows = await fetchReport("RPT_F10_FINANCE_GBALANCE", normalizeCode(code), years * 4, true);
  return rows.slice(0, years).map((r) => ({
    reportDate: String(r.REPORT_DATE ?? "").slice(0, 10),
    totalAssets: n(r.TOTAL_ASSETS),
    totalLiabilities: n(r.TOTAL_LIABILITIES),
    totalParentEquity: n(r.TOTAL_PARENT_EQUITY),
    goodwill: n(r.GOODWILL),
    monetaryFunds: n(r.MONETARYFUNDS),
    accountsRece: n(r.ACCOUNTS_RECE),
    inventory: n(r.INVENTORY),
    shortLoan: n(r.SHORT_LOAN),
    longLoan: n(r.LONG_LOAN),
    bondPayable: n(r.BOND_PAYABLE),
    noncurrentLiab1Year: n(r.NONCURRENT_LIAB_1YEAR),
    otherRece: n(r.OTHER_RECE),
  }));
}

export async function getAnnualIncomes(code: string, years = 5): Promise<IncomeStatement[]> {
  const rows = await fetchReport("RPT_DMSK_FN_INCOME", normalizeCode(code), years * 4, true);
  return rows.slice(0, years).map((r) => ({
    reportDate: String(r.REPORT_DATE ?? "").slice(0, 10),
    totalRevenue: n(r.TOTAL_OPERATE_INCOME),
    operateCost: n(r.OPERATE_COST),
    parentNetProfit: n(r.PARENT_NETPROFIT),
    totalProfit: n(r.TOTAL_PROFIT),
    financeExpense: n(r.FINANCE_EXPENSE),
    investIncome: n(r.INVEST_INCOME),
  }));
}

export async function getAnnualCashflows(code: string, years = 5): Promise<CashflowStatement[]> {
  const rows = await fetchReport("RPT_DMSK_FN_CASHFLOW", normalizeCode(code), years * 4, true);
  return rows.slice(0, years).map((r) => ({
    reportDate: String(r.REPORT_DATE ?? "").slice(0, 10),
    netcashOperate: n(r.NETCASH_OPERATE),
    constructLongAsset: n(r.CONSTRUCT_LONG_ASSET),
    netcashInvest: n(r.NETCASH_INVEST),
  }));
}

/** 一次性取齐三表。 */
export async function getStatements(code: string, years = 5) {
  const [balances, incomes, cashflows] = await Promise.all([
    getAnnualBalances(code, years),
    getAnnualIncomes(code, years),
    getAnnualCashflows(code, years),
  ]);
  return { balances, incomes, cashflows };
}
