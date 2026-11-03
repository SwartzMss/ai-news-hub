# AGENTS.md

本仓库为 **AI News Hub**，当前包含 Fastify / SQLite 任务引擎、Codex 接入探针及实际 Web/Admin 页面。新闻入口是用户主题与多轮 prompt，由 Codex 实时搜索、提取和整理，显式生成后 Backend 核对原文并保存 SQLite 待审核日报；不采集外部 RSS。React/Vite 管理后台支持研究、人工批准和 GitHub 归档；公共静态阅读站与输出 RSS 可独立构建，Cloudflare 真实上线待验收。

## 当前工程结构与检查

- 根目录统一管理 Node.js 22 / TypeScript 依赖；`apps/server/src` 为 Backend，`packages/shared/src` 为共享类型与 Agent 环境白名单。
- `apps/web` 为独立静态公共站（见 `docs/PUBLIC_WEB.md`），源码构建器在 `generator/`，唯一公开输出 `dist/web`；`apps/admin` 为独立 React/Vite 后台，经 Backend `/admin/` 提供，仅页面内存保存 Token。见 `docs/ADMIN.md`。
- 运行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`；测试不调用真实 Codex，但会启动回环 HTTP 子进程；`npm test` 包含 Backend、Admin 交互与公共站构建测试，构建产物分别为 `dist/apps/server` 与 `dist/admin`。
- Backend 提供公开 `/health` 与 Bearer Token 保护的 `/api` 任务/Run 接口；未配置管理 Token 时 `/api` 关闭。接口见 `docs/TASK_ENGINE.md`。
- 新闻任务 `news-research` 接受 topic/input，支持同 Thread 多轮 prompt 和显式 finalize。旧 `news-github` 停用，仅保留历史查询。接口见 `docs/NEWS_PIPELINE.md`；来源引文校验不等于事实审核，不自动发布。人工批准与 GitHub 归档见 `docs/PUBLISHING.md`，凭据不能传给 Codex。
- 新闻 Thread 仅允许 hosted web search，逐个禁用继承的 MCP，禁用 Shell/委派，审批仍全部拒绝。最终来源验证只接受公网 HTTPS、DNS 固定连接，无代理/凭据/重定向；不将搜索入口改回 RSS。
- 启动自动迁移，也可 `npm run db:migrate`。配置见 `.env.example`，数据模型见 `docs/DATA_MODEL.md`。
- 每个 Turn 使用独立 stdio App Server 子进程，新 Run 新建 Thread，继续 Turn 恢复原 Thread；不将 Backend 管理/发布凭据继承给 Agent。
- 每个数据目录只允许一个 Backend；重启将未完成 Run / Turn 标为 interrupted，不自动重跑。Agent 工具审批一律拒绝并失败退出，交互式工具审批暂未实现；日报人工批准是独立业务操作。
- SQLite 迁移只追加新版本，不修改已应用 SQL；历史 checksum 不符必须失败，不删除数据库规避错误。
- 不将代理配置、凭据、SQLite 或本地验证日志入库；不要创建 `docs/superpowers/` 工作流文档。

## v0.1 不可更改的决策

1. **Linux-only**：以 Ubuntu Server 24.04 LTS 为主要开发、测试和部署环境。不要为 v0.1 添加 Windows / PowerShell / WSL 支持、路径处理或安装说明。
2. **服务端模型**：Linux 单实例 Node.js / TypeScript Backend 由 systemd 管理；Backend 以 stdio 子进程启动 `codex app-server`，通过 JSON-RPC 管理 Thread / Turn 与审批事件，不直接开放 Agent 网络端口。
3. **任务为中心**：Task → Run → Thread → Turn。Agent 对话、事件、审批与结果都属于具体 Run / Task，不实现独立一级「Agent 工作台」。
4. **两类前端**：公共新闻阅读站（静态 Web + RSS）与受保护的管理后台（Linux Backend 提供 API，默认只绑定 localhost）。v0.1 要有最小的任务状态、手动触发、执行日志及结果查看界面。
5. **数据边界**：SQLite 放在 Linux 持久化数据目录（例如 `/var/lib/ai-news-hub`）；GitHub 只归档审核/校验通过的日报 JSON/Markdown；Cloudflare Pages 只负责公开静态站点与 RSS。
6. **来源真实**：原文 URL、原始发布时间、事件时间、抓取时间要分开存储，区分事实、观点和未证实内容；无有效来源禁止自动发布。
7. **安全优先**：非 root 运行、最小权限；凭据及 SQLite 不入 Git；管理 API 不默认暴露公网；正确处理 Agent 工具审批与配额、登录过期及进程重启。
8. **逐步实现**：先通 v0.1 Linux 端到端闭环，避免过早引入 Kubernetes、微服务或消息队列。不要把设计稿/计划描述为已经实现。
9. **保持一致**：代码或架构调整同步更新 README、docs/ARCHITECTURE.md、docs/ROADMAP.md、docs/DEPLOY_LINUX.md 及关联 Issue。
10. **许可证**：目前尚未选择，不擅自添加 LICENSE。

## 参考文档

- [README.md](README.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/DEPLOY_LINUX.md](docs/DEPLOY_LINUX.md)
- [docs/UI_DESIGN_SPEC.md](docs/UI_DESIGN_SPEC.md)
