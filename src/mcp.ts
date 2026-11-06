#!/usr/bin/env node
/**
 * cnstock as an MCP server.
 *
 * Exposes the same six capabilities as the CLI over the Model Context Protocol so
 * Claude Desktop, Cursor and other MCP clients can read A-share data directly.
 *
 * Run: npx cnstock-mcp    (stdio transport)
 */

import { VERSION } from "./version.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getFinancials, getKline, getQuote, searchStocks } from "./datasource/index.ts";
import { computeTtm, impliedGrowth, pickValuationModel, runDcf, runPbRoe } from "./analysis/valuation.ts";
import { buildReport } from "./analysis/report.ts";

const server = new McpServer({ name: "cnstock", version: VERSION });

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

server.tool(
  "cnstock_search",
  "按代码、中文名称或拼音检索 A 股股票，返回候选标的。查询个股前先用它确定 6 位代码。",
  { keyword: z.string().describe("关键词，如「茅台」「600519」「NDSD」") },
  async ({ keyword }) => json(await searchStocks(keyword, 10)),
);

server.tool(
  "cnstock_quote",
  "获取单只 A 股的实时行情与估值指标：最新价、涨跌幅、总市值、PE(TTM)、PB、行业与概念。",
  { code: z.string().describe("6 位 A 股代码，如 600519") },
  async ({ code }) => json(await getQuote(code)),
);

server.tool(
  "cnstock_kline",
  "获取 A 股日 K 线历史数据（前复权），用于判断趋势、区间高低点与波动。",
  {
    code: z.string().describe("6 位 A 股代码"),
    days: z.number().int().min(5).max(250).optional().describe("取最近多少个交易日，默认 60"),
  },
  async ({ code, days }) => json(await getKline(code, days ?? 60)),
);

server.tool(
  "cnstock_financials",
  "获取 A 股财报摘要：营收、归母净利、ROE、毛利率、同比增速，并折算 TTM（滚动十二个月）口径。",
  {
    code: z.string().describe("6 位 A 股代码"),
    periods: z.number().int().min(1).max(20).optional().describe("取最近几个报告期，默认 8"),
  },
  async ({ code, periods }) => {
    const fins = await getFinancials(code, periods ?? 8);
    return json({ periods: fins, ttmNetProfit: computeTtm(fins, "netProfit"), ttmRevenue: computeTtm(fins, "revenue") });
  },
);

server.tool(
  "cnstock_valuation",
  "对单只 A 股做估值测算。非金融类用两阶段 DCF，银行/保险/证券用 PB-ROE；返回内在价值与现价隐含增速。",
  {
    code: z.string().describe("6 位 A 股代码"),
    growthRate: z.number().optional().describe("DCF 前 N 年净利润增速，默认 0.08"),
    terminalGrowth: z.number().optional().describe("永续增速，默认 0.025"),
    discountRate: z.number().optional().describe("折现率，默认 0.10"),
    years: z.number().int().min(1).max(15).optional().describe("显式预测年数，默认 5"),
  },
  async ({ code, growthRate, terminalGrowth, discountRate, years }) => {
    const assumptions = {
      growthRate: growthRate ?? 0.08,
      terminalGrowth: terminalGrowth ?? 0.025,
      discountRate: discountRate ?? 0.10,
      years: years ?? 5,
    };
    const [q, fins] = await Promise.all([getQuote(code), getFinancials(code, 8)]);
    const shares = q.totalMarketCap && q.price ? q.totalMarketCap / q.price : null;
    const ttmNp = computeTtm(fins, "netProfit");
    const latest = fins[0];
    const choice = pickValuationModel(q.name, q.industry, ttmNp.value);

    if (choice.model === "dcf") {
      const dcf = runDcf(ttmNp.value, shares, assumptions);
      return json({
        code: q.code, name: q.name, price: q.price, model: choice.model, reason: choice.reason,
        fairValuePerShare: dcf.fairValuePerShare,
        basis: dcf.basis,
        impliedGrowth: impliedGrowth(q.price, ttmNp.value, shares, assumptions),
        assumptions,
      });
    }
    if (choice.model === "pb-roe") {
      const pb = runPbRoe(latest?.bps ?? null, latest?.roe ?? null, {
        requiredReturn: assumptions.discountRate,
        sustainableGrowth: assumptions.terminalGrowth,
      });
      return json({ code: q.code, name: q.name, price: q.price, model: choice.model, reason: choice.reason, fairValuePerShare: pb.fairValuePerShare, basis: pb.basis, fairPb: pb.fairPb });
    }
    return json({ code: q.code, name: q.name, price: q.price, model: choice.model, reason: choice.reason });
  },
);

server.tool(
  "cnstock_report",
  "生成一只 A 股的完整研究简报（Markdown）：行情快照、经营质量、估值测算、价格走势与风险提示。",
  {
    code: z.string().describe("6 位 A 股代码"),
    growthRate: z.number().optional().describe("净利润增速假设，默认 0.08"),
    discountRate: z.number().optional().describe("折现率假设，默认 0.10"),
  },
  async ({ code, growthRate, discountRate }) => {
    const [q, fins, bars] = await Promise.all([
      getQuote(code),
      getFinancials(code, 8),
      getKline(code, 120).catch(() => []),
    ]);
    const markdown = buildReport({
      quote: q, financials: fins, klines: bars,
      shares: q.totalMarketCap && q.price ? q.totalMarketCap / q.price : null,
      assumptions: { growthRate: growthRate ?? 0.08, terminalGrowth: 0.025, discountRate: discountRate ?? 0.10, years: 5 },
    });
    return { content: [{ type: "text" as const, text: markdown }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[cnstock] MCP server ready on stdio");