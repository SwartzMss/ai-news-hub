# 真实 RSS → 待审核日报

Issue #5 提供固定 `news-github` 手动任务，频道 `opensource`，来源为 [GitHub Blog RSS](https://github.blog/feed/)。Backend 拉取和规范化来源，Codex 负责分类、重要性排序、中文事实摘要与独立分析，Backend 校验后保存 SQLite JSON / Markdown。已提供管理后台与人工批准/GitHub 归档，见 [发布说明](PUBLISHING.md)；尚无调度、内容编辑、公开 RSS 或公共阅读前端。

## 运行与查询

先按 [部署文档](DEPLOY_LINUX.md#11-issue-5-rss-与待审核日报) 配置非 root Backend、Codex 登录与管理 Token。沿用 [手动样例](TASK_ENGINE.md#手动触发样例) 的安全 Token 输入方式，将路径换为 `/api/tasks/news-github/runs`。请求体为 `{"idempotencyKey":"news-2026-11-03-001"}`。这会访问真实来源并消耗模型额度。

同一键返回原 Run，不重复生成；新键显式重新生成，同一 UTC 日期/频道的报告版本递增。新闻任务不支持继续 Turn，返回 409 `workflow_continuation_disabled`。启动服务只注册任务/来源，不访问 RSS 或模型。

全部接口位于现有 Bearer Token 保护的 `/api`，默认仅监听回环地址：

| 方法 / 路径 | 响应 |
| --- | --- |
| `GET /api/news/sources` | `sources`：固定来源及上次请求/成功时间、安全错误码 |
| `GET /api/news/articles` | `articles`：当前规范化来源记录 |
| `GET /api/news/reports` | `reports`：报告 ID、Run、UTC 日期、频道、版本、标题和状态 |
| `GET /api/news/reports/:reportId` | `report`：元数据、`document` JSON 与 `body_markdown` |
| `GET /api/news/runs/:runId` | `newsRun`：采集时间、生成时 `candidates` 快照及 `report_id` |

文章/报告列表支持 `limit`（默认 20，1–100）、`offset`（默认 0，0–100000）。Run 状态、Turn 与事件沿用 `/api/runs/:runId` 和 `/api/runs/:runId/events`。来源采集失败前未建立候选快照时，newsRun 查询返回 404，应查询通用 Run 错误。

## 来源与最小去重

- 上游请求至少间隔 5 分钟；成功缓存可复用，失败后的频率窗口返回 `source_rate_limited`，不会悄悄拿旧缓存生成成功日报。支持 ETag / Last-Modified 与有缓存的 304。
- 总抓取超时 15 秒，正文最多 2 MiB、XML 深度 32、条目最多 200；只接受 RSS，拒绝 DTD/外部实体，不做全文抓取。重定向限定为相同源的 HTTPS，最多 4 次请求。
- 原文链接必须为 HTTP(S)、发布者域名 `github.blog`、无用户凭据和非默认端口。保留原始 URL；canonical URL 移除 fragment、`utm_*`、`fbclid`、`gclid`，保留并排序有语义的查询参数。
- 按 canonical URL、来源内稳定 GUID、规范化标题/摘要内容指纹去重。同一响应重复 URL/GUID 取首条；内容指纹只作弱匹配，不把新 GUID 永久绑定到旧文章。强身份冲突整批失败，不猜测归属。
- 原文更正会刷新当前文章标题、摘要、发布时间等字段并替换指纹；`fetched_at` 保留首次抓取时间，`last_seen_at` 记录最近观察时间。历史候选和报告保留原快照。
- 发布时间要求显式时间及时区，否则 NULL；事件时间暂不从 RSS 推断，保持 NULL。日报日期按生成时 UTC 计算，不代表条目均发布于该日。

## 输出校验与审核边界

从来源列表顺序取最多 10 条可用候选，提示模型选最重要的 1–5 条；Schema 允许 1–10 条，不实施跨来源事实核验或复杂语义去重。RSS 标题/短摘要视为不可信数据，使用固定开发者指令、只读沙箱和拒绝审批；收到工具执行事件会以 `unexpected_tool` 失败。该检查不能代替服务账户凭据和文件权限隔离。

模型通过 `turn/start.outputSchema` 接收严格 Schema。Backend 再独立解析 JSON，拒绝额外字段、错误类型、未知/重复文章 ID，以及无法从候选标题/摘要精确匹配的 `evidenceQuote`。URL、来源和三类时间只从候选快照补充，模型不能提交这些字段，也没有点赞/评论数输出字段。最终报告再次通过完整 Schema 验证；Markdown 转义来源与模型文本。

报告状态 `validated` 表示结构与来源关联通过，JSON 始终标记 `reviewStatus: pending`、条目 `verification: source_only`，原始文章默认 `unverified`。精确引文不能证明摘要或推断准确，仍需人工核对原文、事实/观点和时效。新闻生成本身不批准、不发布；人工批准与归档由 Issue #7 的独立管理操作完成。

报告、文章关联、newsRun 报告引用与 Run/Turn 成功状态在同一事务提交；解析、校验或存储失败均回滚报告并将 Run 标失败。候选快照与采集记录可保留用于排查。取消/超时沿用任务引擎，迟到成功不写报告；重启中断，不自动重试。

常见安全错误码包括 `feed_http_503`、`feed_fetch_failed`、`feed_timeout`、`feed_redirect_forbidden`、`feed_too_large`、`feed_identity_conflict`、`report_invalid_json`、`report_schema_invalid`、`report_unknown_article`、`report_duplicate_article`、`report_evidence_invalid`。详情见 Run/来源查询，不把原始异常、代理值或认证信息公开。

真实端到端证据见 [验证记录](validation/NEWS_PIPELINE.md)。数据关系见 [数据模型](DATA_MODEL.md)。
