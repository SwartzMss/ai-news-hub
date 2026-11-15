# 公共阅读站与 RSS

Issue #8 使用 React 组件和 Vite 在构建时渲染真实静态 HTML：话题首页、搜索、来源详情与不可覆盖的日期/版本页。只发布独立 `dist/web`；浏览器不连接 Backend，不包含管理写操作，即使本机离线也能阅读已生成历史。话题来自已归档任务，文章 category 只是条目标签，不作为一级话题。未归档的任务不生成空话题。

## 构建

```bash
npm ci --ignore-scripts
SITE_URL=https://your-project.pages.dev npm run build:web
```

`SITE_URL` 必须为稳定 HTTPS origin，不能带路径、查询串、fragment 或用户凭据。使用自定义域名时设置为该域名；RSS GUID 不依赖域名，但 canonical 和站内绝对链接依赖它。构建所需 Node 为 22.19.0 或更新的 22.x。

默认只读取当前 checkout 的 `reports/`。也可显式指定 `PUBLIC_REPORTS_DIR=/absolute/path/to/reports`，用于 CI 中预先检出的公开归档目录；它是构建进程的文件路径，不会进入客户端。默认 reports 不存在时展示无日报空状态；显式目录不存在则失败。构建不访问数据库或抓取外部新闻，不自动使用 demo。

本地预览可运行 `python3 -m http.server 4173 --bind 127.0.0.1 --directory dist/web`，然后访问 `http://127.0.0.1:4173/`。此命令只预览静态文件，不解释 Cloudflare `_headers`；浏览器验收脚本另外模拟 CSP。不要将整个仓库或 dist 根目录作为 HTTP 静态根。

`npm run build:web:demo` 使用 `tests/fixtures/web-reports` 的两个日期样本，所有页面有显著演示声明，RSS 标题/内容标记 DEMO，robots 与 meta 禁止索引。样本引用真实公开 GitHub Blog 链接，日期和摘要仅验证产品结构，不声称是当日真实报道。`https://demo.invalid` 只是本地默认链接占位；如需部署独立演示预览，须明确设置它实际的 `SITE_URL`。正式构建拒绝 TEST/DEMO 标记，不得把 #7 的测试分支作为生产来源。

## 数据与历史

输入只接受统一的 [archive v1 Schema](schema/report-archive-v1.schema.json)。所有话题共用同一数据契约：根对象必须包含 `topic`，每条目必须包含 `details`；`details.kind` 分别为 `project`、`investment` 或 `news`，`research_area` 仅用于开源项目。新归档统一写入 `topics/<topic-id>/YYYY/MM/DD/vNNNNNN.json`，路径须与话题/日期/版本一致。Schema 严格拒绝未知字段，热点新闻不允许平台热度、转载、讨论等内部研究字段进入公开数据。只接受 approved 数据及约定的 source_only/codex_reported 来源模式；拒绝非法来源协议/凭据、重复条目/报告 ID、符号链接、意外文件与 XML 1.0 非法字符。每个 JSON 最多 256 KiB、最多 10000 份报告；超出失败，不截断归档。

同话题/日期展示最高版本；所有版本仍生成独立页面。当前列表与 RSS 只使用各日最新版本，修订移除的条目不会从旧版本混回来；历史版本正文完整保留，详情链接则指向该来源目前保留的最新内容。同话题跨日相同条目 ID 合并为一个来源详情，来源键统一为 SHA-256(topic-id + ":" + item-id) 前 32 位。不同话题的相同来源 ID 使用不同键。详情/归档明确区分事实摘要、分析推断、精确引文和三类来源时间，人工允许发布不代表独立事实核验。

| 路径 | 内容 |
| --- | --- |
| `/` | 按日期合并展示各话题的最新一期 |
| `/topics/<id>/` | 该话题的最新一期 |
| `/topics/<id>/news/<stable-key>/` | 该话题的来源详情 |
| `/search/` | 跨话题文章搜索（最近 30 个北京时间自然日） |
| `/topics/<id>/archive/YYYY-MM-DD/` | 该话题当日最新版本 |
| `/topics/<id>/archive/YYYY-MM-DD/vNNNNNN/` | 该话题完整历史版本 |
| `/rss/topics/<id>.xml` | 该话题独立 RSS |
| `/rss/all.xml`、`/rss/opensource.xml` | 兼容全站订阅 |
| `/data/index.json` | 仅公开日报/来源的静态索引 |
| `/data/search-index.json` | 最近 30 个北京时间自然日的轻量文章搜索索引 |
| `/sitemap.xml`、`/robots.txt`、`/404.html` | 站点索引与真实不存在页面 |

保留 `/channel/opensource/` 作为话题目录入口；不再生成旧版无话题归档路径、未映射的 legacy 话题或 `reports/topics.json` 归属映射。

RSS 最多包含 100 个当前来源条目，GUID 为 `urn:ai-news-hub:article:<stable-key>`，修订与重复构建不会更改。pubDate 使用该 ID 最早人工允许发布的时间；来源原始发布时间另列在描述/详情，不用抓取时间冒充。链接指向静态详情，描述另含原文 URL。XML 文本统一转义，非法字符拒绝构建。输出不使用当前构建时钟，因此同一输入内容确定。不提供账户、管理台、收藏同步或语义搜索；站内搜索只匹配最近 30 个北京时间自然日内的文章标题、事实摘要、话题名称、分类和开源研究方向。

## 站内搜索

构建阶段从当前公开归档生成独立的轻量搜索索引，范围为最近 30 个北京时间自然日（含截止日），并按稳定文章 key 去重；同一文章跨报告或修订重复出现时，使用当前可访问的最新内容。搜索索引只包含标题、事实摘要、话题、日期、分类/研究方向和站内详情链接，不复制完整详情、来源证据或内部研究数据。浏览器仅在打开搜索页并输入关键词时读取该静态 JSON，多个空格分隔的关键词按 AND 匹配，结果按报告日期倒序。索引随正常 Pages 构建更新；过期报告经既有 30 天清理后不会再进入索引，构建本身也会按北京时间窗口过滤，避免清理延迟导致旧内容进入搜索。搜索页不加入 sitemap 并设置 noindex。该功能不连接 Backend，不新增数据库、外部搜索服务、Prompt 或报告 Schema。

## Cloudflare Pages Git 集成

需要真实 Cloudflare 账户的 GitHub App 授权；仅提供本仓库权限。先在 Cloudflare Workers & Pages 中选择 Pages → Connect to Git → GitHub → 本仓库，创建 Git 集成项目（建议名 ai-news-hub，以实际可用名称为准）。不要先用 Direct Upload 创建同名项目：这不是 Git 自动构建接入的替代。

配置：

| 项目 | 值 |
| --- | --- |
| 仓库 | `SwartzMss/ai-news-hub`（或拥有代码及正式 reports 的仓库） |
| Production branch | `main` |
| Root directory | 仓库根目录，留空 |
| Framework preset | None，使用自定义构建命令 |
| Build command | `npm run build:web` |
| Build output directory | `dist/web` |
| `NODE_VERSION` | `22.19.0` |
| `SITE_URL` | 实际稳定生产 origin，例如 `https://<project>.pages.dev` |

Pages 会安装根目录锁定依赖，不需要启动 Backend 或设置管理/发布 Token。初次 main 尚无日报时正确展示空状态。将 #7 发布目标配置为同仓库生产分支后，新增正式 reports JSON 的 GitHub 提交会触发 Pages 构建，页面和 Feed 一起更新。可将构建 watch paths 限为 `apps/web/**`、`reports/**`、`docs/schema/**`、`package.json`、`package-lock.json`。同时保留依赖和配置变更触发；不要仅监听 reports。

如果归档位于另一仓库或分支，默认构建不会自动读取它，另一个仓库的提交也不会自动触发本项目：必须在构建前安全检出对应 reports，并配置受限部署 Hook 或 GitHub workflow 触发。私有归档所需只读凭据只在构建秘密中使用，不使用 `VITE_*`，不写入生成数据/HTML。本次不自动创建这些跨仓库凭据或将测试分支连到生产。

生产 Git 集成授权应在 Cloudflare 界面完成，Private Repo 也须明确授权该 GitHub App；仓库私有不代表最终网站私有。HTTPS、Pages URL 和后续自动构建必须实际验收后才能勾选 Issue #8 的上线项。代码/本地构建成功不能代替平台部署成功。

## 公开边界

唯一上传目录为 `dist/web`。Vite 禁用 publicDir 自动复制与 sourcemap；生成器只写已定义的 HTML/资源/公开 JSON/RSS/站点文件，不复制仓库文件，不读取 SQLite，不引用 Admin API。`dist/web-render` 是构建用 React SSR 模块，`dist/admin` / `dist/apps` 是私有服务产物，均不得上传。Pages `_headers` 限制 CSP、禁止内容类型嗅探与 referrer 泄露；静态路径不存在时返回 404，不做 Admin/API fallback。

CI 的 `npm test` 包含公开站构建、路由/两日期/历史版本、Schema/链接/路径、RSS XML/GUID/字符、生产测试数据隔离及敏感产物断言；`npm run typecheck` 同时检查 Web。浏览器另验证移动端、主题、无 JS 阅读和 CSP。参见 [验证记录](validation/PUBLIC_WEB.md)。

官方参考：[Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)、[Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[Build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)。

统一归档 v1 支持 verification=codex_reported 与 fetched_at=null，表示来源由 Codex 提供而非 Backend 抓取。公共页面和 RSS 不展示不存在的抓取时间。所有条目必须包含面向读者的结构化 details；前端按 kind 渲染，不过滤或修正内部研究字段。

公共阅读站的数据仍按任务话题组织：一个任务对应稳定话题。首页把每个话题的最新一期按报告日期倒序合并，同一天只显示一个日期标题，保留各报告中的条目顺序；顶部不展示话题切换入口。列表中的每篇文章先显示去掉开头「每日」的话题名，再显示原有细分类别或开源研究方向。历史 `?topic=<id>` 参数不再筛选首页内容。搜索覆盖最近 30 个北京时间自然日；话题详情、日期/版本页和 RSS 保留，GitHub 归档 JSON 不改写。

首页采用编辑式阅读布局：页面使用暖白/浅灰背景、深色正文和低饱和绿色强调色，桌面、平板和手机端均使用同一条合并信息流，日期与列表使用同一版心和左边界。首页采用单栏资讯列表，不显示右侧或折叠式本期目录。简报页眉只保留日期和星期，不显示“围绕当前话题整理”等说明或生成时间。所有资讯采用相同的行样式、标题字号、摘要层级和展示面积；开源项目按既有五个研究方向排序，并将方向名称作为文章下方分类标签；各话题保留日报条目顺序，不新增重要性排序或排名，也不设置“今日重点”、头条、精选或置顶；分类标签仅表达内容类别。保留既有 RSS Feed 地址和各页面的自动发现链接，不新增可见 RSS 入口。标题仍链接到含分析与引文的详情；完整原文保留在归档和详情中。正文只将显式 HTTP(S) Markdown 链接渲染为安全外链，其余内容按文本转义；不执行 HTML、不加载外部图片。已有话题页面保留独立链接；RSS 继续通过既有 Feed 地址和各页面的订阅发现链接提供。独立开源话题页按 AI Agent、Rust、多媒体、性能与安全、去中心化基础设施分组；项目详情按概览、更新、技术要点、适用场景、许可证、评价限制和证据分节阅读。项目详情页采用限宽正文与右侧本文目录/本期其他项目布局；窄屏隐藏右侧辅助栏，面包屑保留话题入口；旧归档仅展示已有事实，不补造技术信息。其他资讯维持原详情布局。资讯详情页头的所属日报日期只在面包屑导航中显示，分类单独显示。原文发布时间等来源元数据位于“来源与引文”。

本期目录按实际条目生成锚点，支持点击跳转和滚动位置高亮；刷新带话题与锚点的 URL 仍能定位。样式与目录作为正式组件构建，不依赖效果稿。

公共邮件订阅作为可选功能：Pages Functions 处理订阅确认与退订，独立 D1 保存私有订阅/发送状态，GitHub Actions 按上海时间每日触发汇总，Resend 负责实际发送；不连接私有 Backend 或向 Codex 暴露邮件凭据。默认关闭，演示站禁用，需完成发件域名、密钥和 D1 配置才可验收真实投递。见 [邮件订阅](NEWSLETTER.md)。

公共站 Footer 仅保留一行版权信息。GitHub、Contact、Subscribe 与明暗切换统一放在共享 Header，Header 不显示话题入口；Contact 暂时链接到仓库 GitHub Discussions（当前未配置公开联系邮箱）。启用邮件订阅时，Header 显示中性白色 Subscribe 按钮，邮件图标使用 18px 尺寸；点击后打开轻量原生 dialog，邮箱表单在弹窗内提交。弹窗复用原有订阅 API、确认邮件与退订流程，不改变 D1/Resend 逻辑；关闭邮件订阅时不显示 Subscribe 按钮和弹窗。

## 科技投资研究详情

归档条目存在 `details.kind=investment` 时，静态站显示专门的研究详情：事件背景、核心数据表、产业链影响、投资逻辑、观察指标、风险、可用时的估值和补充证据；桌面提供本文目录，窄屏保留可横向阅读的数据表。指标区分实际值、公司指引、市场预期、估算和推断，产业链区分已确认关系与潜在影响。补充来源由模型提供，页面不声称 Backend 已独立核验。没有 details 的历史归档继续使用原详情与原 URL。

投资详情按规范化 URL 合并主来源和重复补充来源；同一原文只出现一个外链，原证据 ID 仍跳转到对应可见来源。仅有空白数据的可选章节不显示，归档正文和来源记录保持原样。

## 热点新闻详情

归档条目含 `details.kind=news` 时，静态页分节展示背景、关键事实、时间线、各方表态、影响、未确定事项、观察点及补充证据；只展示存在的可选章节，桌面有本文目录，窄屏事实表可横向阅读。事实性质和已观察/分析影响明确区分，证据 ID 链接到补充来源。主来源与 Codex 引文仍照常显示；来源校验不代表独立事实核验。
