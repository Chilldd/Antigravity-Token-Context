---
name: Context & Token Monitor
description: Precision Telemetry design system for Antigravity context, token, and cost monitoring.
colors:
  cobalt-signal: "#3b6ce7"
  cobalt-signal-fg: "#2c56c8"
  emerald-telemetry: "#0f8b6c"
  emerald-telemetry-fg: "#0b7258"
  amber-threshold: "#c9821e"
  amber-threshold-fg: "#9a5b0c"
  crimson-alert: "#cf3a3a"
  crimson-alert-fg: "#b42828"
  slate-canvas-light: "#f7f8fa"
  pure-surface-light: "#ffffff"
  mist-surface-light: "#f3f5f8"
  ink-primary-light: "#111827"
  slate-secondary-light: "#4b5563"
  slate-muted-light: "#6b7280"
  carbon-canvas-dark: "#13151a"
  carbon-surface-dark: "#1a1d24"
  carbon-elevated-dark: "#222630"
  ice-ink-dark: "#eef1f6"
  steel-muted-dark: "#8b94a5"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  xs: "5px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "12px"
  xl: "18px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt-signal}"
    textColor: "{colors.pure-surface-light}"
    rounded: "7px"
    padding: "0 8px"
    height: "26px"
  button-icon:
    backgroundColor: "{colors.pure-surface-light}"
    textColor: "{colors.slate-muted-light}"
    rounded: "7px"
    padding: "0 8px"
    height: "26px"
  segmented-control:
    backgroundColor: "#eef0f4"
    textColor: "{colors.slate-muted-light}"
    rounded: "{rounded.md}"
    padding: "2px"
  card-surface:
    backgroundColor: "{colors.pure-surface-light}"
    textColor: "{colors.ink-primary-light}"
    rounded: "{rounded.lg}"
    padding: "11px 12px"
  pill-badge:
    backgroundColor: "{colors.pure-surface-light}"
    textColor: "{colors.ink-primary-light}"
    rounded: "{rounded.pill}"
    padding: "3px 9px 3px 7px"
  input-field:
    backgroundColor: "{colors.slate-canvas-light}"
    textColor: "{colors.ink-primary-light}"
    rounded: "{rounded.sm}"
    padding: "0 7px"
    height: "26px"
---

# Design System: Context & Token Monitor

## Overview

**Creative North Star: "Precision Telemetry"**

本系统是一套面向 IDE 侧边栏与内嵌状态栏的精密遥测仪表盘设计语言。它以冷静、高信息密度和极低视觉噪音为核心诉求，让开发者在编码与长对话过程中，无需切出当前工作流即可一眼判断上下文水位、生成速度、缓存命中率与估算费用。

系统天然服务于「操作与监控（Operate）」场景，拒绝装饰性渐变、大面积重阴影或与宿主 IDE 割裂的视觉风格。通过中性冷灰白（浅色模式）与深碳灰（深色模式）画布承托高对比的等宽数字与信号色，所有交互反馈保持克制、紧凑且可预测。

**Key Characteristics:**
- **双主题自适应**：通过 CSS 变量自动跟随 Antigravity 宿主主题（`:root.light-surface` / `:root.dark-surface` / `prefers-color-scheme: dark`）。
- **数字优先排版**：所有指标、百分比、耗时与金额强制启用 `tabular-nums` 等宽数字对齐，数值单位以缩小的次级字号紧随其后。
- **极细发丝分隔**：优先使用低透明度的 1px 线框与 `1px` 内嵌网格间隙建立结构，替代厚重阴影或高饱和色块。
- **信号色克制使用**：主色钴蓝与状态色（翠绿、琥珀、绯红）仅用于关键水位告警、进度指示与激活焦点，日常界面保持中性克制。

## Colors

以冷静的中性冷灰白（浅色）与深碳灰（深色）为基底，搭配精准的钴蓝主信号色和语义状态色，确保长时阅读不疲劳且告警层级分明。

### Primary
- **Cobalt Signal** (`#3b6ce7` 浅色 / `#6b93f2` 深色): 用于主按钮填充、激活状态边框、焦点高亮圈以及图表输入系列主色。文本前景对应 **Cobalt Signal FG** (`#2c56c8` / `#8cb0f8`)。

### Neutral
- **Slate Canvas** (`#f7f8fa` 浅色 / `#13151a` 深色): 页面最底层画布背景（浅色模式下与宿主 `--background` 按 97% 混合微调）。
- **Pure / Carbon Surface** (`#ffffff` 浅色 / `#1a1d24` 深色): 卡片、胶囊徽章与分段滑块的基础表面。
- **Mist / Elevated Surface** (`#f3f5f8` 浅色 / `#222630` 深色): 卡片悬停态、配置规则子卡片与次级分组底色。
- **Primary Ink** (`#111827` 浅色 / `#eef1f6` 深色): 主标题、核心 KPI 数值与正文主文字。
- **Muted Slate** (`#6b7280` 浅色 / `#8b94a5` 深色): 辅助说明、指标标签、图例与次级时间戳。
- **Hairline Divider** (`rgba(15, 23, 42, 0.08)` 浅色 / `rgba(255, 255, 255, 0.085)` 深色): 卡片外边框与分组边界。

### Semantic & Data Visualization
- **Emerald Telemetry** (`#0f8b6c` / `#2cb593`，文本 `#0b7258` / `#4fd1af`): 用于正常运行圆点、生成速度、缓存节省金额与配置保存成功提示。
- **Amber Threshold** (`#c9821e` / `#e0a043`，文本 `#9a5b0c` / `#f0b95e`): 用于上下文占用达到 75% 以上的警告横幅、低额度提示以及费用柱状图。
- **Crimson Alert** (`#cf3a3a` / `#e46464`，文本 `#b42828` / `#f28484`): 用于上下文达 90% 以上的严重告警、错误横幅与删除操作悬停态。
- **Data Series**: 矩形树图采用「柔和浅底 + 清晰边框 + 高对比前景色 + 强调色」四元组（覆盖 `command`、`file_read`、`file_edit`、`search`、`model`、`agent`、`other` 七类）；100 点上下文网格与 Swarm 团队分布复用低饱和语义色板。

### Named Rules
**The Signal Restraint Rule.** 语义色（钴蓝、翠绿、琥珀、绯红）仅承载状态、告警与数据区分职责；普通卡片、导航与容器背景严禁大面积铺设高饱和彩色。
**The Host-Adaptive Dual Theme Rule.** 所有颜色必须通过 CSS 自定义属性声明并同时定义浅色与深色两套映射，禁止在组件样式或脚本内硬编码单主题色值。

## Typography

**Display & Body Font:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`
**Numeric Style:** 全局 `.num` 类启用 `font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;`

**Character:** 零外部字体加载开销，直接复用操作系统原生无衬线字体栈以保证中英文混排清晰锐利；通过字号反差、字重对比与等宽数字对齐营造精密仪器的阅读秩序。

### Hierarchy
- **Display** (`700`, `26px`, `line-height: 1.1`, `letter-spacing: -0.03em`): 仅用于上下文 Hero 卡片的已用 Token 主数值（`.hero-used`）。
- **Headline** (`700`, `19px`, `line-height: 1.25`, `letter-spacing: -0.025em`): 用于 Bento 网格中的核心 KPI 数值（速度、命中率、累计输入输出、估算费用）。
- **Title** (`600`, `11.5px`–`12px`, `line-height: 1.4`, `letter-spacing: -0.005em`): 用于卡片标题、图表标题与顶部会话标题。
- **Body** (`400`, `12.5px`, `line-height: 1.45`): 全局基础字号与常规说明文本。
- **Label** (`500`–`600`, `10.5px`–`11px`, `line-height: 1.4`): 用于指标头标签、次级副标题、角标、胶囊文本与分页提示。

### Named Rules
**The Tabular Numerals Rule.** 凡涉及动态刷新的 Token 数、百分比、速度、耗时与金额，必须挂载 `.num`（`tabular-nums`），防止 2.5s 自动刷新时数字抖动。
**The Subordinate Unit Rule.** 数值单位（`k`、`M`、`tok/s`）与货币前缀（`$`、`¥`）通过 `.val-unit`（`0.64em`）和 `.val-prefix`（`0.74em`）缩小并降低权重，突出核心数字。

## Layout

面板针对窄幅侧边栏（`main` 内边距 `10px 12px 18px`）优化，采用单列垂直流与紧凑网格组合：

- **顶部控制栏**：两行紧凑排布——首行左侧为一级分段标签（当前会话 / 全局汇总），右侧为图标操作按钮（刷新、单价设置）；次行在汇总模式下承载时间范围与维度/币种过滤条。
- **Hero 上下文分布卡片**：顶部标签与百分比胶囊 → 大号已用/上限数字 → 条件告警横幅 → 20 列 × 5 行（`max-width: 320px`，`gap: 4px`）的 100 点阵 → 可展开的分类明细列表。
- **Bento KPI 网格**：2 列等宽网格（`grid-template-columns: repeat(2, minmax(0, 1fr))`），以 `gap: 1px` 配合背景 `--line-subtle` 形成极细内分割线；全宽扩展指标（如「估算费用」）通过 `grid-column: 1 / -1` 横跨两列。
- **可折叠明细卡片**：工具构成、Swarm 团队、子代理列表与调用明细均采用统一折叠头 + 列表项结构，默认控制首屏高度，按需展开。
- **底部状态栏（CDP 胶囊）**：嵌入宿主输入框底部工具栏，高度严格锁定 `22px`，横向 `inline-flex` 贴合宿主工具栏节奏，浮层向上弹出。

## Elevation & Depth

本系统采用 **默认扁平 + 极细发丝边框（Flat-by-default & Hairline-layered）** 策略，几乎不使用大面积投影，而是靠 `1px` 低透明度边框与背景明度微差建立前后层次。

### Shadow Vocabulary
- **Card Resting Shadow** (`box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03), 0 0 0 1px rgba(15, 23, 42, 0.015)` 浅色 / `0 1px 2px rgba(0, 0, 0, 0.24)` 深色): 仅用于主卡片的极微弱托底。
- **Segmented Active Thumb** (`box-shadow: 0 1px 2px rgba(15, 23, 42, 0.07), 0 0 0 0.5px rgba(15, 23, 42, 0.05)` 浅色 / `0 1px 2px rgba(0, 0, 0, 0.30)` 深色): 用于分段控制器滑块，使其微微浮起于凹槽之上。
- **Floating Tooltip / Popover** (`box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 12px 24px -6px rgba(15, 23, 42, 0.10)` 浅色 / `0 6px 18px rgba(0, 0, 0, 0.45)` 深色): 仅用于悬停浮层与图表 Tooltip。

### Named Rules
**The Hairline Divider Rule.** 优先使用 `1px` 低透明度边框（`--line` / `--line-subtle`）和 Bento `1px` 网格间隙划分区域，禁止在常规卡片上叠加重阴影。

## Shapes

圆角随容器层级递减，保持紧凑且一致的几何秩序：

- **主卡片与容器**（Hero、Bento、图表卡片、折叠列表）：柔和圆角（`10px` radius）。
- **分段控制器外框与内部提示条**（`.seg-bar`、告警横幅、返回条、规则子卡片）：中等圆角（`8px` radius）。
- **按钮与输入框**（`.icon-btn`、`.field-input`、分段滑块）：紧凑小圆角（`6px`–`7px` radius）。
- **微型按钮与幽灵选项**（`.ghost-btn`、展开按钮）：微圆角（`5px` radius）。
- **状态徽章与底部胶囊**（`.model-badge`、`.pct-pill`、`.state-pill`、CDP 胶囊、圆点）：全圆角胶囊或正圆（`999px` / `50%`）。

## Components

组件追求紧凑干脆的手感，所有可点击控件在 `:active` 时统一有轻微按压缩放（`transform: scale(0.97)`），并在 `:focus-visible` 时提供清晰的焦距环。

### Buttons
- **Shape:** 紧凑圆角（`7px` radius），图标与文本居中对齐（`gap: 4px`）。
- **Primary:** 实心钴蓝背景（`--accent`）配纯白加粗文字，高度 `26px`，内边距 `0 8px`，悬停时背景微暗（`color-mix` 混入 12% 黑色）。
- **Secondary / Icon Button:** 卡片表面底色配 `1px` 边框（`--line`），文字为 `--dim`；悬停时切至 `--surface-subtle` 并加深边框（`--line-strong`）；激活态切为 `--accent-bg` 与 `--accent-fg`。
- **Ghost Toggle:** 无边框透明底（`5px` radius，`3px 6px` 内边距），用于工具栏次级筛选与币种切换，配合滑动指示块（`.ghost-thumb`）实现平滑切换。

### Navigation (Segmented Control)
- **Style:** 凹槽底色（`--seg-bg`）配合 `1px` 微边框与 `2px` 内边距（`8px` radius）；内部滑动高亮块（`.seg-thumb`）使用 `--seg-active-bg` 与微阴影，采用 `cubic-bezier(0.22, 1, 0.36, 1)` 弹性缓动跟随激活项。

### Cards / Containers
- **Corner Style:** 统一 `10px` 圆角（`.hero`、`.bento`、`.chart-card`、`.sub-card`、`.settings-card`）。
- **Background & Border:** `--surface` 底色 + `1px solid var(--line)` + 极轻 `Card Resting Shadow`。
- **Internal Padding:** 常规卡片 `11px 12px`；列表行项 `8px 12px`（行间以 `--line-subtle` 分隔，最后一行去底边）。

### Inputs / Fields
- **Style:** `26px` 高度（设置网格内紧凑态为 `24px`），`6px` 圆角，使用画布底色（`--bg-canvas`）与 `1px solid var(--line)` 形成轻微内凹感，内边距 `0 7px`。
- **Focus:** `outline: 1.5px solid var(--accent); border-color: var(--accent);` 明确标示当前输入焦点。

### Chips & Status Pills
- **Style:** 全圆角胶囊（`999px`），`1px` 语义边框配合低透明度语义底色（如 `.pct-pill.tone-warn` 使用 `--warn-bg` + `--warn-border` + `--warn-fg`）；模型徽章左侧带 `6px` 状态圆点，运行态带 `pulse` 呼吸动画。

### Signature Component: 100-Dot Context Matrix & Inline Capsules
- **100-Dot Matrix:** 20 列 × 5 行正圆点阵，每点代表上下文窗口的 `1%`，支持入场交错缩放动画（`dotIn`）及与下方分类列表的双向悬停高亮联动（未匹配点降为 `opacity: 0.22`，匹配点放大至 `scale(1.22)`）。
- **Inline Status Capsules (CDP):** 高度 `22px` 的全圆角微胶囊，直接融入宿主输入框底部工具栏；左侧为带 SVG 环形进度条的上下文胶囊（高水位自动露出 `/compact` 快捷按钮），右侧为独立的 Gemini `5h / 7d` 额度胶囊，均支持悬停预览与点击固定独立详情浮层。

## Do's and Don'ts

### Do:
- **Do** 为所有动态数字、金额、百分比与耗时添加 `.num`（`tabular-nums`），保持刷新时的视觉稳定。
- **Do** 严格成对维护浅色与深色两套 CSS 变量，确保主题切换时对比度与语义清晰度一致。
- **Do** 在窄侧边栏中控制标签与标题的单行溢出（`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`），并配合 `title` 提供完整文本。
- **Do** 对可折叠区域、分段控件与异步加载提供平滑过渡（如等高骨架屏交叉淡入、滑块平移动画），并在 `prefers-reduced-motion: reduce` 下尊重系统减弱动画设置。

### Don't:
- **Don't** 在卡片或组件上使用重度弥散阴影、炫彩渐变背景或大面积高饱和色块，破坏精密遥测的冷静感。
- **Don't** 引入需要打包构建的 CSS 框架或外部字体 CDN；所有样式与图标保持原生、轻量、离线可用。
- **Don't** 在单价未命中或数据缺失时显示虚假金额或静默空白，必须给出明确的“未配置模型单价”或空状态引导。
- **Don't** 让顶部或底部状态栏在未开启 CDP 或无会话时阻塞主界面或报错刷屏。
