# Issue #7 GitHub 归档验证

2026-11-03 在非 root 开发会话运行真实 Backend 和 GitHub Adapter，通过受保护管理 API 先批准、再归档明确标记的测试日报。测试使用既有真实 RSS 候选中的来源标题与精确引文，不调用模型、不发布未经人工确认的原日报。

| 项目 | 结果 |
| --- | --- |
| 仓库 | SwartzMss/ai-news-hub |
| 独立测试分支 | `archive-validation/issue-7`，不修改 main 的日报 |
| 测试报告 ID | `issue7-archive-test-20261103` |
| 标题 | `[TEST ISSUE-7] GitHub archive verification — not a production daily report` |
| 文件 | `reports/2026/11/03/opensource/v000002.json` |
| Commit | `bb8cc0383a10ab5ce9c91b7c7654ec8de0efdc12` |
| GitHub 提交时间 | `2026-11-03T01:40:44.000Z` |
| Publication ID | `2bda71c9-39b7-427c-83a8-9b2b80d59519` |
| 重复归档 | 同记录、同 SHA，attempts=1，没有新 Commit |
| 远端核对 | GitHub 读取 JSON，报告 ID 与测试标记一致，包含 1 条真实来源 |
| 数据范围 | 仅该 JSON；没有 SQLite、凭据、Cookie、Agent 原始日志 |

可查看 [测试提交](https://github.com/SwartzMss/ai-news-hub/commit/bb8cc0383a10ab5ce9c91b7c7654ec8de0efdc12) 和 [测试 JSON](https://github.com/SwartzMss/ai-news-hub/blob/archive-validation/issue-7/reports/2026/11/03/opensource/v000002.json)。来源为 [GitHub Game Off 2026 主题公告](https://github.blog/open-source/gaming/game-off-2026-the-theme-is-shift/)。测试标题与摘要明确表示流程测试，不作为生产日报或正式公开内容源。

数据库及 verification.json 只在本地 0700 临时目录、0600 文件保留。凭据仅内存使用已有 GitHub CLI 授权，不将其写入仓库、HTML、配置样例或 Codex 环境。正式部署须使用选定仓库 Contents read/write 的最小权限凭据，本次开发账户授权不代表已完成服务账户凭据配置。

## 自动化与审查

测试覆盖待审核/草稿/失败 Run 禁止发布、源字段/关联篡改、显式哈希批准、严格归档 Schema、相同内容/日期/版本幂等、跨日期及修订路径、新 Token 轮换不改变记录、错误不泄露凭据、远端同路径冲突拒绝、丢失成功响应后的恢复、HTTP 401/403/404/429/500、并发拒绝、关闭中断/重启可重试，以及 API 鉴权和后台分步操作。独立审查发现的 Token 参与幂等键问题已先复现再修复。

本地 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 全部通过，134 项 Backend + 10 项 Admin 测试通过。浏览器读取临时数据库副本中的真实 SHA 并重复归档，未再次调用远端；390px 窄屏无横向溢出，pageerror=0，截图仅保留本地临时目录。远端内容按字节比较，非法 UTF-8 替换字符差异也会拒绝。CI 仅使用模拟 GitHub，不包含真实仓库写入。开发环境为 Ubuntu 22.04 / WSL2，不新增 WSL 支持；原生 Ubuntu Server 24.04、systemd、服务账户与长期认证仍由 #2 跟踪。
