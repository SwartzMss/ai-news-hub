# Codex 主题研究与待审核日报

新闻入口是用户主题与 prompt。`news-research` 通过 Codex 实时 web search 搜索、打开原文、提取并分析；用户在同一个 Run / Thread 内多轮补查、筛选，最后显式生成日报。Backend 不采集外部 RSS，不预先指定 GitHub Blog 候选。公开站的输出 RSS 保留。

## 操作与 API

在 `/admin/` 选择“Codex 主题新闻研究”，填写主题（例如“AI 开源模型”）和初始 prompt。第一轮返回研究文本；Run 页面可继续输入筛选条件。最后输入整理要求，点击“生成待审核日报”。每轮会使用账户额度。

全部接口位于 Bearer Token 保护的 `/api`，Backend 默认仅绑定回环地址：

| 方法 / 路径 | 请求或响应 |
| --- | --- |
| `POST /api/tasks/news-research/runs` | `{"idempotencyKey":"research-001","topic":"AI 开源模型","input":"搜索最近三天的官方公告，先列候选和来源"}` → `{run,reused}` |
| `POST /api/runs/:runId/turns` | `{"idempotencyKey":"followup-001","input":"只保留开源模型，补查原文","finalize":false}` → `{run,turn,reused}` |
| 同上，最终生成 | `{"idempotencyKey":"final-001","input":"整理成中文日报","finalize":true}` |
| `GET /api/runs/:runId` | Run 状态、各轮原始输入、mode、最终回复与错误 |
| `GET /api/runs/:runId/events` | 分页日志和工具类型；无工具参数/原始 RPC |
| `GET /api/news/runs/:runId` | `newsRun`：主题、初始输入、日期、来源快照及报告 ID |
| `GET /api/news/articles` | 当前规范化文章；支持分页 |
| `GET /api/news/reports` | 日报列表；支持分页 |
| `GET /api/news/reports/:reportId` | 元数据、`document` JSON 和 `body_markdown` |

主题非空、最多 200 字符，prompt 非空、最多 8000 字符。一个 Run 最多 20 轮，包含最终生成；应预留一轮用于生成。最终生成成功后该 Run 固定，修改须新建研究；失败则可用新键在原 Thread 补查或重试，不写半份日报。

同键重试不重复调用；topic/input 或 input/finalize 与原键不符返回 409 `idempotency_conflict`。同任务执行互斥。创建成功 202、幂等复用 200。最近 Turn 成功不代表已生成日报或已审核。归档 v1 仍使用 `opensource` 频道键，主题独立，不自动新建发布频道。日报日期取 Run 创建时 UTC 日期；新闻时间范围由 prompt 控制，仍须人工核对。

## Codex 搜索边界

新闻 Thread 设置 `web_search=live`，采用 read-only sandbox / untrusted 审批策略。Adapter 先 `config/read` 获取继承的 MCP 名称，逐个显式禁用；禁用 Shell、应用和委派。仅放行 hosted `webSearch` 工具事件，其余导致 `unexpected_tool`，所有服务器审批请求拒绝。环境不继承 Backend 凭据；服务账户 HOME、Codex 认证和文件权限仍须隔离。

新 Run 新建 Thread，后续 prompt 恢复同一 Thread；每轮使用新的 stdio App Server 子进程。来源内容视为不可信数据，研究回复附原文链接，不以记忆补齐不可验证新闻。搜索可用性依赖安装的 Codex、账户、模型/provider 和受管策略；不支持时不可使用假来源冒充成功。参考 [官方搜索说明](https://developers.openai.com/codex/web-search)。

## 显式生成与原文验证

最终 Turn 接收严格 outputSchema，Backend 再独立校验 JSON：标题、1–10 条新闻、原文 URL、分类、重要性、来源归属摘要、独立推断和 8–240 字符精确引文。拒绝额外字段、错误类型和重复 canonical URL；模型不能提交来源名、三类时间或互动数。

Backend 只请求 Codex 选出的原文以核对来源，不建立候选采集入口：

- 仅公网 HTTPS，禁止凭据、非默认端口、控制字符、私有/保留 IP 和本地域名。核对全部 DNS 地址并固定连接，防止重绑定。
- 直接连接，不继承代理/Cookie/认证，不跟随重定向。Codex 须使用原文最终 URL，服务主机须能直接访问来源。
- 单页含 DNS/正文最多 15 秒、2 MiB，仅 UTF-8 HTML；取消可中断等待，且受本轮总超时限制。
- 只解析 HTML，不执行 JavaScript。排除脚本/样式等文本，解码实体、合并空白；引文必须与标题或正文精确匹配。登录墙、反爬、动态页面或 PDF 应换用可核对的原始 HTML 来源。
- canonical 去除 fragment、`utm_*`、`fbclid`、`gclid`，其余参数排序；按 URL 去重。已有文章保持 ID，后续更新当前内容，历史快照不变。
- 来源名取 hostname。发布时间仅取带时区的页面发布元数据，缺失/矛盾为 null；事件时间不猜测、为 null；抓取时间由 Backend 记录。

报告、文章/关联、快照与 Run/Turn 成功在同一事务提交。网络、解析、引文或存储失败不生成可发布报告；取消/超时的迟到结果不写成功。重启中断，不自动重试。

`validated` / `source_only` 仅表示结构与引文关联，文档仍为 pending。引文匹配不能证明摘要忠实、事实准确或满足时间范围，必须人工核对。生成不批准、不归档，见 [人工批准与归档](PUBLISHING.md)。

常见错误：`invalid_topic`、`workflow_run_finalized`、`turn_limit`、`source_http_failed`、`source_content_type`、`source_timeout`、`invalid_source_address`、`report_invalid_json`、`report_schema_invalid`、`report_duplicate_article`、`report_evidence_invalid`。在 Run 中查看错误，修正 prompt/来源后以新键重试。

## 升级与历史

迁移 5 停用 `news-github`；不再采集 RSS，移除 `/api/news/sources`。迁移 1–4、旧文章、报告、快照及批准/归档记录全部保留，旧报告仍可查询与审核归档。RSS 表仅兼容读取，不作为新输入。

[历史 RSS 验证](validation/NEWS_PIPELINE.md) 不能证明当前主动搜索能力；当前证据见 [Codex 研究验证](validation/CODEX_RESEARCH.md)。
