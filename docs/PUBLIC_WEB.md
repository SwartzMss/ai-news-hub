# 公共阅读站与 RSS

Issue #8 使用 React 组件和 Vite 在构建时渲染真实静态 HTML：门户首页、开源频道、来源详情、日期归档与不可覆盖的版本页。只发布独立 `dist/web`；浏览器不连接 Backend，不包含管理写操作，即使本机离线也能阅读已生成历史。当前实际数据合同只有 opensource，其他频道不展示假内容。

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

每个输入文件须符合 [archive v1 Schema](schema/report-archive-v1.schema.json)，文件路径必须为 `YYYY/MM/DD/opensource/vNNNNNN.json` 且与内部日期/版本一致。只接受 approved、source_only 数据；拒绝未知字段、非法来源协议/凭据、重复条目/报告 ID、符号链接、意外文件与 XML 1.0 非法字符。每个 JSON 最多 256 KiB、最多 10000 份报告；超出失败，不截断归档。

同日期/频道展示最高版本；所有版本仍生成独立页面。当前列表与 RSS 只使用各日最新版本，修订移除的条目不会从旧版本混回来；历史版本正文完整保留，详情链接则指向该来源目前保留的最新内容。跨日相同条目 ID 合并为一个来源详情，URL 为 ID 的 SHA-256 前 32 位；不根据标题生成容易改变的链接。详情/归档明确区分事实摘要、分析推断、精确引文和三类来源时间，人工允许发布不代表独立事实核验。

| 路径 | 内容 |
| --- | --- |
| `/` | 最新一期门户首页、重点条目 |
| `/channel/opensource/` | 按日报日期、重要性排列的当前来源列表 |
| `/news/<stable-key>/` | 来源事实摘要、分析、引文、原文链接与时间 |
| `/archive/` | 可用日期与当日最新日报 |
| `/archive/YYYY-MM-DD/` | 当日最新版本 |
| `/archive/YYYY-MM-DD/opensource/vNNNNNN/` | 完整历史版本 |
| `/rss/all.xml`、`/rss/opensource.xml` | RSS 2.0 全站/频道订阅 |
| `/data/index.json` | 仅公开日报/来源的静态索引 |
| `/sitemap.xml`、`/robots.txt`、`/404.html` | 站点索引与真实不存在页面 |

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
