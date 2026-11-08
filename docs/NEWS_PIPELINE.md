# Codex 新闻流水线

用户配置主题和有序 Prompt，由 Codex hosted web search 搜索、打开和整理来源。每次执行建立独立 Thread，各研究轮恢复同一 Thread；最后一条配置的 Prompt 直接生成结构化日报。最多 20 个配置 Prompt，不追加额外轮次，不提供配置任务的交互式追问。

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

每日科技资讯 v1 模板保持单轮，聚焦 AI、半导体和相关算力技术，固定 8 条；先搜索最近 24 小时，不足再回溯至 72 小时、最后最多 7 天，并逐条注明实际时间。新能源车、普通消费电子、通用操作系统和机器人产销不入选；每条仍需直接来源和准确引文。Prompt 的 `【固定 8 条】` 标记使 Backend 对该任务的新 Run 实施 8 条校验，少于 8 条的结果不保存、不自动归档；其他日报仍使用 1～10 条的通用 Schema。新 Run 也会收到同任务最近 7 天的最多 60 条已生成日报标题和来源 URL 作去重参考，历史内容被视为不可信数据。模板修改不更新已保存的任务配置或历史 Run。

新闻 Thread 只允许 hosted web search：逐个禁用继承的 MCP，禁用 Shell、应用和委派，审批仍一律拒绝。Backend 管理/发布凭据不传给 Codex；没有外部 RSS 采集入口，公共站输出 RSS 保留。

当前用户配置任务严格执行 N 条 Prompt = N 次 Codex Turn。最后一条原始 Prompt 直接返回日报结构，Backend 只在开发者格式指令中提供主题/时间/Schema，不改写持久化的用户 Prompt，也不再追加“依据前面所有轮次的研究结果，生成完整日报。”。旧执行记录的额外系统轮仅作为历史保留。

每日热点观察 `daily-headlines` 保持 v1 与两轮结构：第一轮建立全球新闻候选池，第二轮核查筛选简报；严格限定北京时间最近 24 小时，扩大经济、金融、数字资产、AI 和产业覆盖，不设类别配额。模板更新不自动修改已有任务，已保存任务需重新选择模板并保存；历史 Run 配置快照保留。
