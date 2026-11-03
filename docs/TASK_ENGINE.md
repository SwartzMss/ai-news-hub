# Task → Run → Thread → Turn 引擎与 API

Issue #4 已实现手动任务执行、持久化历史、取消和继续 Turn。预定义任务有 `sample-connectivity` 及 Issue #5 的 `news-github`；没有定时调度、任务编辑、日报发布或聊天 UI。新闻任务的来源/报告查询见 [新闻流水线](NEWS_PIPELINE.md)。
样例提示词要求固定回复 `AI_NEWS_HUB_TASK_OK` 且不使用工具。创建样例记录不会调用模型；手动启动和继续 Turn 才使用真实账户额度。

## 配置与认证

Backend 只允许监听 `127.0.0.1` / `::1`。`/health` 公开，仅检查本地服务/数据库；所有已有 `/api` 管理端点要求 `Authorization: Bearer <token>`。
在私有 `.env` 或 `/etc/ai-news-hub/ai-news-hub.env` 配置以下变量后重启服务：

| 配置 | 默认 / 约束 |
| --- | --- |
| `AI_NEWS_HUB_ADMIN_TOKEN` | 空/未设置时管理 API 返回 503；32–256 个字母、数字、下划线或连字符，可用 `openssl rand -hex 32` 在本机生成 |
| `AI_NEWS_HUB_CODEX_BIN` | `codex`，正式服务建议指定服务账户可执行的绝对路径 |
| `AI_NEWS_HUB_MODEL` | 未设置时沿用 Codex 配置，模型访问权须通过真实 Turn 验证 |
| `AI_NEWS_HUB_RUN_TIMEOUT_MS` | 120000；允许 1000–3600000，作用于正在执行的单个 Turn（含新闻采集准备阶段），不含排队时间 |
| `AI_NEWS_HUB_CONCURRENCY` | 1；允许 1–4，同时执行的 Turn 上限 |
| `AI_NEWS_HUB_MAX_QUEUE` | 20；允许 1–100，运行槽之外的等待数量上限 |

同一 Linux 服务账户完成 Codex 登录，HOME / CODEX_HOME 与 systemd 配置一致。工作目录是数据目录下的 `work/`，须为服务用户所有、0700。数据库保持在本机持久目录，不能提交到 Git。
Token 不接受查询参数或 Cookie；未认证返回 401，响应不缓存，不启用跨域访问。请勿将真实 Token、OAuth 凭据或 Agent 原始日志写入文档、Issue 或公开产物。

## 接口

成功响应中的 Run / Turn 使用数据库字段名；管理请求体使用下表的字段名。创建成功 202，复用已有幂等记录 200。

| 方法 / 路径 | 请求与结果 |
| --- | --- |
| `GET /api/tasks` | 返回 `tasks`，含预定义样例任务 |
| `GET /api/tasks/:taskId` | 返回 `task`，可查询 Task 的启用状态与提示词 |
| `POST /api/tasks/:taskId/runs` | `{"idempotencyKey":"manual-001"}`，返回 `{run,reused}` |
| `GET /api/tasks/:taskId/runs` | `limit` 默认 20（1–100），`offset` 默认 0（0–100000），返回 `runs` |
| `GET /api/runs/:runId` | 返回 `{run,turns}`；Turn 包含输入、服务器标识、状态、错误及最终输出 |
| `GET /api/runs/:runId/events` | `after` 为上次事件 ID，默认 0；`limit` 默认 100（1–100），返回 `events` |
| `POST /api/runs/:runId/cancel` | 返回 `{run}`；排队任务立即取消，执行中的任务发出中断并等待子进程清理 |
| `POST /api/runs/:runId/turns` | `{"idempotencyKey":"followup-001","input":"继续分析…"}`，返回 `{run,turn,reused}` |

幂等键为 1–128 个字母、数字或 `._:-`。初始请求的幂等键在 Task 内唯一；继续请求在 Run 内唯一，键相同但输入不同返回 409 `idempotency_conflict`。手动继续输入须非空且最多 8000 个字符。新闻任务由受限工作流生成最多 48 KiB 的候选输入，禁止继续 Turn（409 `workflow_continuation_disabled`），重新分析须显式新建 Run。
相同 Task 有 queued/running/waiting_approval Run 时，新的执行或继续请求返回 409 `task_busy`；相同幂等键的重试只读取原记录。队列满返回 429 `queue_full`，不会创建多余 Run。

错误体为 `{"error":{"code":"…","message":"…","requestId":"…"}}`。不存在的 Task / Run 返回 404；缺少 Thread 时继续请求返回 409 `thread_unavailable`，须用新的启动幂等键显式新建 Run。
取消已结束 Run 不改变其终态；若需要新一轮工作，应继续 Turn 或显式新建 Run。没有自动重试、自动续期或发布副作用。

### 手动触发样例

先启动已配置管理 Token 的 Backend，再在本机输入同一个 Token。以下方式不会把 Token 放进 curl 命令参数；响应给出 Run ID，可据此查询状态和事件。

```bash
read -rsp 'Admin token: ' task_admin_token
printf '\n'
printf 'header = "Authorization: Bearer %s"\n' "$task_admin_token" |
  curl --config - --fail-with-body --silent --show-error \
    -H 'Content-Type: application/json' \
    -d '{"idempotencyKey":"manual-001"}' \
    http://127.0.0.1:3000/api/tasks/sample-connectivity/runs
unset task_admin_token
```

重复同一幂等键只返回原 Run，不再次调用模型。后续新 Run 需使用新键。操作需要人工授权的账户登录，不以 `sudo codex` 或个人凭据复制替代服务账户认证。

## 生命周期与结果边界

- 新 Run 创建独立 Thread；同一 Run 继续时，以保存的 Thread ID 调用 `thread/resume`。每个 Turn 使用新的 stdio App Server 进程，仍属于该 Run。
- queued → running → succeeded / failed / cancelled / interrupted。审批请求可短暂产生 waiting_approval，随后拒绝请求并以 `needs_approval` 失败；没有待人工审批的驻留子进程或批准接口。
- 仅接受匹配 Thread / Turn 的成功终态、非空输出，并确认进程清理后才标 succeeded。初始化成功、工具单项完成、进程退出或空响应均不能代替 Turn 成功。
- Run 状态表示最近一个 Turn。继续请求把 Run 重新置 queued，保留旧 Turn 的终态和输出；一个 Run 最多 20 个 Turn。
- 超时标 failed / `timeout`；人工取消标 cancelled；服务停止和重启恢复标 interrupted。取消之后的迟到成功不会覆盖终态。
- 进程清理超时为 `cleanup_failed`，优先于取消/任务超时；停止调度并令正式 Backend 非零退出，systemd 清理控制组。检查日志和进程状态后再恢复，不自动开始排队工作。

Adapter 对协议帧限制为 1 MiB，最终输出最多 64 KiB；每个 Turn 最多保存 200 个 Adapter 事件、累计 128 KiB 事件 JSON，另有引擎状态事件。超过限制失败退出。事件按全局自增 ID 分页，查询不会无限返回全部历史。

## 重启、权限和存储

同一数据目录只允许一个 Backend，使用 SQLite 事务保存 PID、进程启动时间和 boot ID；活跃所有者存在则拒绝第二个进程，避免误恢复运行中的 Run。异常退出后新进程可以接管失效记录。此约束用于单台 Linux 主机，不能把数据库放在共享网络盘供多机执行。
启动后把旧 queued/running/waiting_approval Run / Turn 标 interrupted，错误 `backend_restarted` 并追加恢复事件；不自动重放。历史标识和输出保留，已成功 Turn 不会被改写。

Codex 的子进程环境只保留运行环境、locale、代理/CA 和明确的模型认证变量；不继承 Backend 管理 Token、GitHub 或 Cloudflare 凭据。HOME / CODEX_HOME、模型认证文件仍属于 Codex 的运行身份，必须按 #2 保护。
Thread 采用 read-only sandbox 与 untrusted 审批策略，所有服务器请求拒绝；发布凭据不得放在 Agent 工作目录或配置中。自定义模型 provider 若依赖允许列表之外的变量，需单独评估，不能为排障直接继承整个 Backend 环境。

输入、输出和事件保存在私有 SQLite，可能含任务私有正文，只有认证管理 API 可以查询。journald 不输出请求头/正文/查询参数、原始 RPC、stderr、工具参数或任意服务端错误文本；数据库事件保留安全元数据和有大小限制的 Agent 正文，不能视为可公开日志。

Schema 与迁移规则见 [数据模型](DATA_MODEL.md)。真实开发验证和仍需目标服务器验收的部分见 [验证记录](validation/TASK_ENGINE.md)。协议参考：[Codex App Server 官方文档](https://developers.openai.com/codex/app-server)。
