# 公共新闻阅读站

独立 React/Vite 构建时静态渲染首页、频道、来源详情、日期/版本归档，以及 RSS 2.0。输出仅为 `dist/web`，不依赖在线 Backend，不包含 Admin 或 SQLite。页面无需 JavaScript 即可阅读，小型浏览器脚本只切换明暗主题。

```bash
# 正式构建：使用当前 Git checkout 的 reports/；无日报时展示真实空状态
SITE_URL=https://your-project.pages.dev npm run build:web

# 显式演示构建：两日期测试样本，页面与 RSS 标记 DEMO，禁止搜索索引
npm run build:web:demo
```

运行部署、数据约束与 Cloudflare Git 集成见 [公共站说明](../../docs/PUBLIC_WEB.md)。不要用 `npm run build` 或整个 `dist` 作为公共 Pages 输出；它们属于私有 Backend/Admin。
