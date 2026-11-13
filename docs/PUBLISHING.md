# GitHub 日报归档与自动发布

Issue #7 将来源校验通过、Run 成功且已人工允许发布的日报归档到明确配置的 GitHub 仓库/分支。没有默认发布目标、自动批准、自动重试或 Cloudflare 部署。公开阅读站和 RSS 由 #8 实现。

## 内容与归档协议

归档只输出严格 JSON。旧报告继续使用 [archive v1 Schema](schema/report-archive-v1.schema.json)，一般受管任务报告使用带话题的 [archive v2 Schema](schema/report-archive-v2.schema.json)；五方向开源日报使用 [archive v3 Schema](schema/report-archive-v3.schema.json)，在 v2 话题归档基础上要求每条目包含 `research_area`。代码中的 Schema 与对应文件保持一致：

- `schema_version: 1`、稳定 `report_id`、`report_date`（UTC 日期）、`channel`、报告 `version`、标题和采集时间。
- `review_status: approved`、批准时间与 `reviewed_content_sha256`；来源仍为 `verification: source_only`，人工允许发布不等于独立事实证实。
- 条目稳定 `id`、分类、重要性、`fact_summary`、单独的推断 `analysis`、精确依据 `evidence_quote`。
- 来源名称、原始/canonical URL、来源发布时间、事件时间、首次抓取时间；未知时间为 NULL。

历史 v1 路径为 `reports/YYYY/MM/DD/opensource/vNNNNNN.json`，例如 `reports/2026/11/03/opensource/v000001.json`。修订须生成新报告/版本，旧路径永不覆盖；其他日期也不改动。当前仅实现 opensource 频道。Markdown 保留于私有 SQLite 预览，不在本次额外提交。v2/v3 均使用 `reports/topics/<topic-id>/YYYY/MM/DD/vNNNNNN.json`；v3 仅用于带五方向分类的开源日报，消费者须支持三个版本。话题 ID 为 `t-` 加任务 ID 的 SHA-256 前 24 位，名字使用该 Run 的不可变配置快照；migration 10 持久化 `public_topic_json` 并在批准/归档时比对，不能从模型输出伪造。报告版本仍沿用数据库按频道/日期分配的序号，不保证某话题内部连续。历史报告的空快照及 v1 字节/哈希保持不变。

归档不包含 Run/Thread/Turn 标识、候选完整快照、Agent 输入/日志、SQLite、Token、代理配置或审批私密笔记。目标仓库已有的源代码/历史不由归档器复制或删除；应选择干净的专用归档仓库/分支。不要把管理后台和数据库目录作为公开产物。

主机需要代理时，使用 `npm run network:configure` 生成项目根目录的私有 `network.env` 并通过 systemd 或启动脚本加载。GitHub HTTPS 归档和删除客户端沿用 EnvHttpProxyAgent 读取 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 及其小写别名，配置说明见 [Linux 部署](DEPLOY_LINUX.md#代理网络配置)。

`DELETE /api/runs/:runId` 携带 `{ "confirm": true }` 可删除完整执行记录。有关联日报时逐份复用既有日报删除流程，清理所有历史 GitHub 归档目标与旧话题映射，再事务删除本地 Run、Turn、Thread、事件和研究快照。失败可重复请求，同一 Run 的并发删除共享结果，已有日报删除记录保留版本占用。共享来源原文保留。

## 管理 API

接口都在回环 Backend 的 Bearer Token 保护范围内：

| 方法 / 路径 | 输入与结果 |
| --- | --- |
| `GET /api/news/reports/:reportId/publication` | 当前内容 `contentHash`、关系状态、批准记录、是否已配置、安全目标信息及发布历史 |
| `POST /api/news/reports/:reportId/approve` | `{ "contentHash": "<GET 返回的 64 位哈希>", "confirm": true }`；明确确认已检查该版本 |
| `POST /api/news/reports/:reportId/publish` | `{}`；返回 `{publication}`，包括路径、仓库/分支、状态、尝试次数、SHA、URL、错误码和提交时间 |

后台新闻 Run 页面提供同样的两步操作。发布状态按当前仓库/分支的成功记录展示，更换目标后仍须显式点击“归档到 GitHub”；已有当前目标成功记录时，“刷新归档记录”只读取本地状态，不写远端也不重新验证远端文件存在。批准只记录人工许可，不调用 GitHub。归档未配置时返回 503 `publication_disabled`，报告仍可预览/批准。待审核直接归档返回 409 `report_not_approved`；内容或关联变动返回 `report_changed` / `approval_changed` / `report_provenance_invalid`。失败 Run、草稿、缺失来源/关联不允许批准或归档。

批准前重新依据不可变候选快照重建整个日报，比较来源模式、来源字段、URL 格式、报告日期/频道/ID、标题和文章关联；批准哈希绑定文档、版本、候选与关联。生成 JSON 始终保留原始 pending 快照，关系表记录 approved/published；批准后不可直接修改此版本，修订应显式生成新 Run/报告版本。当前没有撤销/编辑接口，只有同一受保护本地管理员身份，无多用户审批审计。

## 幂等、冲突与恢复

幂等键由仓库、分支、路径与归档 JSON 字节 SHA-256 计算，凭据不参与身份。已有 succeeded 记录直接返回该历史结果；不会重新验证远端是否被第三方删除。发布单实例串行，正在发布时其他请求返回 409 `publication_busy`；没有持久队列或后台自动重试。

GitHub 分支必须预先存在。先取得分支固定提交快照，再检查该版本路径：

1. 不存在：使用 Contents API create-only 写入，不提供更新 `sha`。并发冲突 409/422 留为失败，显式重试。
2. 已有相同字节：读取该路径在固定快照的最后提交，补记 SHA/提交时间，不创建 Commit。
3. 已有不同字节：失败 `archive_conflict`，禁止覆盖。确认目标、版本及历史，生成新版本处理，不删除远端文件规避冲突。

远端失败返回 HTTP 502 与失败 `publication` 对象，SQLite 保存安全错误码，不保存原始 GitHub 响应或凭据。常见为 `github_http_401/403/404/429/500`、`github_timeout`、`github_unavailable`、`github_invalid_response`。修复网络、认证、权限、分支或限流问题后，在同一报告显式再次调用 publish，复用记录并递增 attempts。

网络超时、进程退出或 GitHub 已提交但本地写入失败，都可能留下“远端已成功、本地未知”。启动将 publishing 标记 failed / publication_interrupted；重试通过远端字节核对恢复。只有收到并验证 Commit SHA/时间且本地事务提交成功，才标 publication succeeded 与 Report published；不跨网络持有 SQLite 事务。服务关闭会中断 HTTP 并等待发布记录结算后关闭数据库。

## 凭据与部署

见 [Linux 部署第 13 节](DEPLOY_LINUX.md#13-issue-7-人工批准与-github-归档)。限定目标仓库的 fine-grained PAT 只授予 Contents read/write；GitHub 自动要求的基础元数据读取权限保留。也可外部注入短期 GitHub App token，但本版本不自动续期。仓库、分支和 Token 在后台“GitHub 归档”填写并持久化 SQLite；Token 加密且不回显，留空保留、显式替换/清除。空闲时保存即生效，轮换不破坏幂等，执行中拒绝变更。见 [配置说明](SETTINGS.md)。不要复用管理 Token、放入 Codex 配置或 VITE 环境。

真实端到端验证见 [记录](validation/PUBLISHING.md)。专用 `archive-validation/issue-7` 分支只含验证用测试日报，不应作为 #8 正式内容来源。

协议参考：[GitHub Contents API](https://docs.github.com/en/rest/repos/contents)、[GitHub Commit API](https://docs.github.com/en/rest/commits/commits)、[Git refs](https://docs.github.com/en/rest/git/refs)。

## Codex 主题研究兼容

当前报告来自 news-research 的显式最终生成，发布时比对 codex_news_runs 的持久模式、内容快照和条目关联，不联网访问原文；来源可为不同公开 HTTPS 站点，不再限定 GitHub Blog。历史 RSS 报告仍按旧快照和原来源域名规则读取。两类报告均需最近 Run 成功、不可变文档和哈希授权记录（manual 或 automatic）。底层 opensource 频道键保持兼容；公共阅读边界由 v2/v3 话题归档区分。

## 任务自动发布

任务配置 `autoPublish` 默认 false。开启后执行快照中的 Prompt 全部完成且结构化日报保存成功，Backend 记录 `approval_kind=automatic`，然后复用现有 GitHub create-only 归档；手工批准记录为 manual。GitHub Contents API 成功即生成远端提交，无需本机 Git checkout/push。部署由目标仓库已有 CI/Cloudflare 集成负责，本服务不创建此集成。

自动推送失败保留日报、发布失败状态和安全错误码，可从发布记录重试。研究成功与发布成功分别呈现，不因一次推送错误重新消耗全部研究轮次。停止或日报格式不合格不触发后续发布。

当前日报来源模式为 `codex_reported`：Backend 不再联网核验原文或匹配引文，不再追加来源修复；保留 JSON/HTTPS 链接格式、数据关联和发布哈希检查。后端未抓取时 `fetchedAt/fetched_at` 为 null，不伪造原文发布时间或事件时间。历史 `source_only` 报告仍可读取和归档。

GitHub 归档不再设全局启用开关：仓库、分支和已保存 Token 完整即为可用；允许保存未完整配置，清除凭据后恢复未配置。旧 `github.enabled` 写入参数为可选兼容字段且被忽略，返回值表示派生配置状态，旧数据库中的 false 不再禁用完整目标。任务 `autoPublish` 继续独立控制自动归档。建议创建 fine-grained PAT，仅选择归档仓库并授予 Contents read/write；后台不展示已保存 Token。

GitHub 上传器同时允许历史 v1 日期路径与 v2 话题路径，话题 ID 必须为 `t-` 加 24 位小写十六进制；保留路径边界、256 KiB 大小上限和只追加检查。旧版上传器若对 v2 报告返回 `archive_invalid`，更新服务后可直接重试归档，无需重跑研究。

`DELETE /api/news/reports/:reportId` 接受 `{ "confirm": true }`。已归档日报按 publication_records 中的历史仓库、分支、路径和哈希删除，逐个目标处理；成功后删除本地日报。远端缺失视为已删除，内容变化拒绝操作；日报与对应 reports/topics.json 旧映射在单次 Git 提交内更新，ref 使用非强制更新防止覆盖并发提交。删除进度保存于 report_deletions，失败保留日报并禁止再次批准/发布，可重复调用删除恢复。没有归档记录的日报无需配置 GitHub。删除不清除 Git 历史、运行对话和来源原文。

## 可选投资详情的归档

归档 v1/v2/v3 条目均允许可选 `details`；缺少该字段的既有文件字节和审批哈希保持不变。发布前重建报告时完整比较 details，再将其写入归档和内容哈希；多来源仅表示 Codex 报告的证据归属，格式检查不等于 Backend 独立核验事实。

热点新闻 `details.kind=news` 与投资详情使用相同发布完整性重建：发布前按候选来源重建整份日报，比较包含详情在内的完整 JSON，再写入 v1/v2 归档。证据 URL 与引用须通过校验；这仍不构成独立事实审核。
