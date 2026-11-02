# SQLite 数据模型（Issue #3）

初始迁移：`apps/server/src/db/migrations.ts` 的 `initial_schema`。数据库在 `AI_NEWS_HUB_DATA_DIR/news.db`，默认 `/var/lib/ai-news-hub/news.db`；禁止提交 SQLite、WAL / SHM、认证或本地日志到 Git。
目前只有 Schema、连接管理与迁移，没有业务 CRUD、调度、Agent 执行或发布流程。

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

标识均为调用方分配的非空主键；后续业务使用 UUID 等稳定 ID。表使用 STRICT 类型，外键在连接时启用，历史引用采用 `ON DELETE RESTRICT`。

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

## 时间和来源边界

时间字段使用 UTC ISO 8601 字符串；自动创建时间用 SQLite `strftime`，`updated_at` 后续由写入业务显式更新。Task 时区保存 IANA 名称，当前不解析 schedule 或执行计划。
`source_published_at` 与 `event_at` 不确定时保存 NULL；`fetched_at` 必填，不用抓取时间伪造原始发布时间。`report_date` 表示频道报告日期，与事件发生日期分开。
URL、IANA 时区、日期格式和状态转换的完整业务校验留给后续入口；当前没有自动发布，Schema 中的非空来源字段不能视为来源真实性已验证。

## 迁移与运维

- `npm run db:migrate` 或 Backend 启动自动执行迁移；先 `npm run build`。同一根目录 `.env` 可供 npm 命令加载。
- 事务使用 `BEGIN IMMEDIATE`；SQL 和版本记录一起提交，任意错误整体回滚。本次无 down migration。
- 已应用的 SQL 不得修改，新增需求追加顺序版本。历史名称、checksum 或版本不匹配时拒绝启动，避免旧程序误用新数据库。
- 连接使用 WAL、外键、5 秒 busy timeout；新目录为 0700，数据库为 0600，已有权限不安全或数据库为符号链接时拒绝打开。服务账户须拥有目录与文件。
- 备份时先停止服务后复制完整数据库，或使用支持 SQLite 在线备份的工具；不要在活跃写入时只复制 `news.db` 而忽略 WAL。升级前保留备份，不能通过删除数据解决迁移冲突。
- 程序重启后记录仍在，但当前不恢复执行中的 Run，不启动 Agent，也不把历史状态改成成功。

参考：[Node 22.19 SQLite API](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html)（当前仍为实验性 API）。
