# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

使用 Antigravity 2.0 IDE 的开发者（个人日常高频使用及开源扩展用户），在编码、调试、多代理协作等长对话场景下，需要随时掌握当前会话的上下文窗口占用、模型生成速度、Token 消耗与估算费用，以及跨会话的总体用量趋势。

## Product Purpose

作为 Antigravity 2.0 的扩展工具，在不额外消耗任何模型 Token 的前提下，实时可视化展示当前会话的上下文分布、缓存命中、生成速度、工具调用构成、Swarm/子代理状态与费用估算，并提供全局跨会话用量汇总与底部紧凑状态栏，帮助用户及时压缩上下文（`/compact`）、定位高耗能工具并对比不同模型的性价比。

## Positioning

- **零额外 Token 消耗**：直接读取 Antigravity 本地 LanguageServerService RPC 与本地 SQLite 对话索引，刷新与轮询不触发任何 LLM 调用。
- **双形态无缝协同**：同时提供右侧辅助面板（`Token & Context` 深度分析）与对话框底部嵌入状态栏（CDP 注入胶囊，零切屏查看上下文与 Gemini 额度）。
- **纯本地、零构建、零第三方运行时依赖**：原生 ESM + HTML/CSS/JS + Node 内置模块实现，数据完全留在本地，不向任何外部服务器上报。

## Operating Context

- **运行环境**：Windows + Antigravity 2.0 IDE 插件体系；右侧面板以本地 Sidecar HTTP 服务方式嵌入 IDE 侧边栏，底部状态栏通过 CDP（Chrome DevTools Protocol）探测本地调试端口（默认 `9223` 等）注入宿主输入框底部。
- **日常使用闭环**：对话过程中通过底部胶囊实时感知上下文占用与 5h/7d Gemini 额度 → 占用过高时一键复制或填入 `/compact` → 切到右侧面板查看分类分布、工具矩形树图、Swarm/子代理明细与单轮费用 → 在全局统计页按工作区/时间范围对比模型费用与性价比 → 在设置页自定义模型参考单价与 USD/CNY 汇率。
- **调试与验证**：提供内置 Mock 模式（`normal` / `high` / `swarm` / `error`），在脱离 IDE 语言服务器时也可独立预览与验证交互；通过 `npm run check && npm test` 和 `npm run install:plugin` 完成校验与本地安装同步。

## Capabilities and Constraints

- **核心能力**：
  - 当前会话监控：100 点上下文分布网格与分类明细、生成速度与 TTFT、缓存命中率与节省量、输入/输出与估算费用（含单轮与子代理费用）、工具调用矩形树图/列表、Swarm 团队与普通子代理区分展示、调用明细分页展开。
  - 全局统计：按工作区/全部、今天/近 7 天/近 30 天/全部聚合；Token 用量与费用估算双维度切换；USD (`$`) 与 CNY (`¥`) 汇率切换；时段趋势图、模型对比与会话排行。
  - 单价与汇率配置：支持自定义模型关键词匹配规则与汇率，持久化保存在 `~/.gemini/antigravity/agy-context-panel-pricing.json`。
  - 底部状态栏（CDP）：上下文环形进度胶囊（支持 `/compact` 快捷按钮与悬停/固定详情浮层）和独立的 Gemini 额度胶囊（5h / 7d 剩余额度与重置倒计时）。
- **硬性约束**：
  - 零构建、零打包步骤，不引入第三方运行时依赖（侧边栏图表使用本地打包的 `vendor/echarts.min.js`）。
  - 纯本地运行，不向外部服务器上报数据；刷新不消耗 Token。
  - 必须支持浅色与深色双主题自适应（跟随 Antigravity 宿主主题切换）。
  - CDP 端口未开启时底部状态栏需静默待命，不得影响右侧辅助面板正常使用。

## Brand Commitments

- **插件名称**：`agy-context-panel`（`Context & Token Monitor` / `Token & Context`）。
- **语言规范**：界面文案以简体中文为主，代码标识、协议名及必要技术术语（如 Token、TTFT、Swarm、CDP、USD/CNY）保留原文。
- **现有资产**：插件图标 [assets/logo.svg](assets/logo.svg)、文档 [README.md](README.md)、本地图标与图表库 `src/sidecars/token-monitor/vendor/echarts.min.js`。

## Evidence on Hand

- 已有的完整实现与文档：[README.md](README.md)、[plugin.json](plugin.json)、[src/sidecars/token-monitor/index.html](src/sidecars/token-monitor/index.html)、[src/statusline/inline-bar.js](src/statusline/inline-bar.js)、[src/shared/pricing.mjs](src/shared/pricing.mjs)。
- 单元测试套件：[tests/](tests/)，涵盖语言服务器客户端、本地存储、指标计算与定价逻辑。
- **不可虚构的内容**：费用计算均为基于内置或用户配置的参考单价（`pricing.mjs`）进行的**估算值**，并非平台实际账单；在未匹配单价时必须明确提示“未配置模型单价”，不得伪造金额。

## Product Principles

1. **零打扰与零消耗**：监控本身绝不成为上下文或费用的负担，高频刷新保持轻量、静默且不消耗任何 Token。
2. **一屏可读、按需钻取**：顶部优先呈现最关键的上下文水位、速度与费用信号，明细、工具构成与子代理按需展开或钻取，不堆砌噪音。
3. **数据诚实与可追溯**：区分实际测量值与参考单价估算值；未匹配单价、无会话或 CDP 未连接等状态必须给出清晰、可操作的提示。
4. **轻量自洽、本地优先**：坚持原生 ESM + HTML 的零构建架构与纯本地数据处理，确保在本地插件目录同步后即可稳定运行。

## Accessibility & Inclusion

- 界面以简体中文为主，保留必要英文技术术语。
- 遵循基础键盘导航与语义化无障碍规范（可聚焦控件具备清晰的 `aria-label`、`aria-expanded`、`aria-pressed`、`role` 与键盘触发支持，图表与进度点阵提供文本摘要说明）。
