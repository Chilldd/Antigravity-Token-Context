# AGENTS.md

## 产品与设计规范

- 涉及功能边界、架构约束（如零构建、零额外 Token 消耗、纯本地运行）时，先阅读 `PRODUCT.md`。
- 涉及界面调整、双主题配色、排版或组件样式时，先阅读并遵守 `DESIGN.md`；若视觉规范发生变更，同步更新 `DESIGN.md`（或运行 `/impeccable document`）。

## 修改后验证与插件同步

本项目为原生 ESM + HTML 插件，无独立的构建或打包步骤。每次修改代码（尤其是 `src/` 下的界面或服务端逻辑）后，按以下顺序完成验证与同步：

1. 执行 `npm run check && npm test`，确认语法与单元测试全部通过。
2. 执行 `npm run install:plugin`（调用 `scripts/install.ps1`），将最新代码同步到本机插件目录 `%USERPROFILE%\.gemini\config\plugins\agy-context-panel`，使插件生效。
3. 若修改了 `src/statusline/inline-bar.js`（注入到 IDE 宿主页面的状态栏脚本），需同步递增文件顶部的 `SCRIPT_VERSION`，确保已打开的页面能自动替换旧版注入脚本。
