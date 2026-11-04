# SQLite 数据模型

初始迁移：`apps/server/src/db/migrations.ts` 的 `initial_schema`。数据库在 `AI_NEWS_HUB_DATA_DIR/news.db`，默认 `/var/lib/ai-news-hub/news.db`；禁止提交 SQLite、WAL / SHM、认证或本地日志到 Git。
Issue #4 追加迁移 2（`task_execution_history`），实现任务执行及历史持久化。Issue #5 追加迁移 3，启用 RSS 采集、文章及待审核报告业务；Issue #7 迁移 4 启用人工批准与 GitHub 发布持久化。迁移 5 改为 Codex 主题研究，历史 RSS 表只兼容读取。

## 表与关系

| 表 | 主要字段与职责 |
| --- | --- |
| `tasks` | `id`、`name`、`channel`、`prompt`、`status`、`schedule`、`timezone`、创建/更新时间 |
| `task_runs` | `task_id` 外键；触发类型、幂等键、状态、Thread / Turn ID、起止时间、错误代码/说明 |
| `articles` | 原文 URL、唯一 canonical URL、来源名、标题、来源发布时间、事件时间、抓取时间、事实/观点标记、正文/哈希 |
| `reports` | `run_id` 外键；报告日期、频道、版本、标题、Markdown、有效 JSON、审核/发布状态 |
| `report_articles` | 报告与原文的多对多关联、条目顺序；可追溯报告来源 |
| `publication_records` | `report_id` 外键；目标、唯一幂等键、状态、产物路径、远端 URL、错误码及发布时间 |
| `schema_migrations` | 内部版本号、名称、SQL SHA-256 与应用时间，启动时核对历史 |
| `run_threads` | Run 到服务器 Thread 的一对一归属；`thread_id` 唯一，防止跨 Run 共用 |
| `run_turns` | 本地 Turn UUID、Run 内序号/幂等键、输入、Thread/服务器 Turn ID、状态、输出、错误及起止时间 |
| `run_events` | 自增游标、Run/本地 Turn ID、事件类别、受限 JSON 数据和创建时间 |
| `backend_owner` | 同一数据目录的单 Backend 所有权：随机 owner ID、PID、进程启动时间、boot ID |

标识均为调用方分配的非空主键；后续业务使用 UUID 等稳定 ID。表使用 STRICT 类型，外键在连接时启用，历史引用采用 `ON DELETE RESTRICT`。

迁移 3（`rss_collection_and_reports`）追加：

| 表/字段 | 职责 |
| --- | --- |
| `articles.last_seen_at` | 最近在成功 RSS 响应中观察到的时间；`fetched_at` 保留首次抓取时间 |
| `rss_sources` | 固定来源 URL、请求/成功时间、安全错误码、ETag/Last-Modified |
| `rss_entries` | 来源内稳定条目标识与文章映射 |
| `article_fingerprints` | 来源内当前规范化标题/摘要指纹与文章映射；更新时移除旧指纹 |
| `rss_feed_items` | 最近成功 Feed 的文章顺序；用于频率限制与 304 缓存 |
| `news_runs` | Run 一对一来源、UTC 报告日期、候选 JSON 快照、采集时间及唯一报告引用 |

迁移 3 的 RSS 身份/缓存表仅保留历史，不再写入采集数据。当前按 canonical URL 去重，更新文章标题、原文正文、发布时间和 last_seen_at，保留既有 ID 与首次 fetched_at。历史快照和报告不可用当前文章内容覆盖。

报告 `validated` 仅表示严格格式、候选 ID、精确依据引文与来源关联校验通过；文档保持 `reviewStatus=pending`、`verification=source_only`。它不代表独立事实核验或人工批准，不能直接发布。报告/关联/Run 成功事务一起提交或回滚。同日同频道新 Run 增加版本，幂等重试不新增版本。

迁移 4（`approved_github_publications`）新增 `report_approvals(report_id, content_hash, approved_at)`，一份报告只能批准一次，绑定完整生成文档、版本、候选快照与关联 ID；变动后拒绝，修订须生成新报告版本。原始 `reports.content_json` 不改写，故仍保留 pending 生成快照。

`publication_records` 追加 `repository`、`branch`、`content_hash`（归档字节 SHA-256）、`commit_sha`、`attempts`。幂等键仅绑定仓库/分支/路径/字节哈希，不包含凭据；轮换 Token 保留同一记录。`published_at` 为 GitHub 返回的提交时间。pending → publishing → succeeded/failed；failed 显式重试复用记录并增加次数。启动将未完成 publishing 标 failed / publication_interrupted；不自动重试，不把未知远端结果当成功。成功状态与 Report published 同事务保存，远端操作不处于 SQLite 事务内。

报告 validated → approved（人工、哈希确认）→ published（GitHub 确认）。失败保留 approved；GitHub 已提交但本地持久化失败可通过重试远端内容核对恢复。原始 JSON 的 source_only 不因人工允许发布而升级成独立事实核验。

## Codex 研究（迁移 5）

`codex_news_runs` 一对一绑定 Run，保存 topic、initial_input、创建日 UTC report_date、channel，以及显式生成成功后的 collected_at/candidates_json/report_id；研究轮 candidates 为空且无报告。`run_turns.mode` 为 default/research/finalize，input_text 保留用户原始 prompt，最终输出与旧轮次独立保存。旧 news-github 停用，历史保留。

最终来源验证在事务外完成；报告、文章/关联、不可变快照和 Run/Turn 成功同事务提交。失败不写入部分文章/日报；成功后禁止继续本 Run。已生成报告修订须新建研究。归档 v1 暂保留 opensource 频道键，主题可自由填写。

## 状态与唯一约束

| 对象 | 可存储状态 |
| --- | --- |
| Task | `active`、`paused` |
| Run | `queued`、`running`、`waiting_approval`、`succeeded`、`failed`、`cancelled`、`interrupted` |
| Article 内容 | `fact`、`opinion`、`unverified`（默认） |
| Report | `draft`（默认）、`validated`、`approved`、`published`、`rejected` |
| Publication | `pending`、`publishing`、`succeeded`、`failed` |

Run 触发类型为 `manual` / `scheduled` / `retry`；`(task_id, idempotency_key)` 唯一。报告 `(channel, report_date, version)` 唯一且版本大于 0。发布目标为 `github` / `cloudflare_pages`，幂等键应含目标与报告版本，例如 `github/<report-id>/v1`。
报告内同一原文不可重复关联，排序位置必须非负且唯一。上述约束保证存储完整性，不能替代后续的业务状态机与发布来源校验。
Turn 的 `(run_id, sequence)`、`(run_id, idempotency_key)` 唯一；`(thread_id, server_turn_id)` 唯一，服务器 ID 和本地 UUID 分开保存。一个 Run 最多 20 个 Turn，初始 Turn 算第 1 个。
Run 中的 `thread_id` / `turn_id` 是查询用摘要；继续 Turn 时清除旧的最新 Turn ID、保留 Thread，历史 Turn 记录不会覆盖。Run 的 succeeded 表示最近一次 Turn 成功，不代表内容经过审核或可以发布。

## 时间和来源边界

时间字段使用 UTC ISO 8601 字符串；自动创建时间用 SQLite `strftime`，`updated_at` 后续由写入业务显式更新。Task 时区保存 IANA 名称，用户配置任务的结构化计划存于 configuration_json，由 Backend 解析执行。
`source_published_at` 与 `event_at` 不确定时保存 NULL；`fetched_at` 必填，不用抓取时间伪造原始发布时间。`report_date` 表示频道报告日期，与事件发生日期分开。
当前来源入口校验公网 HTTPS、DNS 固定连接、HTML 原文与精确引文；发布时间只取带时区的源元数据，事件时间为 NULL。Schema/引文匹配不等于独立事实核验，没有自动发布。任务时区/调度仍是预留配置。

## 迁移与运维

- `npm run db:migrate` 或 Backend 启动自动执行迁移；先 `npm run build`。同一根目录 `.env` 可供 npm 命令加载。
- 事务使用 `BEGIN IMMEDIATE`；SQL 和版本记录一起提交，任意错误整体回滚。本次无 down migration。
- 已应用的 SQL 不得修改，新增需求追加顺序版本。历史名称、checksum 或版本不匹配时拒绝启动，避免旧程序误用新数据库。
- 连接使用 WAL、外键、5 秒 busy timeout；新目录为 0700，数据库为 0600，已有权限不安全或数据库为符号链接时拒绝打开。服务账户须拥有目录与文件。
- 备份时先停止服务后复制完整数据库，或使用支持 SQLite 在线备份的工具；不要在活跃写入时只复制 `news.db` 而忽略 WAL。升级前保留备份，不能通过删除数据解决迁移冲突。
- 启动先取得同主机 Backend 所有权，再把未完成 Run / Turn 标为 interrupted，错误码 `backend_restarted`，追加 recovered 事件；不自动重跑。正常关闭则记录 `backend_stopped`。所有权随关闭释放，异常退出后的失效 PID/启动时间记录可被新进程接管。
- Run / Turn 输入与经过大小限制的 Agent 正文可包含私有内容，仅供已认证管理 API 查询，不导出到公开站或原始服务日志。事件不保存原始 RPC、stderr、工具参数或认证响应。API 与大小限制见 [任务引擎](TASK_ENGINE.md)。

参考：[Node 22.19 SQLite API](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html)（当前仍为实验性 API）。

## 数据库配置与管理员（迁移 6）

app_settings 单行保存 revision、严格 runtime config JSON、加密 GitHub Token 和更新时间；revision 防止不同页面互相覆盖。私有 settings.key 为自动生成的 AES-256-GCM 密钥，数据库与密钥需一起备份。读取设置不包含原始 Token。

admin_credentials 单行保存 password/token 模式、scrypt 盐/哈希或历史 Token 哈希；admin_sessions 只保存会话 SHA-256 和创建/到期时间。首次初始化仅由本机同源页面设置并确认密码；自动请求校验保存在进程内，重启换新、成功后失效，不写入数据库或码文件。登录会话 12 小时，密码轮换事务更新凭据、撤销所有旧会话并返回替换会话。旧 env 仅在对应记录缺失时导入，已有 DB 时不重新解析/覆盖旧值。

监听地址/端口/数据目录仍在启动配置。其余参数由 [系统设置](SETTINGS.md) 保存；执行或发布忙碌时拒绝修改，空闲时立即应用，不改变已完成 Run/报告或归档历史。

用户配置任务另存 `configuration_json`、`next_run_at`、`deleted_at`；每个 Run 保存配置快照，编辑不能改变已开始的 Prompt 或自动发布策略。批准记录新增 `approval_kind`，区分 manual/automatic。迁移追加，既有 SQL/checksum 保持不变。

版本 8 追加运行时间排序及报告/发布关联查询索引，为跨任务结果列表提供稳定分页；没有改写已应用的迁移。
