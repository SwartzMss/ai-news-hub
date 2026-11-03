# Issue #8 公共站验证

## 已完成的本地验证

使用 Node 22.19.0、React/Vite 及独立两日期 DEMO archive-v1 样本，生成首页、开源频道、来源详情、日期归档及 v000001 历史版本，另有 404、RSS、静态索引、sitemap/robots/安全头。样本链接引用真实公开 GitHub Blog，明确标注演示，不构成正式日报，也不替代人工批准流程。

本地 Chromium 真实浏览器验证：

- 门户首页、频道、来源事实摘要、分析推断、两日期归档及历史版本可访问。
- 历史版本物理路由刷新有效；禁用 JavaScript 后首页仍能阅读。
- 明暗主题按钮有效；390px 首页/频道/日期/归档无横向溢出。
- RSS 端点返回标准 XML，公共 `/admin/` 为 404，pageerror=0。
- 模拟 Pages CSP 后脚本/样式正常；桌面与窄屏截图仅保留本地临时目录，不提交生成站点。

本地 lint、typecheck、build 与完整 npm test 均通过：142 项 Node + 10 项 Admin 测试。自动化覆盖严格归档 Schema、文件路径/版本一致、修订选择、旧版本保留、移除条目不复活、符号链接拒绝、生产禁止 DEMO/TEST、XML 转义/非法字符、稳定 GUID、全部静态路由及产物无 Admin/API/SQLite/凭据/源码映射。审查发现并修复了全局 build/ ignore 导致源码漏跟踪、以及 XML 1.0 禁止字符失效问题；构建源码已移至 generator/。

## 尚未完成的平台验收

检查连接目录、相关环境变量名、可用插件与 Wrangler 4.156.2 whoami 后，未发现 Cloudflare Pages 接入，CLI 明确返回未认证。没有创建 Pages 项目、没有部署、没有实际 HTTPS URL，也未声称 Git 自动部署成功。必须由账户所有者登录并授权 Cloudflare GitHub App 后，按 [部署配置](../PUBLIC_WEB.md) 实际验证。

因此 Issue #8 的 Cloudflare HTTPS/自动部署验收保持未完成；公开代码与本地构建可以独立审查。`SITE_URL` 的 demo.invalid 或文档项目占位只用于本地/配置示例，不是已上线站点。原生 Linux 服务账户/systemd/长期认证继续由 #2 跟踪，不增加 Windows/WSL 部署支持。
