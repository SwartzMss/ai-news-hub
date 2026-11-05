# Codex 新闻流水线

用户配置主题和有序 Prompt，由 Codex hosted web search 搜索、打开和整理来源。每次执行建立独立 Thread，各研究轮恢复同一 Thread；最后额外执行一次结构化日报生成。最多 19 个研究 Prompt 加一轮生成，不提供配置任务的交互式追问。

Backend 不再再次访问原文、解析网页或比对引文，也不再因为第三方网页 403、429 或网络超时而拒绝日报。来源内容、链接和引文由 Codex 提供。Backend 保留 JSON Schema、条目数/分类/重要性/长度、重复链接与 HTTPS 链接格式检查；这些不代表来源或事实已核验。

## 结构和时间

最终输出沿用 RESEARCH_SCHEMA：日报标题和 1–10 个条目，每条包含 url、category、importance、factSummary、analysis、evidenceQuote。Backend 生成内部标识、存储时间和原子事务关联。

新报告条目标记 `verification=codex_reported`。来源名由链接域名确定；原始发布时间和事件时间在当前 Schema 未提供时均为 null。后端没有抓取原文，因此报告 `fetchedAt` 和归档 `fetched_at` 必须为 null；collectedAt 是 Backend 收到/保存日报的时间。

迁移追加 source_mode 区分 codex_reported 与旧 verified 快照。articles 的历史非空 fetched_at 列在 codex_reported 模式表示收件时间，而不是网页抓取时间。旧报告保持 source_only 及原有抓取时间，不重写历史内容。

## 保存、审核和发布

结构合格后保存 SQLite 日报及其来源链接。关闭自动发布则待人工批准；开启则记录 automatic 授权并归档 GitHub。发布仍重建并比对本地内容、模式、快照、条目关联及授权哈希，防止版本被改变；不会联网核验原文。

研究失败、JSON 不合格或链接格式不合格仍会失败；不会把错误输出伪装成有效日报。后端来源重试与来源修复轮已退出任务链路。旧失败记录保留，不因升级自动重跑。

## 历史 API

旧 news-research 的初始请求仍可携带 topic/input，后续 `/runs/:runId/turns` 携带 input/finalize；配置任务由 Backend 顺序运行。任务 API 见 [TASK_ENGINE.md](TASK_ENGINE.md)，发布规则见 [PUBLISHING.md](PUBLISHING.md)。

新闻 Thread 只允许 hosted web search：逐个禁用继承的 MCP，禁用 Shell、应用和委派，审批仍一律拒绝。Backend 管理/发布凭据不传给 Codex；没有外部 RSS 采集入口，公共站输出 RSS 保留。
