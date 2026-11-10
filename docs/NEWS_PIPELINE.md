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

每日开源项目 v1 保持 id/version 不变，采用候选发现、原始来源核实与 JSON 生成两轮；社区热度原则上不超过 2～3 条，模板更新需重新选择并保存任务后生效。每日科技投资简报 v1 改为两轮候选发现与核查分析，覆盖 AI/大模型/开源项目、科技股票与投资研究线索、科技企业和产业趋势。优先最近 24 小时，不足时依次补充至 72 小时和 7 天；最多选 10 条、证据不足时允许少于 10 条，标注实际时间和补充窗口，并提供事件背景、影响逻辑、关注点与风险。当前科技模板不使用固定条数标记；Backend 仍对其他显式 `【固定 8 条】` / `【固定 10 条】` 任务执行数量校验。同任务最近 7 天最多 60 条完整摘要、来源 canonical URL 与可提取的项目仓库链接作为不可信去重数据提供给所有托管主题日报，包含弹性条数任务；固定条数标记只控制数量校验。模板修改不自动更新已保存任务或历史 Run。

新闻 Thread 只允许 hosted web search：逐个禁用继承的 MCP，禁用 Shell、应用和委派，审批仍一律拒绝。Backend 管理/发布凭据不传给 Codex；没有外部 RSS 采集入口，公共站输出 RSS 保留。

当前用户配置任务严格执行 N 条 Prompt = N 次 Codex Turn。最后一条原始 Prompt 直接返回日报结构，Backend 只在开发者格式指令中提供主题/时间/Schema，不改写持久化的用户 Prompt，也不再追加“依据前面所有轮次的研究结果，生成完整日报。”。旧执行记录的额外系统轮仅作为历史保留。

每日热点观察 `daily-headlines` 保持 v1 与两轮结构：第一轮建立全球新闻候选池，第二轮核查筛选简报；严格限定北京时间最近 24 小时，扩大经济、金融、数字资产、AI 和产业覆盖，不设类别配额。模板更新不自动修改已有任务，已保存任务需重新选择模板并保存；历史 Run 配置快照保留。

## 可选投资研究详情

科技投资简报 v1 已改为两轮研究和弹性 1～10 条；更新后的 Prompt 可为证据充足的条目输出可选 `details`，无依据时省略。`details.kind=investment` 包含事件背景、带实际值/指引/预期/估算/推断性质的指标、产业链关系、投资逻辑、观察指标、风险、估值和补充证据。指标及已确认的供应关系须引用同条证据 ID；补充来源 URL 仅做格式与公网 HTTPS 检查，不由 Backend 独立抓取或核验。每条详情 JSON 限 2500 UTF-8 字节；旧报告和已保存的任务 Prompt 不自动改写。

## 可选热点新闻详情

研究 JSON 可为热点条目提供 `details.kind=news`，包含事件背景、关键事实、时间线、各方表态、影响、未确定事项、观察点及补充证据。关键事实、时间线、表态和已观察影响须引用本条 `evidence` 的 ID；补充 URL 只检查公网 HTTPS 和格式，不独立抓取。单条详情限 2500 UTF-8 字节，缺省时沿用原报告。当前 Prompt 模板未改；Issue #78 负责模板输出要求。
