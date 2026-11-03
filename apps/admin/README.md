# 本地管理后台

独立 React/Vite 应用，按 Task → Run 展示真实状态、日志与待审核日报。根目录 `npm run build` 后由 Backend `/admin/` 提供，不单独部署公开 Vite 服务。

运行与访问边界见 [后台说明](../../docs/ADMIN.md)。Token 仅在页面内存，所有数据与操作使用受保护 API。此目录与 `dist/admin` 不属于 Cloudflare 公共站构建，`apps/web` 已提供独立公共静态构建。

新闻任务 news-research 支持主题、初始 prompt、同 Thread 多轮追问和显式生成待审核日报；不采集外部 RSS。见 [研究流程](../../docs/NEWS_PIPELINE.md)。

首次使用本机 setup-code 初始化管理员密码；系统设置保存运行参数与 GitHub 目标到 SQLite。`.env` 只保留监听地址/端口/数据目录，见 [配置与认证](../../docs/SETTINGS.md)。
