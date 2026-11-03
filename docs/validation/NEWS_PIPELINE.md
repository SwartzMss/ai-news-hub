# Issue #5 新闻流水线验证

> 历史证据：固定 RSS 输入现已停用，当前 Codex 主题研究见 [新验证](CODEX_RESEARCH.md)。本记录不作为当前主动搜索验收。

## 真实 RSS 与 Codex

2026-11-03 开发会话在非 root 账户启动真实 Backend，调用受保护的 `news-github` 任务，使用真实 GitHub Blog RSS、stdio Codex 与私有 SQLite。当前开发环境为 Ubuntu 22.04 / WSL2；本记录不代表原生 Ubuntu Server 24.04 的 systemd、独立服务账户或长期认证验收，后者继续由 Issue #2 跟踪，也不新增 WSL 部署支持。

| 项目 | 结果 |
| --- | --- |
| RSS | `https://github.blog/feed/` |
| 来源成功时间 UTC | `2026-11-03T00:37:00.332Z`；无来源错误 |
| Run | `fb3f47d0-98c3-45c9-a682-008cec908d72`，`succeeded` |
| Thread | `01a19ed6-8c8b-7722-b127-66a4d2d122b5` |
| Turn | `01a19ed6-8ecd-7cd3-bafd-ea6b8ca58298` |
| 报告 | `966feac9-0298-47d9-b3c4-7e1a186e2279` |
| 来源记录 / 入选 | 10 / 5 |
| 格式/来源关联 | Schema 与候选 ID、精确引文校验通过 |
| 状态 | 数据库 `validated`，文档 `reviewStatus=pending` |
| 发布 | `publication_records` 为 0，无 GitHub/Cloudflare 发布 |
| 相同幂等键 | HTTP 200，返回同一 Run |

报告引用的真实来源包括 [Git 基础设施](https://github.blog/engineering/architecture-optimization/the-bridge-to-agent-scale-git-infrastructure/)、[Universe 2026](https://github.blog/news-insights/company-news/github-universe-2026-evolving-every-layer-of-the-stack/)、[Octoverse 2026](https://github.blog/news-insights/octoverse/octoverse-commits-pushes-reach-new-highs-in-2026-as-developers-build-with-agents/)、[2026 年 9 月可用性报告](https://github.blog/news-insights/company-news/github-availability-report-september-2026/) 与 [Copilot 会话衔接](https://github.blog/ai-and-ml/github-copilot/how-to-continue-a-github-copilot-app-session-in-vs-code/)。这些来源关联不等于报告内容已经人工审核或独立证实。

数据库和 JSON/Markdown 样本只保存在本机私有临时目录，不入 Git；管理 Token、代理配置、原始 RPC 和本地日志不入库。真实运行完成后，审查补充修正了来源更正更新策略，并以回归测试验证当前文章刷新、旧报告/候选快照不变。

## 自动化检查

模拟测试不访问真实新闻源或模型，覆盖 RSS 解析/实体防护/URL 规范化、canonical/GUID/指纹去重、频率限制与 304、失败不复用旧成功、重定向/大小限制、来源更正与弱别名分歧、严格 JSON 校验、来源字段由 Backend 补充、鉴权查询、幂等、无发布、工具事件拒绝、SQL 关联失败原子回滚，以及历史快照不变。

本地 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 均通过，117 项测试通过；完整测试需允许回环 HTTP 和子进程，受限沙箱中的失败不作为功能回归。Ubuntu 24.04 CI 同时检查 shell 与 systemd unit。CI 使用模拟外部服务，不替代上述真实调用和目标主机验收。
