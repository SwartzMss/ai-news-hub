# 架构设计（草案）

> 包含已实现的基础骨架与 v0.1 目标架构；各模块的实现范围如下，不能将目标链路理解为已经上线。

Issue #3 实现 Fastify / SQLite 基础；Issue #4 增加 Task → Run → Thread → Turn 引擎、受保护管理 API、stdio Adapter、持久化事件与重启恢复标记。Issue #5 增加固定真实 RSS 采集、最小去重、结构化分析与待审核日报；尚无定时调度、审核操作或发布。
Issue #2 的独立 TypeScript 接入探针（`tools/codex-probe/`）继续用于诊断，正式 Adapter 位于 `apps/server/src/agent/`。
探针的 systemd unit 与正式 Backend 分开，实际证据与未完成验收见 [验证记录](validation/CODEX_LINUX_PROBE.md)。

## 1. 系统边界

本项目 v0.1 采用“**Linux 服务端执行 + GitHub 持久归档 + 静态公开发布**”模式。不支持 Windows / WSL 作为部署目标。

```text
┌───────────────────── Linux Host (systemd service, non-root user) ─────────────────────┐
│ Scheduler → Collector → Normalize/Deduplicate → Job Queue    │
│                                                 │             │
│                                           Agent Adapter       │
│                                                 │ JSON-RPC    │
│                                          Codex App Server     │
│                                                 │             │
│                                       Structured Result       │
│                                                 │             │
│ SQLite ← Validation / Review / Publish Service ←─┘            │
│                                │                              │
│                                ├── Web Admin + SSE            │
│                                └── Static Export              │
└────────────────────────────────┼──────────────────────────────┘
                                 │ 按日期提交已审核 JSON/Markdown
                                 ▼
                          GitHub repository
                                 │ 自动构建 / 部署
                                 ▼
                         Cloudflare Pages / CDN
                          ├── Web Pages
                          ├── RSS 2.0
                          └── JSON
```

## 2. 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| Collector | 拉取合法访问的 RSS / 网站 / API，记录来源 | 凭空生成新闻 |
| Normalizer | 时间、链接、频道和文本格式标准化 | 用 AI 结果覆盖原文 |
| Deduplicator | 基于 canonical URL、内容指纹与事件相关性去重 | 未经核验就合并冲突事实 |
| Scheduler | 定时、入队、并发限制、重试 | 直接执行 Agent 内部动作 |
| Codex Adapter | 管理子进程、JSON-RPC、Thread/Turn 和事件 | 暴露原生 RPC 给公共互联网 |
| Analyzer | 分类、重要性评分、摘要、观点与影响分析 | 把推测伪装成新闻事实 |
| Publisher | 校验、版本化、导出 Web / RSS / JSON | 无来源发布 |
| Admin API | 任务配置、权限、审阅、运行历史 | 向匿名用户提供管理操作 |

### 为什么不让 Codex 负责全部环节？

采集、调度、重试、存储和发布必须具备可测试的确定性。Codex 主要用于跨来源综合、事实冲突提示、摘要、中文分析以及需要工具调用的研究任务。

## 3. Codex App Server 生命周期

1. Linux 的 systemd 管理 Node.js Backend，Backend 在与其相同的非 root 服务账户下启动 `codex app-server --listen stdio://` 子进程。
2. 与进程进行初始化握手（`initialize`，随后 `initialized`）。
3. 为任务创建或恢复 Thread（`thread/start` / `thread/resume`）。
4. 使用 `turn/start` 提交任务，处理事件、工具审批和取消请求。
5. **仅在 `turn/completed` 且最终状态成功时**将分析任务标记为完成。
6. 保存 Thread / Turn 标识、必要日志及产物引用。
7. 进程退出或协议错误时标记任务失败并允许安全重试，不默默当作成功。

注意：App Server 的协议与可用功能可能随版本演化，应放在独立 Adapter 内隔离。Agent 的认证与使用限额依赖实际安装与账户配置，不能将 ChatGPT 套餐视为无限制公共 API。

### 独立探针边界

- `client.ts`：按行解析 stdio，初始化后读取账户状态；每次 Run 新建只读 Thread，再启动固定提示词 Turn。仅匹配 Thread / Turn 的成功终态和预期输出算通过。
- `cli.ts`：拒绝 root 和非 Linux 运行；设置总超时，响应 SIGTERM / SIGINT；JSON 日志仅保留 Run / Thread / Turn、阶段、错误类别及时间，不转发原始 RPC 或 stderr。
- 服务器主动请求（包括审批）一律拒绝并失败退出；不为无人值守请求自动授权。此探针没有交互审批 UI。
- 结束时关闭 stdio，回收独立进程组，发送 SIGTERM，必要时发送 SIGKILL；清理等待上限 2.5 秒，超限报告 `cleanup_failed`。systemd 以 `KillMode=control-group` 兜底。不会自动续跑失败 Run。
- 探针本身不持久化业务历史，不提供 Run 继续；正式引擎的历史与恢复语义见下节。

### 已实现的任务执行引擎

- `tasks/engine.ts` 管理有限内存队列、并发、任务互斥、幂等和超时。每个 Turn 启动一个 `codex app-server --listen stdio://`，依次握手、读取账户、创建/恢复 Thread、启动 Turn；退出后回收进程组。
- Run 的 Thread 不可换成其他 Thread；`run_threads` 的唯一约束阻止不同 Run 共用 Thread。每个 Turn 单独保存本地记录 ID 与服务器 Turn ID，Run 状态反映最近一次 Turn，旧 Turn 终态和输出保留。
- 仅匹配 Thread / Turn 的 `turn/completed`、状态 completed 且有非空回复时成功；失败、打断、空结果、退出和审批拒绝均非成功。子进程回收不确定时引擎停止调度，正式进程非零退出，由 systemd 清理控制组并恢复服务。
- 新请求通过 `/api` Bearer Token 认证；Token 未配置时管理 API 关闭，`/health` 保持公开。Token、请求体/头部与原始 RPC/stderr 不进入 journald；有大小限制的输入、Agent 正文和事件仅存私有 SQLite，供授权查询。
- Codex 使用环境允许列表，保留运行环境、代理与模型认证，不继承 Backend 管理或 GitHub/Cloudflare 发布凭据。工作目录私有；Thread 采用 read-only sandbox / untrusted 审批策略，所有服务器主动请求拒绝，不提供审批自动授权。
- 同一数据目录以事务记录 PID、进程启动时间与系统 boot ID，阻止第二个 Backend 误恢复活跃任务；启动时旧的 queued/running/waiting_approval Run / Turn 标为 interrupted，不自动重跑。任务定义和历史均保留。

完整接口、状态与配额限制见 [任务引擎](TASK_ENGINE.md)，实测边界见 [验证记录](validation/TASK_ENGINE.md)。

## 4. 数据模型与基础服务

已实现的初始 Schema 为 `tasks`、`task_runs`、`articles`、`reports`、`report_articles`、`publication_records` 与内部 `schema_migrations`。原草案的 `jobs` / `job_runs` 分别统一为 `tasks` / `task_runs`。
迁移 2 追加 `run_threads`、`run_turns`、`run_events`、`backend_owner`；迁移 1 的 SQL 不变。Task / Run 提供手动执行和历史查询，迁移 3 追加 RSS 来源/身份/缓存与新闻 Run 快照表，并启用文章及日报查询。字段、外键、状态及迁移规则详见 [数据模型](DATA_MODEL.md)。

`openDatabase` 检查专用数据目录与数据库权限，开启外键、WAL 与 5 秒 busy timeout。启动时在事务内核对迁移历史并应用新版本，校验失败或 SQL 失败则启动失败；不自动重建或清空旧数据库。
SQLite 使用 Node 22 内置实验性 `node:sqlite`，当前同步访问用于初始化、状态与有限事件事务。未来业务需按实际负载评估，暂不增加 ORM 或独立数据库服务。

Fastify 只允许绑定 `127.0.0.1` / `::1`；`/health` 检查已应用 Schema 可读，失败返回 503，不检测 Codex 认证。统一错误体保留 requestId，日志不记录请求体、头部、查询串或任意异常文本。
SIGTERM / SIGINT 关闭 HTTP 与数据库，8 秒超时退出；systemd 用 15 秒停止上限与整个控制组回收兜底。`apps/web` / `apps/admin` 当前仅有职责说明，共享接口类型放在 `packages/shared/src/`。

已实现的固定来源状态保存于 `rss_sources`；动态来源配置、专题 `topics`、报告条目 `report_items` 和 Feed 配置 `feeds` 仍待后续需求驱动添加迁移。进程重启只恢复历史可查询性并标记中断，不自动恢复执行，不会擅自将旧 Run 改为成功。

推荐时区：任务配置使用 IANA 时区（如 `Asia/Singapore`），内部存储 UTC 时间戳，渲染时按频道设置转换。报告日期与新闻事件发生日期分开记录。

## 5. 数据流与内容质量

```text
抓取 → 来源校验 → 时间标准化 → 去重 → 候选集合
  → Agent 分析 → 结构化 JSON 校验 → 内容审核/策略检查
  → 数据库存储 → RSS/网页静态导出 → 部署
```

必须保留可追溯的新闻 URL；至少区分事件发生时间、来源发布时间和系统抓取时间。对于观点、行情解释、网络评论，明确区分数据与推论；无法取得点赞数或评论来源时不得捏造。

Issue #5 已实现严格 JSON Schema：分类、重要性、事实摘要、独立推断、精确依据引文；未知 ID、额外字段和重复条目拒绝。来源 URL/时间只由 Backend 从候选快照补充。报告与 Run 成功在同一事务保存；失败不生成可发布记录。`validated` 仅代表格式与来源关联，JSON 标记 `reviewStatus=pending`、`verification=source_only`，需人工核实摘要是否忠实及来源事实。

固定来源 GitHub Blog RSS 由 Backend 拉取；5 分钟上游频率限制、15 秒超时、2 MiB 限额、仅同源 HTTPS 重定向、禁用 DTD。按 canonical URL、来源 GUID、当前内容指纹去重。原文更正会刷新当前文章，保留首次抓取时间；历史 Run 候选快照及日报文档不变。新闻任务不继续原 Thread，显式新建 Run 产生新版本。来源列表顺序最多取 10 条分析，非完整当日新闻索引。具体边界见 [新闻流水线](NEWS_PIPELINE.md)。发布层只消费校验通过的数据，不解析任意自由格式的 Agent 回复作为事实依据。

## 6. 任务驱动的管理界面

- 管理入口为 Task 列表 → Task 详情 → Run 列表 → 某次 Run 的 Thread / Turn、事件日志和生成结果。
- **不提供独立 Agent 工作台**，避免任务与会话脱钩。
- v0.1 最小管理端包括任务状态、手动触发、执行日志、结果预览；任务编辑、审批和完整多轮交互可逐步完善。
- 管理 API 默认只绑定 Linux 主机回环地址；网页远程访问需单独完成认证/安全代理方案，不在 v0.1 默认开放公网。

## 7. 定时与幂等

- 按任务 ID + 日期/时间窗口生成幂等键，避免定时重试重复发布。
- 为同一任务设置运行互斥和超时/取消策略。
- 失败重试带退避；区分网络问题、访问受限、配额耗尽、Agent 错误和内容质量不合格。
- v0.1 可用单实例调度；后续再评估持久化队列，不提前引入复杂基础设施。
- 公共内容采用先完整生成、再原子发布的方式，避免 RSS 与网页版本不一致。

## 8. RSS 与静态发布

规划路径（示意，不是已经上线的 URL）：

- `/rss/all.xml`
- `/rss/ai.xml`
- `/rss/investment.xml`
- `/rss/opensource.xml`
- `/rss/trending.xml`

RSS 2.0 必须正确转义 XML 字符，提供稳定的 item guid、链接和 pubDate。建议允许“整期日报”和“单条新闻”两种 Feed 模式。仅发布可访问的正式 URL，不将开发机 localhost 链接写入正式 Feed。

## 9. Linux 安全与部署

- App Server 使用本地 stdio；若使用网络传输，只在受控网络、认证与访问隔离后开放。
- 管理 API 默认仅监听回环地址，远程访问需身份验证、TLS 和审计。
- Agent 的文件系统和命令执行权限采用最小化配置；未经授权不应自动批准危险操作。
- 不将密钥、OAuth 凭据、Cookie、原始私人日志或本地数据库推送到静态站点。
- Linux 单机由 systemd 管理 Backend 的自启动、异常恢复和 journald 日志；Backend 管理自己的 Codex 子进程。
- SQLite、Codex 认证材料与运行日志保存在 Linux 持久化目录，使用非 root 服务账号及最小权限；绝不提交到 GitHub。
- GitHub 按日期归档日报 JSON/Markdown 并触发 Cloudflare Pages 构建，Cloudflare Pages 只承载公开阅读内容；不运行 Codex Agent。
- 对第三方内容遵守来源网站的使用条款、频率限制与版权要求。

## 10. 尚待验证的风险

1. Linux 无桌面服务器下 Codex CLI 登录/续期，以及 App Server 启动、重连、审批事件处理。
2. 长时间无人值守时的登录状态、会话有效期和使用额度行为。
3. 动态网页和社交平台内容的合法可访问性。
4. 离线或未运行定时器时的漏执行补偿。
5. RSS 阅读器兼容性、中文摘要排版、静态托管更新一致性。

参见 [Linux 部署设计](DEPLOY_LINUX.md)：服务账户、systemd、认证和持久化目录。

## 参考文档

- [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
- [Codex app-server with ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
