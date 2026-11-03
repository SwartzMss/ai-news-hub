# Codex 主题研究验证

日期：2026-11-03。开发环境为当前 Linux 开发会话、Node.js 22.19.0、Codex CLI 0.166.0；不替代原生 Ubuntu Server 24.04 服务账户/systemd 和长期认证验收。

## 自动检查

- `npm run lint`、`npm run typecheck`、`npm run build` 通过。
- Backend/公共站 143 项测试通过；Admin 14 项通过（含最后追加的日志分页保留输入/幂等 payload 回归）。
- 新覆盖主题/prompt 必填、幂等参数冲突、同 Thread 多轮、显式生成、引文失败后修正、原子回滚、最终生成后只读和旧报告归档兼容。
- 来源测试覆盖 URL/公网地址限制、混合 DNS 拒绝、DNS 取消、HTML 正文/实体、排除脚本、发布元数据、重定向/类型/体积限制。
- stdio 测试覆盖 start/resume 实时搜索配置、逐个关闭继承的 MCP 和拒绝其他工具。原有审批、取消、协议、凭据、历史和公开 RSS 测试保留。
- 依赖检查无已知漏洞。生产使用 parse5 解析 HTML；sax 仅为公开输出 RSS 的 XML 测试依赖，生产 RSS 采集模块已删除。

测试对新闻网络、模型和 GitHub 写入使用模拟，不消耗模型额度，不发布真实内容。日志保存在仓库外临时目录。

## 真实 Codex 协议与搜索

使用当前已认证 Codex 执行两轮最小研究：第一轮实时搜索并打开一个 AI 模型官方公告，第二轮恢复同一 Thread，保留上一轮原文标题/链接并补充一句说明。结果为成功，Thread 相同、两个 Turn 不同，记录到 2 次 webSearch 工具事件。原始回复和标识仅存私有临时目录，没有提交仓库或归档。

独立审查在临时 CODEX_HOME 构造本地无害 MCP 服务，验证空 mcp_servers 表会深度合并、不能禁用继承配置。修复为 config/read 后逐个 enabled=false，真实 App Server 0.166.0 确认 MCP 进程未启动、状态 disabled。该协议检查不调用模型，也不读取真实凭据。

上述真实模型记录仅证明搜索/Thread 续轮，不是完整真实日报验收。对模型选出的一个公开页面尝试 Backend 实际验证时返回 source_http_failed（非 200），没有保存报告；没有以模拟来源冒充真实生成成功。当前最终 Schema/来源/日报事务和审核归档链路由下述可控测试证明，正式来源可访问性仍须按部署网络逐个验证。

## 浏览器操作

Playwright + Chromium 驱动真实 Fastify Backend/临时 SQLite，模型、HTML 来源和 GitHub 写入模拟：

1. 登录，选择 Codex 主题新闻研究，填写主题和初始 prompt。
2. 继续第二轮筛选，第三轮显式生成，全部使用同一个 Thread。
3. 预览来源/日报，确认已生成 Run 不再显示继续输入。
4. 人工批准并归档，刷新归档记录，写入次数为 1。
5. 刷新页面重新登录，报告和历史仍存在；390px 无水平溢出，pageErrors 为 0。

## 文档和图示

README、架构、路线图、部署、API、数据模型、后台、归档及 AGENTS 同步为 Codex 入口。历史 RSS 验证明确标为历史；迁移 1–4 SQL 保持原值，仅追加迁移 5，旧任务停用且历史保留。

README GIF 与静态 SVG/source 同步更新，1000×480、57 帧、9.64 秒循环，约 123 KiB；图中输入为主题/prompt，输出 RSS 保留。原生 systemd 与 Cloudflare 仍标 pending。
