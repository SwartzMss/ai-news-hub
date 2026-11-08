# 公共阅读站与 RSS

Issue #8 使用 React 组件和 Vite 在构建时渲染真实静态 HTML：话题首页、来源详情、分话题日期归档与不可覆盖的版本页。只发布独立 `dist/web`；浏览器不连接 Backend，不包含管理写操作，即使本机离线也能阅读已生成历史。话题来自已归档任务，文章 category 只是条目标签，不作为一级话题。未归档的任务不生成空话题。

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

输入支持历史 [archive v1 Schema](schema/report-archive-v1.schema.json) 的 `YYYY/MM/DD/opensource/vNNNNNN.json`，以及带 `topic: {id,name}` 的 [archive v2 Schema](schema/report-archive-v2.schema.json) 的 `topics/<id>/YYYY/MM/DD/vNNNNNN.json`，路径须与内部话题/日期/版本一致。只接受 approved 数据及约定的 source_only/codex_reported 来源模式；拒绝未知字段、非法来源协议/凭据、重复条目/报告 ID、符号链接、意外文件与 XML 1.0 非法字符。每个 JSON 最多 256 KiB、最多 10000 份报告；超出失败，不截断归档。

同话题/日期/频道展示最高版本；所有版本仍生成独立页面。当前列表与 RSS 只使用各日最新版本，修订移除的条目不会从旧版本混回来；历史版本正文完整保留，详情链接则指向该来源目前保留的最新内容。同话题跨日相同条目 ID 合并为一个来源详情，新来源键为 SHA-256(topic-id + ":" + item-id) 前 32 位。历史 v1 来源保留原有 ID 哈希键及 GUID，映射后同话题的新归档继续复用；其他话题的相同来源 ID 使用不同键。详情/归档明确区分事实摘要、分析推断、精确引文和三类来源时间，人工允许发布不代表独立事实核验。

| 路径 | 内容 |
| --- | --- |
| `/` | 选择话题，仅显示所选话题的最新简报 |
| `/topics/<id>/` | 该话题的最新一期 |
| `/topics/<id>/news/<stable-key>/` | 该话题的来源详情 |
| `/archive/` | 话题归档目录 |
| `/topics/<id>/archive/` | 该话题按月份排列的期次 |
| `/topics/<id>/archive/YYYY-MM-DD/` | 该话题当日最新版本 |
| `/topics/<id>/archive/YYYY-MM-DD/vNNNNNN/` | 该话题完整历史版本 |
| `/rss/topics/<id>.xml` | 该话题独立 RSS |
| `/rss/all.xml`、`/rss/opensource.xml` | 兼容全站订阅 |
| `/data/index.json` | 仅公开日报/来源的静态索引 |
| `/sitemap.xml`、`/robots.txt`、`/404.html` | 站点索引与真实不存在页面 |

历史 `/news/<stable-key>/`、`/archive/YYYY-MM-DD/`、`/archive/YYYY-MM-DD/opensource/vNNNNNN/` 继续生成，canonical 指向对应话题页面；旧 `/channel/opensource/` 改为话题目录。可选的 `reports/topics.json` 仅为旧 v1 报告提供 `{schema_version:1, assignments:[{report_id, topic:{id,name}}]}` 归属映射，不改旧文件与哈希；未映射的 v1 归入“历史简报”。映射不得重复、引用不存在的报告或覆盖 v2 归属，非法映射会终止构建。

RSS 最多包含 100 个当前来源条目，GUID 为 `urn:ai-news-hub:article:<stable-key>`，修订与重复构建不会更改。pubDate 使用该 ID 最早人工允许发布的时间；来源原始发布时间另列在描述/详情，不用抓取时间冒充。链接指向静态详情，描述另含原文 URL。XML 文本统一转义，非法字符拒绝构建。输出不使用当前构建时钟，因此同一输入内容确定。没有基于全站数据的账户、管理台、收藏同步或复杂搜索。

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

归档 v1 现支持 verification=codex_reported 与 fetched_at=null，表示来源由 Codex 提供而非 Backend 抓取。公共页面和 RSS 不展示不存在的抓取时间；source_only 历史归档保持兼容。使用独立公共站构建器的部署需同步更新 Schema 与生成器后读取新归档。

公共阅读站按任务话题组织：一个任务对应稳定话题，首次归档后出现在首页选择器中；首页只展示当前话题的最新一期，每个话题有独立的日期/版本归档、详情与 RSS。同一天不同话题和相同来源条目互不覆盖。浏览器 localStorage 只保存话题 ID 与明暗偏好，首页有效的 `?topic=<id>` 优先于已保存偏好；禁用脚本或存储时仍可通过链接阅读。旧归档 JSON 不改写，兼容原有日期、版本与来源链接。

首页采用紧凑阅读布局：页面铺满浏览器宽度，桌面左侧只显示话题，中间显示日报，右侧显示可跳转的本期目录；窄屏将话题放回顶部、目录改为折叠入口。简报页眉从日期开始，不重复显示话题名称或“最新一期”标签，并突出显示星期与真实生成时间（北京时间）；目录底部不重复日期或话题名，移除重复期刊标题和进入/阅读整期入口。当前日报完整展示标题和事实摘要，标题仍链接到含分析与引文的详情；目录长标题最多显示三行，完整原文保留在归档和详情中。来源与分类位于正文下方，移除列表序号和大圆角容器。正文只将显式 HTTP(S) Markdown 链接渲染为安全外链，其余内容按文本转义；不执行 HTML、不加载外部图片。首页切换话题同步更新顶部归档入口；RSS 仍通过各话题页面的订阅发现链接提供。带官方仓库链接和可识别事实标签的开源项目详情按项目名、仓库、核心用途、技术要点、近期证据、适用场景、许可证及编辑判断分节阅读；项目详情页采用居中单栏，隐藏重复的话题侧栏，并在面包屑保留话题入口；正文限制阅读行宽；旧归档仅展示已有事实，不补造技术信息。其他资讯维持原详情布局。资讯详情页头的所属日报日期只在面包屑导航中显示，分类单独显示。原文发布时间等来源元数据位于“来源与引文”。

本期目录按实际条目生成锚点，支持点击跳转和滚动位置高亮；刷新带话题与锚点的 URL 仍能定位。样式与目录作为正式组件构建，不依赖效果稿。

公共邮件订阅作为可选功能：Pages Functions 处理订阅确认与退订，独立 D1 保存私有订阅/发送状态，GitHub Actions 按上海时间每日触发汇总，Resend 负责实际发送；不连接私有 Backend 或向 Codex 暴露邮件凭据。默认关闭，演示站禁用，需完成发件域名、密钥和 D1 配置才可验收真实投递。见 [邮件订阅](NEWSLETTER.md)。

公共站移除底部站名、归档与 RSS 链接栏；往期归档仍由顶部导航进入，RSS 文件及页面的订阅发现链接保留。启用邮件订阅时，表单单独显示在页面底部。页面容器最小高度覆盖视口，正文区域填充剩余空间，短归档和空页面的订阅表单贴住视口底部，长页面的表单排在正文末尾。
