/**
 * 区分度测试：红旗规则能否把有财务问题的公司与健康公司分开。
 *
 * 注意：这不是严格的事前预警回测。已被处罚的公司历史报表大多经过重述，
 * 无法还原「事发前原始披露」的数字。这里验证的是规则的区分度。
 */

import { getStatements } from "../src/datasource/statements.ts";
import { runRules } from "../src/analysis/redflags.ts";

const CASES: [string, string, boolean][] = [
  // code, name, 是否已知问题公司
  ["600518", "康美药业", true],
  ["002450", "康得新", true],
  ["002069", "獐子岛", true],
  ["600079", "人福医药", true],
  ["000636", "风华高科", true],
  ["600519", "贵州茅台", false],
  ["000333", "美的集团", false],
  ["002415", "海康威视", false],
  ["601899", "紫金矿业", false],
  ["600276", "恒瑞医药", false],
];

let hit = 0, miss = 0, falsePositive = 0, trueNegative = 0;

for (const [code, name, isBad] of CASES) {
  let line = `${name.padEnd(6)}（${code}） `;
  try {
    const s = await getStatements(code, 5);
    const flags = runRules(s);
    const crit = flags.filter((f) => f.severity === "critical").length;
    const warn = flags.filter((f) => f.severity === "warn").length;
    const bad = crit > 0 || warn > 0;
    line += `[红 ${crit} / 黄 ${warn}] `;
    if (isBad && bad) { hit++; line += "命中"; }
    else if (isBad && !bad) { miss++; line += "漏报 <<<"; }
    else if (!isBad && bad) { falsePositive++; line += "误报 <<<"; }
    else { trueNegative++; line += "正确放行"; }
    console.log(line);
    for (const f of flags) {
      console.log(`        ${f.severity === "critical" ? "[红]" : "[黄]"} ${f.rule} = ${f.value}   ${f.evidence}`);
    }
  } catch (e) {
    console.log(line + "取数失败: " + (e as Error).message.slice(0, 60));
  }
}

console.log("");
console.log("=== 区分度汇总 ===");
console.log(`问题公司命中: ${hit} / ${hit + miss}`);
console.log(`健康公司误报: ${falsePositive} / ${falsePositive + trueNegative}（误报率 ${((falsePositive / (falsePositive + trueNegative)) * 100).toFixed(0)}%）`);
