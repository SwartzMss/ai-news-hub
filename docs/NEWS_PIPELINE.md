# Codex 新闻流水线

用户配置主题和有序 Prompt，由 Codex hosted web search 搜索、打开和整理来源。每次执行建立独立 Thread，各研究轮恢复同一 Thread；最后一条配置的 Prompt 直接生成结构化日报。最多 20 个配置 Prompt，不追加额外轮次，不提供配置任务的交互式追问。

Backend 不再再次访问原文、解析网页或比对引文，也不再因为第三方网页 403、429 或网络超时而拒绝日报。来源内容、链接和引文由 Codex 提供。Backend 保留 JSON Schema、条目数/分类/重要性/长度、重复链接与 HTTPS 链接格式检查；这些不代表来源或事实已核验。

## 结构和时间

最终输出沿用 RESEARCH_SCHEMA：日报标题和 1–10 个条目，每条包含 url、category、importance、factSummary、analysis、evidenceQuote。Backend 生成内部标识、存储时间和原子事务关联。

Codex 严格结构化输出要求所有属性必填，且不接受业务 Schema 的部分关键字。Backend 发送兼容 Schema，用 `null` 表示可选字段缺省；收到后删除这些可选 `null`，再用完整 RESEARCH_SCHEMA、详情引用和来源 URL 规则校验。`details` 对通用主题仍是业务可选字段；`daily-headlines` 和 `daily-opensource` 通过稳定模板 ID 路由到专用严格 Schema，并要求各自的结构化详情。历史报告保持原样。

新报告条目标记 `verification=codex_reported`。来源名由链接域名确定；原始发布时间和事件时间在当前 Schema 未提供时均为 null。后端没有抓取原文，因此报告 `fetchedAt` 和归档 `fetched_at` 必须为 null；collectedAt 是 Backend 收到/保存日报的时间。

迁移追加 source_mode 区分 codex_reported 与旧 verified 快照。articles 的历史非空 fetched_at 列在 codex_reported 模式表示收件时间，而不是网页抓取时间。旧报告保持 source_only 及原有抓取时间，不重写历史内容。

## 保存、审核和发布

结构合格后保存 SQLite 日报及其来源链接。关闭自动发布则待人工批准；开启则记录 automatic 授权并归档 GitHub。发布仍重建并比对本地内容、模式、快照、条目关联及授权哈希，防止版本被改变；不会联网核验原文。

研究失败、JSON 不合格或链接格式不合格仍会失败；不会把错误输出伪装成有效日报。后端来源重试与来源修复轮已退出任务链路。旧失败记录保留，不因升级自动重跑。

## 历史 API

旧 news-research 的初始请求仍可携带 topic/input，后续 `/runs/:runId/turns` 携带 input/finalize；配置任务由 Backend 顺序运行。任务 API 见 [TASK_ENGINE.md](TASK_ENGINE.md)，发布规则见 [PUBLISHING.md](PUBLISHING.md)。

每日热点观察 v1 保持 id/version 不变，定位为国内外社交平台热点发现与研究，而非综合新闻日报。两轮流程分别负责候选发现和核查筛选；重点检查微博、抖音、B站、小红书、知乎、X、Reddit 等可公开访问平台，平台不可访问时必须如实说明。话题类别使用固定枚举；`trendTags`、`contentTags` 使用受控词表；`trendSignals` 记录平台、指标、数值/未披露状态、观察时间、直接观察/来源转述及证据引用；`publicDiscussion` 仅在有可核实材料时填写；`contentSuitability` 与 `contentAngles` 评估创作价值。最终选择综合考虑传播热度、讨论价值和内容价值，不设平台/类别配额；每条必须有至少一条可追溯平台信号，不能核实则不入选。Backend 用 `templateId=daily-headlines` 选择专用 Schema，并校验分类、趋势标签与平台信号的一致性、证据引用和创作建议；详情上限 6000 字节。新热点日报话题归档使用 v4 Schema，旧 v1/v2/v3 契约保持不变。旧任务需重新选择 `daily-headlines` v1 并保存，历史归档不重写。

每日开源项目 v1 保持 id/version 不变，采用候选发现、原始来源核实与 JSON 生成两轮；范围固定为 AI Agent 与自动化执行、Rust 工程工具、AI 视频/音频与多媒体创作、性能分析与软件安全、区块链与去中心化基础设施五个方向。每个方向独立精选 0～2 个，不设全局目标数量，质量不足时允许留空。明确区分近期实质更新与值得认识的项目发现，不把社区热度当作项目进展。第二轮输出必需的 `researchArea` 和 `kind=project` 结构化详情，技术要点、适用场景、许可证与评价均须有相应证据；无证据内容省略。公共归档使用 v3 Schema，旧 v1/v2 归档保持兼容。模板更新需重新选择并保存任务后生效，旧归档不自动补齐。每日科技投资简报 v1 保持 id/version 不变，聚焦 AI 产业链、光模块与光通信、半导体三个方向；Nasdaq 为核心市场，NYSE 次之，仅在产业链直接相关时纳入 A 股/港股。两轮流程先发现候选，再核查来源与投资影响；优先最近 24 小时，必要时补充至 72 小时、最多 7 天。最终按事实增量、业绩影响和证据强度精选 5～8 条、最多 10 条，不设方向配额、不凑数。同一事件只归入一个主方向。第二轮使用专用 `TECHNOLOGY_RESEARCH_SCHEMA`，仅允许 `ai_industry_chain`、`optical_communications`、`semiconductor`，每条必须包含 `kind=investment` 和至少一个原始证据；详情使用既有投资结构（metrics、supplyChain、investmentLogic、watchpoints、risks、valuation），不改变旧投资详情字段。模板通过 `templateId=daily-technology` 路由，科技投资归档使用 v5；v1～v4 契约保持不变。已保存任务需重新选择并保存模板后生效，历史 Run/归档不重写。同任务最近 7 天最多 60 条完整摘要、来源 canonical URL 与可提取的项目仓库链接作为不可信去重数据提供给所有托管主题日报，包含弹性条数任务；固定条数标记只控制数量校验。模板修改不自动更新已保存任务或历史 Run。

开源项目 `details.evaluation` 中的 `nature=fact` 必须带非空且指向本条 `evidence` 的 `evidenceRefs`；`nature=analysis` 可无引用。新生成日报的 Codex 输入 Schema 与 Backend 保存校验均限制事实评价的引用形式，冻结的历史归档 Schema 不变。没有同任务历史日报时，研究上下文会明确告知；历史去重状态不写入单个项目评价。

新闻 Thread 只允许 hosted web search：逐个禁用继承的 MCP，禁用 Shell、应用和委派，审批仍一律拒绝。Backend 管理/发布凭据不传给 Codex；没有外部 RSS 采集入口，公共站输出 RSS 保留。

当前用户配置任务严格执行 N 条 Prompt = N 次 Codex Turn。最后一条原始 Prompt 直接返回日报结构，Backend 只在开发者格式指令中提供主题/时间/Schema，不改写持久化的用户 Prompt，也不再追加“依据前面所有轮次的研究结果，生成完整日报。”。旧执行记录的额外系统轮仅作为历史保留。

每日热点观察 `daily-headlines` 保持 v1 与两轮结构：第一轮按北京时间最近 24 小时建立约 10–15 条不同事件的全球候选池，区分事件、报道和市场数据时间，记录来源与新增事实；第二轮重开原始来源，按 1–5 分重要性、信息增量和证据质量筛选目标 5–8 条、最多 10 条，证据不足时可少于 5 条。最终只输出系统 JSON Schema 的 `title/items`，在证据充分时为条目加入可选 `details.kind=news`，按事件类型提供事实、时间线、表态、影响和可追溯的补充证据；不设类别配额，不将热度或普通价格波动当成重要性。模板更新不会自动修改已保存任务；需在后台重新选择模板并保存，历史 Run 配置快照保留。

## 可选投资研究详情

科技投资简报 v1 聚焦 AI 产业链、光模块与光通信、半导体三个方向，Nasdaq 优先；候选发现与最终核查两轮进行。`daily-technology` 通过稳定 `templateId` 路由到专用三分类 Schema，最终 5～8 条、最多 10 条；每条必须包含 `details.kind=investment` 和至少一个原始证据。详情沿用事件背景、核心指标、产业链关系、投资逻辑、观察指标、风险、估值和补充证据等既有字段；缺少依据的分节省略，指标及已确认的供应关系须引用同条证据 ID。专用 Schema 只约束新科技模板，不改变通用 Schema 和历史报告契约；新科技话题归档使用 v5。补充来源 URL 仅做格式与公网 HTTPS 检查，不由 Backend 独立抓取或核验。每条详情 JSON 限 2500 UTF-8 字节；旧报告和已保存的任务 Prompt 不自动改写。

## 可选热点新闻详情

研究 JSON 可为热点条目提供 `details.kind=news`，包含事件背景、关键事实、时间线、各方表态、影响、未确定事项、观察点及补充证据。关键事实、时间线、表态和已观察影响须引用本条 `evidence` 的 ID；补充 URL 只检查公网 HTTPS 和格式，不独立抓取。单条详情限 2500 UTF-8 字节，缺省时沿用原报告。每日热点观察 v1 模板现要求每个入选事件至少提供背景、带证据引用的关键事实和原始来源；基础事实无法核实时剔除候选。已保存任务需重新选择模板并保存，历史日报不自动补齐。
