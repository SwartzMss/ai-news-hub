# Linux 部署与运行约束（v0.1）

> **Backend 基础与手动任务执行引擎已实现。** 新闻采集、日报和发布仍未实现。本文区分现有代码、待验收的部署步骤和后续目标，不是已实测的一键安装教程。

Issue #2 的独立验证工具已实现，可按第 8 节执行。它不启动新闻服务；目标主机验收结果仍需补齐，详见 [验证记录](validation/CODEX_LINUX_PROBE.md)。
Issue #3 的基础 Backend 按第 9 节安装；Schema 见 [数据模型](DATA_MODEL.md)。健康检查不验证 Codex 认证。
Issue #4 的管理 Token、Codex 运行环境与样例执行见第 10 节及 [任务引擎/API](TASK_ENGINE.md)。

## 目标平台与组件

- **唯一 v0.1 服务端目标**：Linux，首选 Ubuntu Server 24.04 LTS（x86_64）；不做 Windows / WSL 的部署和测试。
- Node.js LTS + TypeScript Backend、SQLite、Codex CLI / App Server。
- Linux systemd 管理 Backend 进程；手动任务经 Backend 启动并监管 `codex app-server --listen stdio://` 子进程，每个 Turn 一个子进程，不对外监听 Agent 端口。
- GitHub 按日期保存审核通过的日报 JSON / Markdown；Cloudflare Pages 自动构建公开网站及 RSS。
- 管理台通过 Linux Backend 提供的 API 访问；默认仅绑定 `127.0.0.1`，远程使用时优先 SSH 端口转发，暂不对公网开放管理 API。

## 1. 基础环境检查

安装 Linux 发行版提供的基础包并准备受支持的 Node.js LTS（Node.js 安装方法按发行版/团队标准选择）：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
node --version
npm --version
git --version
```

安装 Codex CLI（示例使用 npm；需根据 Node/npm 安装方式选择合适的权限与前缀）：

```bash
npm install -g @openai/codex
codex --version
codex app-server --help
codex login --help
```

Backend 使用 Node.js 22.19.0 或更新的 22.x，`npm run build` 后可 `npm start`。Codex 对健康检查不是必需依赖，但真实任务执行须先通过上述服务账户认证检查。

## 2. 运行身份与认证

- 规划独立的非 root 服务用户，例如 `ai-news-hub`。正式 Backend、Codex 子进程、SQLite 文件都属于该用户，不要让 root 直接运行 Agent。
- **必须以实际运行服务的同一个 Linux 用户完成 Codex 登录/授权**。不同用户的 HOME 和 Codex 配置目录不能假定共用。
- 有 GUI 时可按 CLI 提示登录；无图形界面时，先检查 `codex login --help` 是否提供设备码认证等选项，按官方提示完成登录，不在服务文件中硬编码授权码。
- 将凭据保存在服务用户权限受限的持久目录；不要把 Cookie、Token、`~/.codex`、日志或 SQLite 写入 Git 仓库。
- 不要假设交互式 ChatGPT 登录能长期无人值守。要检测授权失效、额度耗尽以及人工重新授权/适当刷新机制；访问令牌方案的适用套餐和权限以官方当前文档为准。
- Backend 应能在启动时检查 Codex 的可用性，认证不足时进入可诊断状态，而不是生成空白日报或假成功。

官方参考：[Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform) 和 [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)。

## 3. 部署目录

```text
/opt/ai-news-hub/                  # 应用程序与构建产物（版本化部署）
  dist/apps/server/src/main.js     # 现有 Backend 构建入口
  dist/packages/shared/            # 共享类型的构建目录
  node_modules/                    # 生产依赖（Fastify）
  package.json                     # ESM 声明，须随构建产物部署

/var/lib/ai-news-hub/              # 可写持久目录；服务用户持有
  news.db                          # 启动/迁移命令创建，0600
  news.db-wal / news.db-shm         # SQLite 运行文件，不入 Git
  .codex/                          # Codex 配置/认证持久目录，严格保护
  exports/                         # 后续生成的已审核日报/静态构建产物

/etc/ai-news-hub/                  # 受限运行配置，不入仓库
  ai-news-hub.env

journald                           # 服务启动、错误与运行日志
```

定时任务状态和运行记录必须持久化到 SQLite；程序重启不能把“上次计划时间”当作已执行。需要防重复发布、漏执行补偿和错误重试策略。

## 4. 进程和 systemd

任务执行时的目标进程树：

```text
systemd
  └── ai-news-hub.service (User=ai-news-hub)
       └── node: backend
            └── codex app-server --listen stdio://
```

现有 Backend unit 为 [`deploy/systemd/ai-news-hub.service`](../deploy/systemd/ai-news-hub.service)，入口是 `/opt/ai-news-hub/dist/apps/server/src/main.js`。使用非 root 用户、私有 StateDirectory、受限环境文件、失败重启、journald 和 `KillMode=control-group`。

验证后才能安装/启用 unit：必须确认 `node` 的绝对路径、实际构建产物、运行账号的 `codex` 可执行路径、必要的 PATH/HOME、服务用户对 SQLite 和 Codex 认证目录的读写权限，并验证 `journalctl -u ai-news-hub` 能定位故障。systemd 的重启仅保证进程可重启，不自动解决额度耗尽、登录失效或业务任务恢复。
健康检查不依赖 Codex 路径/认证；基础服务启动或 API 测试不得描述为 #2 认证验收完成。

## 5. Codex Adapter 必测场景

- spawn 后完成 `initialize` → `initialized` 握手，再发出 `thread/start` 和 `turn/start`。
- **Run → Thread → 多个 Turn**：同一 Run 可继续分析；不同日的 Run 默认独立 Thread。
- 正确接收执行消息、审批、`turn/completed`，仅最终 `completed` 状态可进入结果发布路径；`failed` 和 `interrupted` 都是非成功。
- 用户拒绝审批、Agent 子进程退出、网络中断、上游额度限制、授权失效等状态均应落库并可诊断。
- 不允许 App Server 直接操作发布密钥或未经授权执行危险命令；发布权由后端控制。

## 6. 公共发布与管理分离

```text
Linux Backend + SQLite + 管理 API（仅 localhost）
   → 真实新闻采集 / Codex 分析 / 校验 / 审核
   → reports/YYYY/MM/DD.json 或 .md
   → GitHub Commit
   → Cloudflare Pages 构建公开 HTML + RSS
```

- 历史日报在 GitHub 保留，新增日期不覆盖历史；修订应保留可追踪的变更记录。
- GitHub 即使是 Private 仓库，Cloudflare Pages 发布后的站点默认也可能公开；不得把私人配置或工作数据加入部署产物。
- SQLite 留在 Linux 主机；对其安排独立的备份与恢复验证，Git 历史日报不能替代数据库备份。
- 公开站点与后台完全隔离。**v0.1 不暴露 Agent RPC 或管理员写操作到公网。**

## 7. v0.1 Linux 交付验收

- 在 Linux 非 root 账户下完成真实 Agent 请求及结构化结果生成。
- 经 systemd 管理，重启后任务状态及历史仍在；出错可查日志。
- 管理后台能显示任务列表、手动运行、Run 状态、日志和结果预览。
- 采集真实来源 → Codex → SQLite → GitHub → 网站 / RSS 的链路可被验证。
- 没有实时连接或认证无效时，不会发布假数据或伪成功的报告。

## 8. Issue #2 独立探针验证步骤

以下步骤面向原生 Ubuntu Server 24.04 LTS，需由主机管理员执行。当前开发环境结果不能替代目标主机验收。

### 构建与服务账户

使用受支持的 Node.js 22，确保 `node` 在 `/usr/bin/node`（否则修改 unit 的绝对路径），并确认 `codex` 的实际路径与版本。
在仓库运行：

```bash
npm ci --ignore-scripts
npm run check
npm test
node --version
codex --version
codex app-server --help
codex login --help
```

以管理员身份准备独立用户与目录；若用户已存在则跳过 `useradd`：

```bash
sudo useradd --system --home-dir /var/lib/ai-news-hub --shell /usr/sbin/nologin ai-news-hub
sudo install -d -o ai-news-hub -g ai-news-hub -m 0700 /var/lib/ai-news-hub
sudo install -d -o ai-news-hub -g ai-news-hub -m 0700 /var/lib/ai-news-hub/.codex /var/lib/ai-news-hub/probe-work
sudo install -d -o root -g root -m 0755 /opt/ai-news-hub/dist/tools/codex-probe
sudo install -o root -g root -m 0644 dist/tools/codex-probe/*.js /opt/ai-news-hub/dist/tools/codex-probe/
sudo install -o root -g root -m 0644 package.json /opt/ai-news-hub/package.json
sudo install -d -o root -g root -m 0700 /etc/ai-news-hub
sudo install -o root -g root -m 0600 deploy/systemd/.env.example /etc/ai-news-hub/codex-probe.env
```

独立探针运行时没有第三方依赖，但 `package.json` 的 `type=module` 必须随构建产物部署；第 9 节的 Backend 则需要 Fastify 生产依赖。
编辑 `/etc/ai-news-hub/codex-probe.env`，将 `CODEX_BIN` 改为全局安装的实际绝对路径；服务用户须可执行该路径及其父目录。
不要使用个人用户目录里的 nvm 路径作为正式部署依赖。
如果主机需要代理，在这个受限文件中显式设置 `http_proxy` / `https_proxy` / `no_proxy`；systemd 不会自动继承交互 shell 的网络环境。不要把代理凭据写入仓库或 journal。

### 认证与单次运行

用服务用户完成认证（按实际 CLI 及账户策略选择认证方式，设备码流程需要人工在浏览器授权）：

```bash
sudo -u ai-news-hub env HOME=/var/lib/ai-news-hub CODEX_HOME=/var/lib/ai-news-hub/.codex /usr/local/bin/codex login --device-auth
sudo -u ai-news-hub env HOME=/var/lib/ai-news-hub CODEX_HOME=/var/lib/ai-news-hub/.codex /usr/local/bin/codex login status
sudo stat -c '%a %U %n' /var/lib/ai-news-hub/.codex /var/lib/ai-news-hub/.codex/auth.json
```

上面的 Codex 路径同样要按实际安装修改。文件式凭据要求目录 0700、凭据文件 0600，归服务用户所有；若使用其他凭据存储，应验证其在无桌面会话下也可用。
`login status` 只证明本地登录状态，成功 Turn 才证明该次模型调用可用。
探针不会替用户续期或改变认证模式；访问失败后先恢复服务用户认证，再手动重试。

```bash
sudo install -o root -g root -m 0644 deploy/systemd/ai-news-hub-codex-probe.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/ai-news-hub-codex-probe.service
sudo systemctl daemon-reload
sudo systemctl start ai-news-hub-codex-probe.service
sudo journalctl -u ai-news-hub-codex-probe.service --since '10 minutes ago' --no-pager
sudo systemctl show ai-news-hub-codex-probe.service -p Result -p ExecMainStatus
```

通过条件：日志依次包含 `initialized`、`account_available`、`thread_started`、`turn_started`、`completed`、`child_closed`，且 `ExecMainStatus=0`、`Result=success`。这是一次性探针，成功后进入 inactive 是正常现象。
再启动一次，比较不同的 Run / Thread 标识；同一 Run 内的 Thread / Turn 应一致。
unit 刻意没有 `[Install]` 且 `Restart=no`，不执行 `enable`，避免开机或故障时自动重复消耗额度。正式 Backend 的自动恢复须另行实现。

### 失败与生命周期验收

| 日志 code | 含义与处理 |
| --- | --- |
| `auth_required` | 无有效账户或终态报告认证/权限错误；以服务用户恢复认证 |
| `quota_exceeded` / `rate_limited` | 额度不足或限流；等待恢复/调整计划，不紧密重试 |
| `needs_approval` | 收到服务器主动请求，探针拒绝并退出；正式 Backend 需提供任务内审批 |
| `rpc_error` | RPC 失败；查看 `rpc_failed.method`、数字 `rpcCode` 与脱敏 `hints`，检查认证/网络/版本 |
| `timeout` / `process_exit` / `spawn_failed` | 总超时、子进程退出或可执行文件问题；核对环境、路径、运行身份 |
| `agent_failed` / `interrupted` / `invalid_output` | Agent 未成功完成或回复不符；不可进入发布路径 |
| `protocol_error` | 格式或大小异常、标识无效；核对已记录 CLI 版本及生成的 Schema |
| `cancelled` | 服务停止或进程收到 SIGTERM/SIGINT；该次 Run 未成功 |
| `cleanup_failed` | 进程组清理超过 2.5 秒上限；探针失败退出，由 systemd 控制组兜底并检查残留进程 |

无网络测试用 `npm test` 验证错误分支；模拟认证/额度失败不能描述为真实令牌过期或配额耗尽。
`tests/fixtures/systemd-probe.mjs` 是仅供故障注入的包装器，不得代替真实探针部署；在目标机的源码目录可用以下临时用户 unit 验证重启：

```bash
probe_node=$(command -v node)
probe_repo=$(pwd)
probe_tmp=$(mktemp -d /tmp/ai-news-hub-probe.XXXXXXXX)
probe_marker="$probe_tmp/restarted"
systemd-run --user --unit=ai-news-hub-probe-restart --wait --collect \
  --property=Restart=on-failure --property=RestartSec=1 \
  --property=StartLimitIntervalSec=60 --property=StartLimitBurst=3 \
  --property=KillMode=control-group --working-directory="$probe_repo" \
  "$probe_node" "$probe_repo/tests/fixtures/systemd-probe.mjs" restart "$probe_marker"
journalctl --user -u ai-news-hub-probe-restart.service -n 40 --no-pager
```

用户 systemd 管理器须可用；此测试不要求正式服务使用用户 unit。预期首次 `process_exit`、重启计数 1、第二次模拟成功且 Run / Thread 不同。它不证明真实模型会在服务重启后恢复。
另起同样的临时 unit，把最后的 `restart "$probe_marker"` 改成 `timeout`，unit 名改为 `ai-news-hub-probe-stop`，去掉 `--wait` 和自动重启属性，然后 `systemctl --user stop ai-news-hub-probe-stop.service`；journal 应有 `cancelled` 与 `child_closed`，停止后控制组内无残留进程。
真实认证过期、真实服务重启后再次成功 Turn、长期无人值守观察仍须在目标服务器记录，不能用模拟测试替代。

协议与认证参考：[App Server 官方文档](https://developers.openai.com/codex/app-server)、[CLI 认证官方文档](https://developers.openai.com/codex/auth)。使用已安装 CLI 的 `generate-json-schema` 核对字段；不要提交个人配置或原始日志。

## 9. Issue #3 Backend 基础服务部署

以下命令面向原生 Ubuntu Server 24.04 LTS，假设系统级 Node.js 22 与 npm 位于 `/usr/bin`。实际路径不同时先修改 unit 与命令；不要把个人用户的 nvm 安装作为正式服务依赖。目标主机的安装和 systemd 生命周期必须实测后才能验收。

### 构建并准备文件

在源码目录用普通账户运行：

```bash
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
npm run build
```

管理员创建独立账户（已存在则跳过 useradd）、私有数据目录并安装产物：

```bash
sudo useradd --system --home-dir /var/lib/ai-news-hub --shell /usr/sbin/nologin ai-news-hub
sudo install -d -o ai-news-hub -g ai-news-hub -m 0700 /var/lib/ai-news-hub
sudo install -d -o root -g root -m 0755 /opt/ai-news-hub
sudo cp -R dist package.json package-lock.json /opt/ai-news-hub/
sudo /usr/bin/npm ci --omit=dev --ignore-scripts --prefix /opt/ai-news-hub
sudo install -d -o root -g root -m 0700 /etc/ai-news-hub
sudo install -o root -g root -m 0600 .env.example /etc/ai-news-hub/ai-news-hub.env
```

`/opt/ai-news-hub` 的代码/生产依赖应由 root 持有且服务用户只有读/执行权限，SQLite 留在 `/var/lib/ai-news-hub`。不要在运行中直接覆盖产物；更新前先停服务，备份数据库再部署。
环境文件默认配置：

| 变量 | 默认值 / 约束 |
| --- | --- |
| `AI_NEWS_HUB_HOST` | `127.0.0.1`，也允许 `::1`；拒绝公网/通配监听 |
| `AI_NEWS_HUB_PORT` | `3000`，整数 1–65535 |
| `AI_NEWS_HUB_DATA_DIR` | `/var/lib/ai-news-hub`，绝对路径、服务用户所有、0700 |
| `AI_NEWS_HUB_LOG_LEVEL` | `info`；允许 fatal/error/warn/info/debug/trace/silent |

systemd 读取 `/etc/ai-news-hub/ai-news-hub.env`，不会加载开发目录 `.env`，也不自动继承交互 shell 的 PATH 或代理。未启动任务时 Backend 不请求模型；管理 API 默认关闭，第 10 节说明如何按需启用。
目录或已有数据库权限不安全时启动失败，先检查所有权及 0700/0600 权限；不要把个人 HOME 改为服务账户的数据目录，也不要通过删库解决错误。

### 迁移、启动和健康检查

可先显式执行迁移；启动也会重复核对并迁移，重复执行不会清除数据：

```bash
sudo -u ai-news-hub env HOME=/var/lib/ai-news-hub AI_NEWS_HUB_DATA_DIR=/var/lib/ai-news-hub /usr/bin/node /opt/ai-news-hub/dist/apps/server/src/migrate.js
sudo install -o root -g root -m 0644 deploy/systemd/ai-news-hub.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/ai-news-hub.service
sudo systemctl daemon-reload
sudo systemctl start ai-news-hub.service
sudo systemctl status ai-news-hub.service --no-pager
curl --fail --silent --show-error http://127.0.0.1:3000/health
sudo journalctl -u ai-news-hub.service --since '10 minutes ago' --no-pager
```

端口或监听地址修改后，健康检查 URL 同步调整。也可用 `AI_NEWS_HUB_PORT=3000 node /opt/ai-news-hub/dist/scripts/health.js`，它有 3 秒超时且拒绝重定向，失败非零退出。
预期：HTTP 200、`{"status":"ok","database":"ok"}`；日志有 `server_ready`，SQLite 迁移表和业务表存在，数据库 0600。Node 22 的 SQLite 实验性提示是已知 API 状态，不屏蔽它来冒充稳定接口。

启动/停止/重启可直接 `sudo systemctl start|stop|restart ai-news-hub.service`（选择一个动作），或在源码目录用 `sudo bash scripts/service.sh start` / `stop` / `restart` / `status`。前台开发使用 `npm start`，Ctrl+C 会关闭 HTTP 和数据库。
验证完成后才启用开机启动：`sudo systemctl enable ai-news-hub.service`。

### 目标主机验收与当前限制

- 记录发行版、Node、SQLite、systemd 版本、服务 UID、实际可执行路径；确认只监听回环地址，root 启动会被拒绝。
- 迁移空库后再运行迁移，原数据不变；源码测试覆盖外键、幂等约束、历史 checksum 和失败回滚。
- 正常停止日志有 `server_stopped`，HTTP 关闭；再次启动原记录保留。异常杀死服务主进程后检查 systemd `NRestarts` 与健康检查恢复，记录脱敏日志，不将运行数据提交到 Git。
- 当前测试验证普通 Node 进程的停止/重启，CI 使用 Ubuntu 24.04；它们不等于完成 systemd 安装、开机启动或重启主机实测。
- CI 静态检查在临时 unit 副本中将 `/usr/bin/node` 替换成 runner 的实际 Node 路径；目标主机仍须独立确认安装路径并校验正式 unit。
- `/health` 只说明基础服务与 Schema 可读，不验证 Codex 登录/额度。现有管理 API 可手动执行样例，暂无调度、新闻或发布；重启只中断旧 Run，不自动恢复执行。#2 认证/systemd 问题继续独立跟踪。

## 10. Issue #4 管理 API 与真实任务

先完成第 9 节的安装，再以同一个非 root 服务账户按第 8 节登录 Codex。认证目录 0700、文件式凭据 0600，位于 `CODEX_HOME=/var/lib/ai-news-hub/.codex`，不复制个人账号目录，不以 root 执行模型。
编辑 root 持有的 0600 环境文件 `/etc/ai-news-hub/ai-news-hub.env`：

```ini
AI_NEWS_HUB_CODEX_BIN=/usr/local/bin/codex
AI_NEWS_HUB_RUN_TIMEOUT_MS=120000
AI_NEWS_HUB_CONCURRENCY=1
AI_NEWS_HUB_MAX_QUEUE=20
```

另外添加本机生成的 `AI_NEWS_HUB_ADMIN_TOKEN`（例如 `openssl rand -hex 32` 的结果），不要把实际 Token 提交到仓库、Issue 或 shell 历史。可选 `AI_NEWS_HUB_MODEL` 选择实际有权使用的模型；路径按实际安装修改，确保 CLI 及父目录可由服务账户执行。
若主机需代理，在同一受限文件显式配置相应代理变量。Codex 子进程只接收允许的运行、代理/CA 与模型认证环境，不继承 Backend 管理 Token 或发布凭据；额外自定义 provider 环境变量需单独评估。

```bash
sudo systemctl restart ai-news-hub.service
sudo journalctl -u ai-news-hub.service --since '5 minutes ago' --no-pager
```

服务启动仅创建默认样例记录，不会自动调用 Codex。按 [API 说明](TASK_ENGINE.md#手动触发样例) 用 Bearer Token 触发 `sample-connectivity`，保存返回的 Run ID，通过详情与事件接口确认最终状态、Thread / Turn 标识和固定回复。真实请求会使用账户额度。
继续该 Run 时使用新的 Turn 幂等键；新 Run 使用新的启动幂等键，应有不同 Thread。不要把幂等重试返回旧 Run 误认为又执行了一次。

启动会应用迁移 2，不修改迁移 1 或删除旧库。每个数据目录只允许一个 Backend，Linux `/proc` 的 PID、进程启动时间与 boot ID 用于识别活跃/失效所有者；不要让多个主机共用该 SQLite。
工作目录为 `/var/lib/ai-news-hub/work`，由服务用户持有且 0700。原始 RPC/stderr/工具参数不入 journal 或事件表；受限 Agent 正文属于私有运行记录，不可直接导出为公开内容。

### 生命周期验收

- 确认无 Token 时管理端点不可用、错误 Token 返回 401；只有回环地址监听。
- 同一 Task 活跃时新键返回 task_busy；相同键返回旧 Run；不同 Task 按并发与队列上限执行。
- 测试取消与超时，确认 finished/error_code、历史 Turn 和事件一致；审批请求拒绝并以 needs_approval 失败，不驻留等待人工输入。
- 正常停服务后旧未完成记录为 interrupted / backend_stopped。异常杀死主进程后，确认 systemd 已清理整个控制组，再观察自动重启；旧未完成记录应为 interrupted / backend_restarted，不自动重跑。
- 无法确认子进程已清理时，Run 记录 cleanup_failed；引擎冻结调度并触发 Backend 非零关闭，由 systemd 控制组兜底。不得在旧子进程仍运行时手动删除所有权记录或并行重启执行同一 Thread。
- 服务重新启动后仍可查询历史；仅成功 Turn 不是新闻校验或发布许可。长期登录有效性、真实额度/过期故障和原生 Ubuntu Server 24.04 生命周期仍须记录实测结果，见 [验证记录](validation/TASK_ENGINE.md)。
