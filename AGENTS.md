# AGENTS.md

本仓库为 **AI News Hub**，当前只有文档和独立 HTML 交互原型，尚无可运行的真实新闻服务。

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
