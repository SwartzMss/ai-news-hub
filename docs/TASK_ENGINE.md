# Task → Run → Thread → Turn 引擎与 API

Issue #4 已实现手动任务执行、持久化历史、取消和继续 Turn。预定义任务有 `sample-connectivity` 及 `news-research`（旧 `news-github` 已停用）；引擎现支持用户任务编辑、定时调度和顺序 Prompt（见 [任务管理](TASK_MANAGEMENT.md)）；历史预定义任务保留旧接口；日报人工批准/GitHub 归档由独立发布模块提供，管理界面见 ADMIN.md。新闻任务的来源/报告查询见 [新闻流水线](NEWS_PIPELINE.md)。
样例提示词要求固定回复 `AI_NEWS_HUB_TASK_OK` 且不使用工具。创建样例记录不会调用模型；手动启动和继续 Turn 才使用真实账户额度。

## 配置与认证

Backend 只允许监听 `127.0.0.1` / `::1`。`/health` 公开，仅检查本地服务/数据库；所有已有 `/api` 管理端点要求 `Authorization: Bearer <token>`。
启动环境文件只保留 HOST、PORT、DATA_DIR。首次在本机页面设置并确认密码（初始化请求校验由页面自动完成），之后登录获取临时 Bearer 会话；登录前业务接口返回 503 management_disabled。旧 Token 仅用于升级兼容，改设密码后失效。详见 [系统设置与认证](SETTINGS.md)。

Codex 路径/模型、每轮超时、并发、队列和日志级别经后台“系统设置”写 SQLite，空闲时立即生效，执行/排队/归档中返回 settings_busy。每轮默认 120000 ms（1000–3600000，含最终来源验证），并发 1（1–4），队列 20（1–100），模型默认沿用 Codex 配置。

同一 Linux 服务账户完成 Codex 登录，HOME / CODEX_HOME 与 systemd 配置一致。工作目录是数据目录下的 `work/`，须为服务用户所有、0700。数据库保持在本机持久目录，不能提交到 Git。
Token 不接受查询参数或 Cookie；未认证返回 401，响应不缓存，不启用跨域访问。请勿将真实 Token、OAuth 凭据或 Agent 原始日志写入文档、Issue 或公开产物。

## 接口

成功响应中的 Run / Turn 使用数据库字段名；管理请求体使用下表的字段名。创建成功 202，复用已有幂等记录 200。

| 方法 / 路径 | 请求与结果 |
| --- | --- |
| `GET /api/tasks` | 返回 `tasks`，含预定义样例任务 |
| `GET /api/tasks/:taskId` | 返回 `task`，可查询 Task 的启用状态与提示词 |
| `POST /api/tasks/:taskId/runs` | 样例 `{"idempotencyKey":"manual-001"}`；新闻还需 topic/input，返回 `{run,reused}` |
| `GET /api/tasks/:taskId/runs` | `limit` 默认 20（1–100），`offset` 默认 0（0–100000），返回 `runs` |
| `GET /api/runs/:runId` | 返回 `{run,turns}`；Turn 包含输入、服务器标识、状态、错误及最终输出 |
| `GET /api/runs/:runId/events` | `after` 为上次事件 ID，默认 0；`limit` 默认 100（1–100），返回 `events` |
| `POST /api/runs/:runId/cancel` | 返回 `{run}`；排队任务立即取消，执行中的任务发出中断并等待子进程清理 |
| `POST /api/runs/:runId/turns` | `{"idempotencyKey":"followup-001","input":"继续分析…"}`，新闻可带 `finalize:true` 生成日报；返回 `{run,turn,reused}` |

幂等键为 1–128 个字母、数字或 `._:-`。初始请求的幂等键在 Task 内唯一；继续请求在 Run 内唯一，键相同但输入不同返回 409 `idempotency_conflict`。手动继续输入须非空且最多 8000 个字符。新闻初始 topic 非空且最多 200 字符，input 非空且最多 8000 字符；同 Thread 可继续研究，finalize=true 显式生成。幂等比较包括 topic/input 或 input/finalize。生成成功后固定，继续返回 409 workflow_run_finalized；失败可修正重试，旧 RSS 任务继续仍返回 workflow_continuation_disabled。
相同 Task 有 queued/running/waiting_approval Run 时，新的执行或继续请求返回 409 `task_busy`；相同幂等键的重试只读取原记录。队列满返回 429 `queue_full`，不会创建多余 Run。

错误体为 `{"error":{"code":"…","message":"…","requestId":"…"}}`。不存在的 Task / Run 返回 404；缺少 Thread 时继续请求返回 409 `thread_unavailable`，须用新的启动幂等键显式新建 Run。
取消已结束 Run 不改变其终态；若需要新一轮工作，应继续 Turn 或显式新建 Run。没有自动重试、自动续期或发布副作用。

### 手动触发样例

先初始化管理员，通过 POST /api/auth/login 获取临时会话 Token，再在本机输入该 Token。以下方式不会把 Token 放进 curl 命令参数；响应给出 Run ID，可据此查询状态和事件。

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

`DELETE /api/runs/:runId` 要求管理员认证及 `{ "confirm": true }`。仅允许删除已结束的执行，排队、运行和发布/进程收尾阶段返回 409 `run_busy`。有关联日报时先复用日报删除流程同步清理 GitHub，成功后事务删除 Run、轮次、Thread 关联、事件和研究快照；任务和共享来源原文保留。远端失败保留记录供显式重试，已不存在的 Run 返回 `{deleted:true}`，并发重复删除共享结果。删除期间继续同一 Run 返回 409 `run_deleting`，配置保存按忙碌状态处理。

## 生命周期与结果边界

- 新 Run 创建独立 Thread；同一 Run 继续时，以保存的 Thread ID 调用 `thread/resume`。每个 Turn 使用新的 stdio App Server 进程，仍属于该 Run。
- queued → running → succeeded / failed / cancelled / interrupted。审批请求可短暂产生 waiting_approval，随后拒绝请求并以 `needs_approval` 失败；没有驻留的 Agent 工具审批或批准接口；日报人工审核是独立业务操作。
- 仅接受匹配 Thread / Turn 的成功终态、非空输出，并确认进程清理后才标 succeeded。初始化成功、工具单项完成、进程退出或空响应均不能代替 Turn 成功。
- 明确的 commentary/partial_answer 仅记为过程日志，优先取 final_answer 作为结果；未标记/未知 phase 保留兼容，只有过程消息时按 invalid_output 失败。
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

## 用户配置任务接口

`POST /api/tasks` 新增；`PUT /api/tasks/:taskId` 全量更新；`DELETE /api/tasks/:taskId` 软删除并保留历史；`POST /api/tasks/:taskId/stop` 停止当前执行。新增/更新请求为 `{name,topic,prompts,autoPublish,schedule,timezone,status}`；`status` 为 active/paused。运行中拒绝修改或删除。

计划格式：`{kind:"manual"}`、`{kind:"once",at:"UTC ISO 时间"}`、`{kind:"interval",minutes:60}`、`{kind:"daily",time:"09:00"}`、`{kind:"weekly",time:"09:00",weekday:1}`。周日为 0，默认时区 Asia/Shanghai。每个 Prompt 最多 8000 字符，1–20 轮，最后一条直接生成日报，不追加额外 Prompt。启动仍使用 `/tasks/:taskId/runs` 幂等键；配置任务不接受交互式继续 Turn，执行使用不可变配置快照。

用户配置任务的 paused 状态暂停定时调度，但仍允许手动启动；历史预定义任务的暂停行为不变。管理界面以单个任务主题同时填写 name/topic，旧 API 字段保持兼容。

## 跨任务运行与结果

`GET /api/runs?taskId=<可选>&state=all&limit=20&offset=0` 需要认证，返回 `{runs,total,limit,offset}`。state 支持 all/running/pending_review/publish_failed/failed/published。每条记录包含 run、所属任务名称/删除标记、最新阶段、日报与最新 GitHub 发布状态；删除任务不删除历史。生成日报前的研究成功不等于来源校验成功，失败阶段和发布错误分别呈现。

历史 `source_validation_failed` / `source_repair_queued` 事件仅供查询；新任务不执行后端抓取或自动来源修复。

当前日报来源模式为 `codex_reported`：Backend 不再联网核验原文或匹配引文，不再追加来源修复；保留 JSON/HTTPS 链接格式、数据关联和发布哈希检查。后端未抓取时 `fetchedAt/fetched_at` 为 null，不伪造原文发布时间或事件时间。历史 `source_only` 报告仍可读取和归档。

当前用户配置任务严格执行 N 条 Prompt = N 次 Codex Turn。最后一条原始 Prompt 直接返回日报结构，Backend 只在开发者格式指令中提供主题/时间/Schema，不改写持久化的用户 Prompt，也不再追加“依据前面所有轮次的研究结果，生成完整日报。”。旧执行记录的额外系统轮仅作为历史保留。

## 系统概览统计

`GET /api/overview` 使用相同 Bearer 管理认证及 `Cache-Control: no-store`，无请求参数。返回 `timezone`（固定 `Asia/Shanghai`）、`generatedAt`、`tasks`（`total/manual/scheduled/paused`）、`todayRuns/running/queued`、`pendingReview/pendingPublish/publishFailed/recentFailures`、连续七个日期的 `daily`（`date/total/succeeded/failed/stopped/active`），以及 `recentRuns`（最新 5 条，结构同 `/api/runs`）。统计不受运行列表分页限制；当前任务排除删除与内置项，运行统计按 `configuration_json` 快照限定用户配置任务，保留其删除历史。日报及归档状态沿用最新版本/最新 GitHub 尝试，不将多轮、多版本或多次发布重复计数。
