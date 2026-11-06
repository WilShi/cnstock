# cnstock · 中国股票数据 CLI

> 一条命令拿到 A 股行情、财报、估值和研报。**免 API Key、零配置、多源自动降级。**

```console
$ npx cnstock quote 600519
贵州茅台（600519）
  最新价          1453 元
  涨跌幅          +0.07%（+1）
  总市值          18163.69 亿元
  PE(TTM)         21.13
  PB              6.70
  换手率          0.1%
  行业            白酒Ⅱ
  数据源          eastmoney
```

## 为什么不用 akshare / tushare

| | akshare | tushare | **cnstock** |
| --- | --- | --- | --- |
| 语言 | Python | Python | Node / TypeScript |
| 安装 | `pip install akshare`（依赖重） | `pip install tushare` | `npx cnstock`（零安装） |
| API Key | 不需要 | **需要 token** | **不需要** |
| 接口失效时 | 直接报错 | 直接报错 | **自动切换备用数据源** |
| 与 AI 集成 | 需要自己封装 | 需要自己封装 | **内置 MCP server** |

最关键的差异是第三行。这些公开接口都没有 SLA：开发期间实测过东方财富的行情接口在请求变多后**所有分片同时断开连接**，而 `datacenter`、腾讯、新浪仍然正常。只绑一个源的工具会在你不知情时静默失效，所以 `cnstock` 每次调用都按顺序尝试多个源，并在输出里用 `source` 字段告诉你这次是谁答的。

## 快速开始

```bash
# 直接用，不用安装
npx cnstock quote 600519

# 检索股票
npx cnstock search 茅台

# 财报 + TTM 折算
npx cnstock financials 600519

# 估值测算
npx cnstock value 600519 --growth 0.1 --discount 0.12

# 生成完整研报
npx cnstock report 600519 > 茅台研报.md
```

任何命令加 `--json` 都输出结构化 JSON，方便管道处理：

```bash
npx cnstock quote 600519 --json | jq .price
```

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `search <关键词>` | 按代码、名称或拼音首字母检索 |
| `quote <代码>` | 实时行情、市值、PE/PB、行业概念 |
| `kline <代码>` | 前复权日 K 线（`--days`） |
| `financials <代码>` | 财报摘要与 TTM 折算（`--periods`） |
| `value <代码>` | 估值测算，自动选模型 |
| `report <代码>` | 完整 Markdown 研究简报 |

## 作为 MCP 服务使用

`cnstock` 同时是一个 MCP server，可以直接接进 Claude Desktop、Cursor 等支持 MCP 的客户端：

```json
{
  "mcpServers": {
    "cnstock": {
      "command": "npx",
      "args": ["-y", "cnstock-mcp"]
    }
  }
}
```

提供的 6 个工具：`cnstock_search`、`cnstock_quote`、`cnstock_kline`、`cnstock_financials`、`cnstock_valuation`、`cnstock_report`。

接上之后就能直接问：

> 「茅台现在贵吗？按 10% 折现率帮我算一下。」

## 两个它做得比别家认真的地方

### 1. TTM 不是随便取一期

A 股财报是**累计口径**——三季报的净利润是 1 到 9 月的累计值，直接当年度数据用会严重失真。`cnstock` 按 `最新累计 + 上年年报 - 上年同期` 折算 TTM，并把计算依据一起输出：

```
TTM 归母净利    821.61 亿元
TTM 口径        TTM = 2026年 三季报累计 + 2025年报 - 2025年同期
```

### 2. 不同生意用不同估值模型

| 公司类型 | 模型 | 原因 |
| --- | --- | --- |
| 一般盈利公司 | 两阶段 DCF | 净利润可近似所有者收益 |
| 银行 / 保险 / 证券 | PB-ROE | 金融企业净利被存款与拨备主导，**不等于自由现金流** |
| 亏损公司 | 明确标注不适用 | 应改用 PS 或重置成本 |

对银行套 DCF 会算出荒谬的「安全边际」——平安银行用 DCF 会显示低估 69.8%，而正确做法是用 Gordon 增长形式的 `合理 PB = (ROE - g) / (r - g)`。`cnstock` 会自动识别并切换。

此外它会**反推当前股价隐含的增速**：茅台现价隐含 5 年增速约 14.2%，你可以自己判断这个预期是否合理。

## 项目结构

```
├── src/
│   ├── cli.ts                # 命令行入口
│   ├── mcp.ts                # MCP server 入口
│   ├── index.ts              # 库导出
│   ├── datasource/
│   │   ├── index.ts          # 多源降级编排
│   │   ├── eastmoney.ts      # 东方财富
│   │   ├── tencent.ts        # 腾讯（备用）
│   │   ├── sina.ts           # 新浪（兜底）
│   │   └── types.ts
│   └── analysis/
│       ├── valuation.ts      # DCF / PB-ROE / TTM
│       └── report.ts         # Markdown 研报
└── scripts/mcp-smoke.mjs     # MCP 协议冒烟测试
```

## 数据源

| 能力 | 主源 | 备用 |
| --- | --- | --- |
| 行情 / 估值 | 东方财富 | 腾讯 → 新浪 |
| 日 K 线 | 东方财富 | 腾讯 |
| 财报 | 东方财富 datacenter | — |
| 检索 | 东方财富 searchapi | — |

均为公开接口，无需注册。行业与概念标签只有东方财富提供；降级到备用源时这些字段为空，输出会如实标注。

## 免责声明

本项目是数据工具，不构成投资建议。数据来自第三方公开接口，可能存在延迟、缺失或口径差异；估值结果对假设高度敏感。据此操作风险自担。

## License

[MIT](LICENSE) © 2026 WilShi
