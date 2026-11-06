#!/usr/bin/env node
/** Smoke test: spawn the MCP server and exercise the JSON-RPC handshake. */
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/mcp.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch { /* ignore non-JSON */ }
  }
});
child.stderr.on("data", (d) => process.stderr.write("[server] " + d.toString()));

let id = 0;
const rpc = (method, params) => new Promise((resolve, reject) => {
  const myId = ++id;
  pending.set(myId, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
  setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error("timeout: " + method)); } }, 15000);
});

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.0" },
});
console.log("initialize ->", JSON.stringify(init.result?.serverInfo ?? init.error));

child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = await rpc("tools/list", {});
const names = (tools.result?.tools ?? []).map((t) => t.name);
console.log("tools/list ->", names.length, "个工具:", names.join(", "));

const call = await rpc("tools/call", { name: "cnstock_quote", arguments: { code: "600519" } });
const txt = call.result?.content?.[0]?.text ?? JSON.stringify(call.error);
const parsed = JSON.parse(txt);
console.log("tools/call cnstock_quote ->", parsed.name, parsed.price, "元, 换手率", parsed.turnoverRate + "%");

child.kill();
process.exit(0);
