import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts", mcp: "src/mcp.ts" },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "es2024",
  dts: true,
  clean: true,
  sourcemap: false,
  outputOptions: { entryFileNames: "[name].js" },
});
