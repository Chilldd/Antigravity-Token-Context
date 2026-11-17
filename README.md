# Context & Token Monitor (`agy-context-panel`)

为 Antigravity 2.0 提供实时的上下文窗口与 Token 性能监控插件，支持**右侧辅助面板**与**对话框底部紧凑状态栏（CDP）**两种展示方式，刷新不额外消耗 Token。

## 功能特性

- **右侧辅助面板（`Token & Context`）**
  - **上下文窗口占用**：实时展示当前已用上下文、模型最大上限、占比进度条及剩余可用空间。
  - **生成速度与延迟**：基于服务端流式耗时与首字延迟，统计最新与平均生成速度（`tok/s`）及 TTFT。
  - **缓存命中率**：计算累计与最新一轮缓存命中率，直观展示通过缓存复用的输入 Token。
  - **输入 / 输出明细**：拆分新输入（Uncached）与缓存读取（Cache Read），输出拆分思考（Thinking）与正文（Response）。
  - **最近调用明细与会话切换**：展示近 12 次模型调用记录，支持切换查看其他活跃/历史会话。
- **对话框底部状态栏（`statusline`，需开启 CDP）**
  - 在输入框底部工具栏嵌入环形进度小圆圈（上下文占用百分比）、最新生成速度（`tok/s`）与交互总 Token 量。
  - 鼠标悬停时弹出详情浮层，查看完整上下文、速度、TTFT、缓存命中率及输入输出拆分。
  - 同一窗口切换会话或新建对话时自动保持挂载；未开启 CDP 端口时静默待命，不影响右侧面板使用。

## 启用底部状态栏（CDP）

在启动 Antigravity 时附加远程调试端口参数（仅监听本机回环地址），例如：

```bat
Antigravity.exe --remote-debugging-port=9223 --remote-debugging-address=127.0.0.1 --remote-allow-origins=*
```

> 状态栏会自动探测 `9223`、`9222`、`9224`、`9225` 端口并识别 Antigravity 主窗口；如需指定其他端口，可设置环境变量 `ANTIGRAVITY_CDP_PORT`。

### 推荐方式：使用启动脚本 + 快捷方式（同时配置代理与 CDP，免开 TUN 模式）

在 Windows 下可以创建一个 `.cmd` 启动脚本，顺便注入本地代理环境变量（注意将 `localhost,127.0.0.1,::1` 加入 `NO_PROXY`，避免本地 CDP 与语言服务器通信走代理），并附加 CDP 启动参数：

1. 新建启动脚本（例如 `Start-Antigravity.cmd`，按需将 `7897` 改为你的本地代理端口）：

```bat
@echo off
setlocal
set "APP=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%APP%" (
    echo Antigravity.exe was not found: %APP%
    pause
    exit /b 1
)
set "HTTP_PROXY=http://127.0.0.1:7897"
set "HTTPS_PROXY=http://127.0.0.1:7897"
set "ALL_PROXY=http://127.0.0.1:7897"
set "NO_PROXY=localhost,127.0.0.1,::1,%NO_PROXY%"
start "" "%APP%" --remote-debugging-port=9223 --remote-debugging-address=127.0.0.1 --remote-allow-origins=*
endlocal
```

2. 为该脚本创建桌面快捷方式（保留原版 Antigravity 图标）：
   - 右键 `Start-Antigravity.cmd` -> **发送到 -> 桌面快捷方式**，或用 PowerShell 一键创建（把路径替换为你的脚本实际路径）：

```powershell
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Antigravity.lnk")
$Shortcut.TargetPath = "D:\Scripts\GoogleProxy\Start-Antigravity.cmd"
$Shortcut.WorkingDirectory = "D:\Scripts\GoogleProxy"
$Shortcut.IconLocation = "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe,0"
$Shortcut.Save()
```

之后直接双击该快捷方式启动 Antigravity，即可同时生效代理与底部状态栏。

## 目录结构

```text
agy-context-panel/
├── plugin.json                     # 插件元数据
├── package.json                    # 开发检查、测试与安装脚本
├── assets/logo.svg                 # 插件图标
├── scripts/install.ps1             # 同步插件到 ~/.gemini/config/plugins/
├── src/
│   ├── shared/                     # 通用模块（右侧面板与底部状态栏共用）
│   │   ├── ls-client.mjs           # LanguageServerService RPC 与模型目录缓存
│   │   ├── local-store.mjs         # 本地 SQLite 全局索引与全量跨工作区统计
│   │   └── metrics.mjs             # 上下文、Token、缓存命中率与速度计算
│   ├── sidecars/token-monitor/     # 右侧辅助面板（Sidecar 服务、页面与本地 ECharts）
│   └── statusline/                 # 底部状态栏（CDP 客户端与浏览器注入脚本）
└── tests/                          # 单元测试
```

## 开发与安装

- **语法检查**：`npm run check`
- **运行测试**：`npm test`
- **安装 / 同步插件**：`npm run install:plugin`（复制到 `C:\Users\<user>\.gemini\config\plugins\agy-context-panel`）

> 修改插件后若后台 sidecar 已在运行，可在 Antigravity 插件管理页关闭再重新开启一次 `agy-context-panel` 生效。
