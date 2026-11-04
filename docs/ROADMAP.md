# 开发路线图（Linux-only）

> v0.1 唯一目标平台：**Linux（首选 Ubuntu Server 24.04 LTS）**。不考虑 Windows 或 WSL 的实现与测试。复选框按实际交付状态标记，验证工具完成不等于业务服务完成。

Issue #2：独立接入探针与故障测试已实现；原生 Ubuntu Server 24.04、独立服务账户、真实 systemd Turn 与长期认证仍待验收。见 [验证记录](validation/CODEX_LINUX_PROBE.md)。

Issue #3：Backend 基础服务、SQLite 初始 Schema/事务迁移、配置、进程测试和 systemd unit 已实现；目标主机安装与 systemd 实际验收仍需完成。该阶段前端仅预留目录，Admin 已由 #6 实现。

Issue #4：任务执行引擎、stdio Adapter、Token 管理 API、历史/事件、取消和继续 Turn 已实现；开发会话完成真实样例调用，目标服务账户的 systemd 与长期认证仍待 #2 验收。见 [引擎与 API](TASK_ENGINE.md)。

Issue #5 最初交付固定 RSS 最小链路，现已按用户要求移除 RSS 入口。当前 news-research 支持主题/初始 prompt、Codex 实时搜索、同 Thread 多轮研究及显式生成；Backend 核对原文/引文后保存待审核日报，归档仍为 #7 的独立步骤。见 [新闻研究](NEWS_PIPELINE.md) 与 [当前验证](validation/CODEX_RESEARCH.md)。

Issue #6：独立 React/Vite 本地管理后台、内存 Token 认证、任务总览/详情、手动执行、Run 历史/日志及待审核日报预览已实现。管理界面已统一为响应式浅色工作台，Run 会话/日志/运行信息分标签，设置分组；保留草稿与网络不确定时的幂等重试。使用顺序轮询，已增加任务编辑和定时计划，未实现 SSE；审核归档由 #7 增加。见 [后台说明](ADMIN.md)。

Issue #7：人工批准绑定内容哈希，GitHub 日期/频道/版本 JSON 归档、幂等核对、失败重试与 SHA 持久化已实现；真实测试分支端到端验证成功。Cloudflare/公开 Web 与 RSS 留给 #8。见 [归档说明](PUBLISHING.md)。

Issue #8：公共 React/Vite 静态首页、频道、来源详情、日期/历史版本归档、RSS 2.0 和两日期演示构建已实现；Cloudflare Pages 账户授权、HTTPS 上线及 Git 自动部署实测尚未完成，Issue 保持打开。见 [公共站](PUBLIC_WEB.md)。

## v0.1 — Linux 端到端 MVP（含最小管理后台）

### A. Linux 服务骨架
- [x] 独立 Node.js / TypeScript Codex 验证工具与无网络故障测试
- [x] 添加 Ubuntu 24.04 GitHub Actions 验证配置（Backend / 探针构建与测试；远端结果另行查看）
- [x] 初始化 Node.js + TypeScript Backend 与 React/Vite 公共 Web/Admin 代码结构
- [x] TypeScript/Fastify、共享类型和独立 Web/Admin 构建入口
- [x] 准备 Linux `.env.example`、SQLite 私有数据目录与可重复/可回滚迁移
- [ ] 验证 Linux CLI 的 `codex --version`、`codex app-server --help` 及服务账户认证
- [ ] 编写并验证 systemd 单实例服务配置，支持开机启动、故障重启、journald 日志
- [x] 建立 Ubuntu 24.04 CI：lint、typecheck、测试、构建与 unit 静态检查（实际结果查看 Actions）

### B. Codex App Server Adapter
- [x] 验证工具支持 stdio 握手、独立 Thread / Turn、终态关联和失败退出；不替代以下生产 Adapter
- [x] 由 Backend 以 stdio 启动并管理 Codex 子进程
- [x] 实现 initialize / initialized、thread/start / resume 与 Turn 生命周期
- [ ] 自动退避重试与交互式 Agent 工具审批
- [x] 完成、失败、中断、拒绝审批、超时、退出、取消与重启标记；自动重试和交互审批后续实现
- [x] 每次 Run 默认使用独立 Thread，保存 Thread / Turn ID 并支持继续当前 Run
- [x] 有限队列/并发、任务互斥、请求幂等、Token 管理 API、SQLite 历史与事件

### C. 真实新闻 → 已验证日报
- [x] 由 Codex 按用户主题实时搜索和提取公开原始来源（已移除 RSS 输入）
- [x] 同 Thread 多轮 prompt、显式最终生成及 Backend 原文/引文核对
- [x] 标准化 URL、来源、抓取时间、来源发布时间并实现最小去重
- [x] 使用受 Schema 约束的 Codex 分析输出，保留可核验的原始来源
- [x] SQLite 存储任务、Run、新闻与报告
- [x] 将人工批准的日报按日期/频道/版本输出为严格 JSON 并归档 GitHub，幂等重试无重复提交（Markdown 仍保留私有 SQLite 预览）

### D. Web / RSS 和最小管理端
- [x] 公共网站：当天日报、频道、文章详情、历史归档
- [x] RSS 2.0：全站和频道 Feed、稳定 GUID、有效 XML
- [x] **Linux 本地管理后台**：任务列表/详情、手动执行、当前状态、执行日志与日报预览
- [x] Agent 会话展示内嵌于具体 Run 详情，**不实现独立 Agent 工作台**
- [ ] GitHub 更新触发 Cloudflare Pages 构建和发布（部署作为可配置环节）
- [x] 管理员 API 只在回环地址监听，初始化管理员后以 Bearer 会话访问

### v0.1 验收标准
在 Linux 上，以非 root 服务账号启动单实例 Backend 并通过 systemd 管理：主题/多轮 prompt → Codex 实时搜索 → 原文与结构校验 → SQLite → GitHub 日报文件 → Web / RSS。可以在本地后台查看某次 Run 状态、日志及结果。失败不可误报为成功，历史日报不被覆盖。无 GUI 时能完成受控认证并有失效告警/处理方法。

## v0.2 — 管理和可靠性增强

- [ ] 任务创建、编辑 Prompt、启停及更丰富的定时规则
- [x] 新闻 Run 内多轮 prompt / Turn 回复与显式生成
- [ ] Agent 工具审批交互
- [x] 管理 API 运行历史分页与取消（UI 仍未提供取消按钮）
- [ ] SSE、更多历史过滤和自动退避重试
- [ ] 持久化调度和重启后的漏执行补偿、幂等校验
- [ ] 审稿、手工修改、重新发布、内容版本对比
- [x] Web 系统设置写入 SQLite、三项启动环境变量、首次初始化/密码登录、加密 GitHub Token
- [ ] 多用户身份与更完善的权限管理

## v0.3 — 信息质量与频道扩展

- [ ] 可配置来源与频道策略
- [ ] 跨来源事件合并、冲突事实标识、可信度规则
- [ ] 更多 RSS 模式、历史全文搜索、指标统计
- [ ] 内容质量审计、发布回滚与可靠性提升

## 后续候选能力

- 远程管理：认证 + TLS + 安全隧道（非直接暴露 App Server）
- 邮件 / IM / Webhook 推送
- Codex 研究技能和主题模板
- Docker Compose（若有实际部署需求）

## 开发约束

- Linux-only；不添加 Windows / WSL 适配。
- 不将 App Server 本身对外提供公网 RPC。
- 不将 SQLite、认证信息、日志作为 GitHub 日报提交。
- 不伪造新闻、来源、时间、互动数据。
- 不默认认为 ChatGPT 认证可无限、永久、免费无人值守使用。
- 不引入无需的微服务、重型队列或 Kubernetes。

详见 [Linux 部署设计](DEPLOY_LINUX.md) 和 [架构设计](ARCHITECTURE.md)。

管理员首次设置已简化为设置密码/确认密码两项，页面自动处理初始化请求校验；不要求终端复制码。既有密码与数据保持，回环/同源与仅首次限制继续执行。

<!-- Settings UI update -->
管理后台侧栏平级显示任务总览、模型与执行、GitHub 归档、安全设置，不再设置父级菜单；右侧单列显示当前标题与表单，窄屏导航折为顶部菜单。切换前需保存当前修改。Token 默认仅显示配置状态，点击设置或更换后才显示输入框。分支无预填值；已有配置保留。更新前端需运行 `npm run build`。

## 用户配置任务与顺序执行

任务 CRUD、手动/单次/间隔/每日/每周调度、顺序多轮 Prompt 与可选自动 GitHub 归档已接入单实例 Backend。计划和执行快照写 SQLite，重启中断旧执行且不补跑。自动授权记录与人工批准分开，外部构建部署由目标仓库集成承担。删除采用软删除保留审计，不删除数据库。API、限制与界面见 [任务管理](TASK_MANAGEMENT.md)。

管理后台移除重复页名顶栏与静态“本地管理/A”标识；每页只保留内容标题，设置表单使用侧栏外的可用宽度。运行详情保留返回任务入口。更新后台后需刷新页面加载新静态资源。

任务新增/编辑使用独立模态卡片，表单内部滚动；保存或取消返回任务列表，编辑时不在列表上方展开表单。
