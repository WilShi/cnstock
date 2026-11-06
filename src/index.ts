/**
 * cnstock — programmatic access to A-share data.
 *
 * The CLI and the MCP server are both thin layers over these exports.
 */

export * from "./datasource/index.ts";
export * from "./analysis/valuation.ts";
export { buildReport } from "./analysis/report.ts";
export type { ReportInput } from "./analysis/report.ts";
