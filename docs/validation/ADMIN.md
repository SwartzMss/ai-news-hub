# Issue #6 管理后台验证

2026-11-03 开发会话使用 Node 22.19.0、真实 Backend、Chromium 与 stdio Codex 验证独立 `/admin/`。临时数据库复制先前 #5 的真实新闻历史，管理 Token 随机生成并只在进程/页面内存，不提交凭据、数据库或原始日志。

## 浏览器结果

- 从登录 → 任务总览 → Codex connectivity sample → 手动执行 → Run 详情，真实 Turn 成功输出 `AI_NEWS_HUB_TASK_OK`。
- Thread `01a19ef5-a0a1-7c81-b8c3-dbdfe8706af4`；Turn `01a19ef5-a0d1-7d12-a24f-ca25f179771d`。
- 刷新清除页面认证，重新输入 Token 后回到原 Run，时间/状态/日志/结果可查询。
- 从 `news-github` Run `fb3f47d0-98c3-45c9-a682-008cec908d72` 读取 #5 真实生成的日报，正确展示 5 条及来源、时间、待审核提示。本次未重新生成或发布新闻。
- 390px 窄屏无页面横向溢出；浏览器 pageerror 为 0；localStorage/sessionStorage 均为空。桌面/窄屏截图仅存本地临时目录。
- 浏览器所处开发环境为 Ubuntu 22.04 / WSL2，不添加 WSL 部署支持；原生 Ubuntu Server 24.04 服务账户/systemd/长期认证继续由 #2 验收。

## 自动化与审查

新增静态入口集成测试及 9 项前端测试，覆盖 Task → Run、手动幂等提交、防重复点击、服务不可用、Token 错误/关闭/会话失效、安全来源/报告输出、未知时间与空报告。独立审查发现的迟到 POST 与错误响应 body 中断竞态均已先复现再修复：退出/切换取消请求，旧响应不能改变当前路由或清除新会话。

本地 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 均通过，包含 118 项 Backend 测试和 9 项 Admin 测试。`npm test` 包含后端及 Admin 交互测试。Ubuntu 24.04 CI 同步执行这些检查、shell 和 systemd unit 静态检查，真实模型验证不放入 CI。


## 2026-11-04 管理界面重设计

独立浅色工作台覆盖初始化/登录、任务总览、研究输入、Run 会话/日志/运行信息、设置、日报和批准归档；没有改动 Backend 或数据库迁移。原有认证、内存会话、显式批准、发布和请求幂等边界保持。

- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 通过。全套包含 148 项 Node 测试和 19 项 Admin 测试；增加当前导航与标签键盘操作验证，保留日志翻页/标签切换中的草稿和不确定请求重试验证。
- Chromium 访问真实 Fastify / 临时 SQLite，验证两项密码初始化、登录、配置持久化、Token 不回显、研究/显式生成、独立批准/归档、改密码、退出和重启。模型、原文响应、GitHub 写入均使用模拟，不消耗真实模型额度或写入外部仓库。
- 375 / 768 / 1024 / 1440px 下检查初始化、总览、设置、研究输入、会话与日报，无页面横向溢出，页面 JS 错误为 0。检查移动设置分区定位和减少动态效果偏好；截图存本地临时目录，不提交测试凭据/日志。
- 独立审查后修正移动分区标题遮挡、任务暂停状态显示，以及不能继续的 Run 的误导性文案。此验证不替代原生 Linux 服务部署或 Cloudflare 验收。
