# 架构设计（草案）

> 当前为规划文档；接口、进程模型和数据表结构以 v0.1 实现与验证结果为准。

## 1. 系统边界

本项目采用“**本地执行 + 静态公开发布**”模式。

```text
┌───────────────────── Local Windows Host ─────────────────────┐
│ Scheduler → Collector → Normalize/Deduplicate → Job Queue    │
│                                                 │             │
│                                           Agent Adapter       │
│                                                 │ JSON-RPC    │
│                                          Codex App Server     │
│                                                 │             │
│                                       Structured Result       │
│                                                 │             │
│ SQLite ← Validation / Review / Publish Service ←─┘            │
│                                │                              │
│                                ├── Web Admin + SSE            │
│                                └── Static Export              │
└────────────────────────────────┼──────────────────────────────┘
                                 │ Upload / git push / deploy
                                 ▼
                         Static Hosting / CDN
                          ├── Web Pages
                          ├── RSS 2.0
                          └── JSON
```

## 2. 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| Collector | 拉取合法访问的 RSS / 网站 / API，记录来源 | 凭空生成新闻 |
| Normalizer | 时间、链接、频道和文本格式标准化 | 用 AI 结果覆盖原文 |
| Deduplicator | 基于 canonical URL、内容指纹与事件相关性去重 | 未经核验就合并冲突事实 |
| Scheduler | 定时、入队、并发限制、重试 | 直接执行 Agent 内部动作 |
| Codex Adapter | 管理子进程、JSON-RPC、Thread/Turn 和事件 | 暴露原生 RPC 给公共互联网 |
| Analyzer | 分类、重要性评分、摘要、观点与影响分析 | 把推测伪装成新闻事实 |
| Publisher | 校验、版本化、导出 Web / RSS / JSON | 无来源发布 |
| Admin API | 任务配置、权限、审阅、运行历史 | 向匿名用户提供管理操作 |

### 为什么不让 Codex 负责全部环节？

采集、调度、重试、存储和发布必须具备可测试的确定性。Codex 主要用于跨来源综合、事实冲突提示、摘要、中文分析以及需要工具调用的研究任务。

## 3. Codex App Server 生命周期

1. Backend 作为父进程启动本机 `codex app-server`（优先 stdio）。
2. 与进程进行初始化握手（`initialize`，随后 `initialized`）。
3. 为任务创建或恢复 Thread（`thread/start` / `thread/resume`）。
4. 使用 `turn/start` 提交任务，处理事件、工具审批和取消请求。
5. **仅在 `turn/completed` 且最终状态成功时**将分析任务标记为完成。
6. 保存 Thread / Turn 标识、必要日志及产物引用。
7. 进程退出或协议错误时标记任务失败并允许安全重试，不默默当作成功。

注意：App Server 的协议与可用功能可能随版本演化，应放在独立 Adapter 内隔离。Agent 的认证与使用限额依赖实际安装与账户配置，不能将 ChatGPT 套餐视为无限制公共 API。

## 4. 数据模型（提议）

- `sources`：来源 ID、类型、名称、URL、更新策略、启用状态
- `articles`：原始标题、URL、canonical URL、来源、发布时间、抓取时间、内容摘要/哈希
- `topics`：主题分类、合并后的事件、文章关联
- `jobs`：频道、计划时间、输入范围、状态、重试次数
- `job_runs`：实际开始/结束时间、线程 ID、状态、错误、摘要日志
- `reports`：标题、日期、频道、正文、发布状态、生成版本
- `report_items`：排序、事件摘要、引用文章、置信与核验状态
- `feeds`：频道 RSS 配置与最近构建状态

推荐时区：任务配置使用 IANA 时区（如 `Asia/Singapore`），内部存储 UTC 时间戳，渲染时按频道设置转换。报告日期与新闻事件发生日期分开记录。

## 5. 数据流与内容质量

```text
抓取 → 来源校验 → 时间标准化 → 去重 → 候选集合
  → Agent 分析 → 结构化 JSON 校验 → 内容审核/策略检查
  → 数据库存储 → RSS/网页静态导出 → 部署
```

必须保留可追溯的新闻 URL；至少区分事件发生时间、来源发布时间和系统抓取时间。对于观点、行情解释、网络评论，明确区分数据与推论；无法取得点赞数或评论来源时不得捏造。

建议定义机器校验的 JSON Schema，至少包含标题、频道、摘要、来源 URL、时间字段、事实/观点标记。发布层只消费校验通过的数据，不解析任意自由格式的 Agent 回复作为事实依据。

## 6. 定时与幂等

- 按任务 ID + 日期/时间窗口生成幂等键，避免定时重试重复发布。
- 为同一任务设置运行互斥和超时/取消策略。
- 失败重试带退避；区分网络问题、访问受限、配额耗尽、Agent 错误和内容质量不合格。
- v0.1 可用单实例调度；后续再评估持久化队列，不提前引入复杂基础设施。
- 公共内容采用先完整生成、再原子发布的方式，避免 RSS 与网页版本不一致。

## 7. RSS 与静态发布

规划路径（示意，不是已经上线的 URL）：

- `/rss/all.xml`
- `/rss/ai.xml`
- `/rss/investment.xml`
- `/rss/opensource.xml`
- `/rss/trending.xml`

RSS 2.0 必须正确转义 XML 字符，提供稳定的 item guid、链接和 pubDate。建议允许“整期日报”和“单条新闻”两种 Feed 模式。仅发布可访问的正式 URL，不将开发机 localhost 链接写入正式 Feed。

## 8. 安全与部署

- App Server 使用本地 stdio；若使用网络传输，只在受控网络、认证与访问隔离后开放。
- 管理 API 默认仅监听回环地址，远程访问需身份验证、TLS 和审计。
- Agent 的文件系统和命令执行权限采用最小化配置；未经授权不应自动批准危险操作。
- 不将密钥、OAuth 凭据、Cookie、原始私人日志或本地数据库推送到静态站点。
- Cloudflare Pages / GitHub Pages 只承载公开阅读内容；不运行本地 Codex Agent。
- 对第三方内容遵守来源网站的使用条款、频率限制与版权要求。

## 9. 尚待验证的风险

1. Windows 下 Codex App Server 的稳定启动、重连与审批事件处理。
2. 长时间无人值守时的登录状态、会话有效期和使用额度行为。
3. 动态网页和社交平台内容的合法可访问性。
4. 离线或未运行定时器时的漏执行补偿。
5. RSS 阅读器兼容性、中文摘要排版、静态托管更新一致性。

## 参考文档

- [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
- [Codex app-server with ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
