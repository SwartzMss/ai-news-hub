# AI News Hub — UI / UX 交互原型说明

**版本**：UI Prototype 0.1  
**状态**：Issue #8 公共阅读页已静态实现、部署待验收；Issue #6 本地管理后台已实现，见 [后台说明](ADMIN.md)
**设计方向**：新闻门户首页 + RSS 阅读器频道页 + 深度分析详情页 + 独立本地管理台  
**目标平台**：桌面 Web / 移动 Web，后台和定时调度运行于 Linux（Ubuntu Server 24.04 LTS，v0.1 Linux-only），本地生成结果可推送至 GitHub Private Repo，由 Cloudflare Pages 构建公开阅读站点。

## 1. 原型怎么使用

使用任意现代桌面浏览器打开 `prototype/index.html` 即可。原型不依赖 Node.js；正式运行环境仅支持 Linux。

所有内容均是演示数据，不是真实新闻、真实 RSS 或真实任务状态。`index.html` 中内置示例数据和状态机，不会访问外部网络，不会调用 Codex，不会写 SQLite，不会修改 GitHub 仓库。样例 RSS 路径仅是预期路由。

可以体验：栏目切换、日期切换、文章详情、收藏、关键词搜索、重要度筛选、排序、明暗主题、订阅弹窗、模拟管理任务，以及移动屏幕适配。

## 2. 产品定位与交互策略

- **首页（新闻门户）**：大主题 + AI 编辑精选 + 重要性排序，3 分钟读懂今天。
- **频道页（RSS 阅读器）**：高密度新闻流、筛选、来源与时间，快速浏览。
- **文章详情（AI 深度分析）**：事实、AI 影响解读、风险与待核验内容、来源证据链。
- **历史归档**：从日报 JSON 按天、按频道展示，不覆盖旧数据。
- **搜索页**：历史文章标题、摘要、标签搜索；第一版可构建静态检索索引。
- **RSS 订阅**：全站和频道的独立 RSS Feed；每条 item 的 guid 和 pubDate 稳定。
- **本地管理台**：计划任务、运行状态、进度日志、手动触发、重试；不与公开静态页面混合部署。

## 3. 页面和生产路由

| 页面 | 推荐正式 URL | 功能 | 版本 |
| --- | --- | --- | --- |
| 今日首页 | `/` | 今日编辑精选、综合时间线、摘要 | P0 |
| 频道新闻流 | `/channel/:slug/` | 分类、日期与重要度筛选 | P0 |
| 文章详情 | `/news/:id/` | AI 摘要、事实、分析、争议、原始来源 | P0 |
| 历史归档 | `/archive/` 和 `/archive/YYYY-MM-DD/` | 历史日报回看 | P0 |
| 订阅入口 | `/rss/all.xml`、`/rss/ai.xml` 等 | 全站 / 频道 RSS | P0 |
| 全站搜索 | `/search/` | 搜索静态文章元数据 | P1 |
| 收藏 | `/saved/` | 浏览器端收藏，跨设备同步后续考虑 | P1 |
| Linux 管理台 | `http://127.0.0.1:<port>/admin/` | 任务详情、Run 状态、日志、报告预览（仅本机/SSH 转发） | P0 |

演示版使用 `#home`、`#channel/ai` 等 hash 路由，避免直接打开单个 HTML 文件时发生路径 404；正式版不必照搬 hash 路由。

## 4. 核心操作路径

**读者首次进入**：首页 → 看到“今日重点” → 点击新闻 → 阅读事实与分析 → 查看原文 → 返回列表 → 订阅 RSS。

**高频 RSS 阅读者**：选择频道 → 日期筛选 → 按重要度排序 → “只看重点” → 打开文章 → 收藏 → 历史搜索。

**管理员**：安全访问 Linux 管理台 → 选择任务 → 查看某次 Run → 查看该 Run 的 Thread/Turn 与日志 → 审核内容 → 允许发布 → 归档 GitHub；Cloudflare Git 集成接入后可自动构建静态站与 RSS，该上线验收尚未完成。

## 5. 信息架构

公开阅读站导航：今日首页 / AI 科技 / 投资市场 / 开源项目 / 热点话题 / 历史归档 / 收藏。管理员后台单独入口，首页为任务总览；不在公开 Cloudflare 导航中放可访问的管理入口。

首页：顶部品牌与订阅 → 今日主题 → AI 精选头条 → 更多值得关注 → 右侧每日速览 / 关注主题 / RSS CTA。

频道页：频道简介 → 日期 / 重要性筛选 / 排序 → 紧凑新闻列表。移动端将侧栏压缩成横向可滚动频道导航。

详情页：标题 → 事件摘要 → 已核验事实 → AI 解读 → 争议与待确认 → 原始来源 → 相关文章。所有事实、推断、引用及时间信息必须区分展示。

## 6. 视觉规范

- **基础色**：纸白 `#ffffff`、页面灰 `#f6f7f6`、深墨色 `#162321`。
- **主色**：墨绿 `#086b58`；深色背景 `#073e35`；浅绿高亮 `#dceee7`。
- **组件**：较少大图片卡片，内容以标题与摘要为主；圆角 10–20px，轻边框，适量留白。
- **层级**：栏目名使用精简小号字；文章标题 15–24px；正文 13–16px；来源、时间、重要性为次级信息。
- **响应式**：桌面三列；中屏隐藏右侧信息栏；移动端隐藏左侧纵向侧栏、改为水平频道导航。
- **主题**：浅色为默认，同时支持深色。将主题切换状态保存在客户端（允许不可写存储回退）。

## 7. 建议组件拆分（React / Vite）

```text
src/
  app/
    routes.tsx
    layout/
      SiteHeader.tsx
      DesktopSidebar.tsx
      MobileChannelNav.tsx
      DailySignalRail.tsx
  components/
    ArticleList.tsx
    ArticleListItem.tsx
    FeaturedArticle.tsx
    SourceReferences.tsx
    RssSubscribeDialog.tsx
    DateSelector.tsx
    PriorityFilter.tsx
  pages/
    TodayPage.tsx
    ChannelPage.tsx
    ArticlePage.tsx
    ArchivePage.tsx
    SearchPage.tsx
    SavedPage.tsx
  admin/
    pages/TaskDashboard.tsx
    pages/TaskDetail.tsx
    pages/RunDetail.tsx
    components/TaskStatus.tsx
    components/AgentRunLog.tsx
    components/RunThreadTurns.tsx
  theme/
    tokens.css
```

注意，面向公众的静态站点与有权限操作能力的本地管理台，最终应在部署入口上隔离；可共享组件库，但不应将后台调用能力和私密配置打包进公开站点。

## 8. 与 GitHub 和 SQLite 的数据边界

- Linux 本地 SQLite（如 `/var/lib/ai-news-hub/news.db`）：任务、新闻原始记录、处理产物、运行日志、发布状态。
- GitHub Private Repo：只同步审核通过的日报 JSON / Markdown；按日期新增文件，不覆盖旧日报。不要提交 SQLite 主数据库或密钥。
- Cloudflare Pages：从已发布日报生成 HTML、静态搜索索引和 RSS 2.0。网站通常公开访问，即使源码仓库是 Private。
- Codex App Server：仅供 Linux Backend 本地通过 stdio 调用；不要直接暴露到公共网页。

## 9. 建议日报数据合同（示例字段）

```json
{
  "id": "stable-article-id",
  "report_date": "2026-11-02",
  "channel": "ai",
  "title": "...",
  "summary": "...",
  "facts": ["..."],
  "analysis": "...",
  "uncertainties": ["..."],
  "source_urls": ["https://source.example/actual-article"],
  "source_published_at": "2026-11-02T00:00:00Z",
  "event_time": null,
  "collected_at": "2026-11-02T01:00:00Z",
  "importance_score": 90,
  "verification_status": "reviewed"
}
```

以上只是结构示例，其中 `source.example` 是占位域名，不能发布为真实新闻。事件时间未知必须保留 null，不要自行编造。

## 10. MVP 验收与后续取舍

- [ ] 静态网页可访问当日和过去任意已发布日期的内容。
- [ ] RSS 2.0 可被阅读器解析，新日报追加、旧内容 GUID 保持稳定。
- [ ] 新闻详情包含真实且可打开的原始来源链接。
- [ ] 日期、来源发布时刻、事件时间分开标记；未核实信息明确展示。
- [ ] 手机端可完成频道浏览、阅读详情、订阅入口等核心流程。
- [ ] 未经认证的公网请求不能触发本地 Codex、任务配置或发布操作。

v0.1 同时完成：首页 / 频道 / 详情 / 归档 / RSS，以及最小的 Linux 任务后台（任务列表、手动触发、Run 状态、日志、结果预览）。主题与多轮新闻研究已在 v0.1 实现；任务定义编辑和工具审批交互后续完善。

## 11. 管理后台信息架构（任务为中心）

- 总览：今日任务状态和异常、最近生成日报。
- 任务列表与任务详情：调度信息、Prompt 摘要、手动运行、Run 历史。
- Run 详情：对应 Thread / Turn 事件流、日志、继续分析入口、结果预览。
- 内容及发布管理：审核报告、GitHub 提交记录、Cloudflare 构建状态。
- **Agent 不是独立一级导航项**；所有对话必须通过任务和某次 Run 进入。

原型中从公开阅读站可点击的「任务控制台」仅是演示时的导航便利，生产版必须从公开站点中隔离；后台地址只在 Linux 主机的 127.0.0.1 监听，远程访问初期可通过 SSH 本地端口转发。

## 12. Issue #6 已实现管理界面

独立 React/Vite `/admin/` 复用纸白、灰底、墨绿、轻边框和响应式视觉规范。登录后只展示任务导航：任务总览（最新状态/异常/时间）→ 任务详情（只读配置、手动执行、分页历史）→ Run（状态、时间、Thread/Turn、分页事件、Turn 输出、日报来源预览）。无独立 Agent 工作台。

管理 Token 为密码输入，仅当前页面内存持有；刷新需重输，路由和服务端历史保留。后台不可用、管理 API 关闭、Token 失效、任务失败/取消/中断和未生成日报均有独立提示。轮询间隔 2 秒，同一页面不重叠请求，退出/切换取消旧请求与迟到响应；手动提交失败的页面内重试沿用幂等键，避免网络不确定性重复执行。

日报展示来源事实摘要、推断、精确引文、来源链接与独立时间字段，明确待审核/source_only；不把 validated 显示为已核实。模型文本按 React 文本转义，不渲染任意 HTML/Markdown。Issue #7 已追加人工批准与 GitHub 归档的分步操作，展示目标/状态/错误/SHA；当前支持新闻主题/初始 prompt、同 Run 多轮继续和显式生成日报；不提供任务定义编辑或 Agent 工具交互审批。公开原型及其模拟后台仍只是演示，与真实 `/admin/` 分开。

## 13. Issue #8 公共阅读站

独立 React/Vite SSG 复用门户首页 + 阅读器式开源频道 + 分区来源详情，纸白/墨绿、三列桌面布局、窄屏水平导航、无外部图片依赖。当前只有真实合同支持的开源频道，不显示虚构热门分类或互动数字。浏览器 JS 仅切换主题，无 JS 仍可通过物理路径阅读。

首页按最新日报展示重点；频道汇总当前版本，详情区分来源摘要、推断、精确引文与三类时间。日期页和 vNNNNNN 历史版本页保持可直达/刷新；历史正文不被最新内容覆盖，详情链接指向目前保留的来源内容。演示模式页面与 RSS 都标记 DEMO，正式构建拒绝测试内容。公共站无 Admin 导航或管理 API。生产部署待接入 Cloudflare Git 集成，见 [说明](PUBLIC_WEB.md)。
