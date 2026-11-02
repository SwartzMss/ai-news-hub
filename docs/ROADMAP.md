# 开发路线图（Linux-only）

> v0.1 唯一目标平台：**Linux（首选 Ubuntu Server 24.04 LTS）**。不考虑 Windows 或 WSL 的实现与测试。复选框按实际交付状态标记，验证工具完成不等于业务服务完成。

Issue #2：独立接入探针与故障测试已实现；原生 Ubuntu Server 24.04、独立服务账户、真实 systemd Turn 与长期认证仍待验收。见 [验证记录](validation/CODEX_LINUX_PROBE.md)。

## v0.1 — Linux 端到端 MVP（含最小管理后台）

### A. Linux 服务骨架
- [x] 独立 Node.js / TypeScript Codex 验证工具与无网络故障测试
- [x] 添加 Ubuntu 24.04 GitHub Actions 验证配置（仅探针构建/测试；远端结果另行查看）
- [ ] 在 Linux 上初始化 Node.js + TypeScript Backend、React + Vite 的公共 Web 与 Admin 基础结构
- [ ] 准备 Linux `.env.example`、SQLite 数据目录和数据库迁移方案
- [ ] 验证 Linux CLI 的 `codex --version`、`codex app-server --help` 及服务账户认证
- [ ] 编写并验证 systemd 单实例服务配置，支持开机启动、故障重启、journald 日志
- [ ] 建立 Linux CI 测试与基础构建流程

### B. Codex App Server Adapter
- [x] 验证工具支持 stdio 握手、独立 Thread / Turn、终态关联和失败退出；不替代以下生产 Adapter
- [ ] 由 Backend 以 stdio 启动并管理 Codex 子进程
- [ ] 实现 initialize / initialized 及 Thread / Turn 生命周期
- [ ] 正确处理完成、失败、中断、审批、超时、子进程退出及重试
- [ ] 每次 Run 默认使用独立 Thread，保存 Thread / Turn ID 并支持继续当前 Run

### C. 真实新闻 → 已验证日报
- [ ] 采集至少一个合法可访问的 RSS 真实来源
- [ ] 标准化 URL、来源、抓取时间、来源发布时间并实现最小去重
- [ ] 使用受 Schema 约束的 Codex 分析输出，保留可核验的原始来源
- [ ] SQLite 存储任务、Run、新闻与报告
- [ ] 将日报按日期输出为 JSON / Markdown，仅在校验通过后推送 GitHub（防止重复发布）

### D. Web / RSS 和最小管理端
- [ ] 公共网站：当天日报、频道、文章详情、历史归档
- [ ] RSS 2.0：全站和频道 Feed、稳定 GUID、有效 XML
- [ ] **Linux 本地管理后台**：任务列表/详情、手动执行、当前状态、执行日志与日报预览
- [ ] Agent 会话展示内嵌于具体 Run 详情，**不实现独立 Agent 工作台**
- [ ] GitHub 更新触发 Cloudflare Pages 构建和发布（部署作为可配置环节）
- [ ] 默认管理员 API 只在 localhost 监听，不对公网裸露

### v0.1 验收标准
在 Linux 上，以非 root 服务账号启动单实例 Backend 并通过 systemd 管理：真实 RSS → Codex App Server → 结构化校验 → SQLite → GitHub 日报文件 → Web / RSS。可以在本地后台查看某次 Run 状态、日志及结果。失败不可误报为成功，历史日报不被覆盖。无 GUI 时能完成受控认证并有失效告警/处理方法。

## v0.2 — 管理和可靠性增强

- [ ] 任务创建、编辑 Prompt、启停及更丰富的定时规则
- [ ] Run 内的多轮 Turn 输入/回复与工具审批交互
- [ ] SSE 实时事件、运行历史过滤、取消和退避重试
- [ ] 持久化调度和重启后的漏执行补偿、幂等校验
- [ ] 审稿、手工修改、重新发布、内容版本对比
- [ ] 配置管理与更完善的后台身份验证

## v0.3 — 信息质量与频道扩展

- [ ] 可配置来源与频道策略
- [ ] 跨来源事件合并、冲突事实标识、可信度规则
- [ ] 更多 RSS 模式、历史全文搜索、指标统计
- [ ] 内容质量审计、发布回滚与可靠性提升

## 后续候选能力

- 远程管理：认证 + TLS + 安全隧道（非直接暴露 App Server）
- 邮件 / IM / Webhook 推送
- 更多内容采集器、技能和主题模板
- Docker Compose（若有实际部署需求）

## 开发约束

- Linux-only；不添加 Windows / WSL 适配。
- 不将 App Server 本身对外提供公网 RPC。
- 不将 SQLite、认证信息、日志作为 GitHub 日报提交。
- 不伪造新闻、来源、时间、互动数据。
- 不默认认为 ChatGPT 认证可无限、永久、免费无人值守使用。
- 不引入无需的微服务、重型队列或 Kubernetes。

详见 [Linux 部署设计](DEPLOY_LINUX.md) 和 [架构设计](ARCHITECTURE.md)。
