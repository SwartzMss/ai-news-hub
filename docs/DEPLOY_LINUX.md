# Linux 部署与运行约束（v0.1）

> **Backend、Codex 主题/多轮研究、待审核日报和人工批准归档已实现。** 持久计划调度已实现；原生服务账户/systemd 与 Cloudflare 实际上线仍待验收。本文区分现有代码与待验收步骤。

Issue #2 的独立验证工具已实现，可按第 8 节执行。它不启动新闻服务；目标主机验收结果仍需补齐，详见 [验证记录](validation/CODEX_LINUX_PROBE.md)。
Issue #3 的基础 Backend 按第 9 节安装；Schema 见 [数据模型](DATA_MODEL.md)。健康检查不验证 Codex 认证。
管理员初始化、Codex 运行环境与样例执行见第 10 节及 [任务引擎/API](TASK_ENGINE.md)。

## 目标平台与组件

- **唯一 v0.1 服务端目标**：Linux，首选 Ubuntu Server 24.04 LTS（x86_64）；不做 Windows / WSL 的部署和测试。
- Node.js LTS + TypeScript Backend、SQLite、Codex CLI / App Server。
- Linux systemd 管理 Backend 进程；手动任务经 Backend 启动并监管 `codex app-server --listen stdio://` 子进程，每个 Turn 一个子进程，不对外监听 Agent 端口。
- GitHub 按日期保存审核通过的日报 JSON（Markdown 留私有 SQLite）；Cloudflare Pages 自动构建公开网站及 RSS。
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

定时任务状态和运行记录必须持久化到 SQLite；程序重启不能把“上次计划时间”当作已执行。通过幂等键防重复；重启不补跑错过计划，错误由用户重试。

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
   → 主题/多轮 prompt / Codex 搜索与分析 / 结构检查 / 审核
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
- 主题/多轮 prompt → Codex 搜索 → 结构检查 → SQLite → GitHub → 网站 / RSS 的链路可被验证。
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
sudo install -d -o root -g root -m 0755 /opt/ai-news-hub/dist/tools/codex-probe /opt/ai-news-hub/dist/packages/shared/src
sudo install -o root -g root -m 0644 dist/tools/codex-probe/*.js /opt/ai-news-hub/dist/tools/codex-probe/
sudo install -o root -g root -m 0644 dist/packages/shared/src/agent-environment.js /opt/ai-news-hub/dist/packages/shared/src/
sudo install -o root -g root -m 0644 package.json /opt/ai-news-hub/package.json
sudo install -d -o root -g root -m 0700 /etc/ai-news-hub
sudo install -o root -g root -m 0600 deploy/systemd/.env.example /etc/ai-news-hub/codex-probe.env
```

独立探针运行时没有第三方依赖，但需要部署上述内部共享环境白名单模块，且 `package.json` 的 `type=module` 必须随构建产物部署；第 9 节的 Backend 则需要根 package.json 声明的生产依赖。
编辑 `/etc/ai-news-hub/codex-probe.env`，将 `CODEX_BIN` 改为全局安装的实际绝对路径；服务用户须可执行该路径及其父目录。
不要使用个人用户目录里的 nvm 路径作为正式部署依赖。探针与正式 Adapter 共享环境允许列表；需要额外自定义模型认证变量时先显式评估，不通过继承整个 Backend 环境排障。
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
unit 刻意没有 `[Install]` 且 `Restart=no`，不执行 `enable`，避免开机或故障时自动重复消耗额度。正式 Backend 已提供单独的 Restart=on-failure unit，目标主机恢复验收仍待完成。

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

## 源码目录安装开机启动服务

已有项目检出目录可使用 `scripts/install-service.mjs`，不需要把代码复制到固定的 `/opt` 路径。先用普通用户安装依赖并配置 `.env`，以服务账号安装并登录 Codex；服务账号必须已经存在且不是 root。安装过程不会改动 SQLite、Codex 配置或认证文件。

日常入口为 `service.sh`，以已配置 Node 22 / Codex 的普通用户调用，脚本按需请求 sudo。先停止已有手动后台，再运行：

```bash
bash scripts/service.sh start
bash scripts/service.sh status
bash scripts/service.sh stop
bash scripts/service.sh restart
bash scripts/service.sh uninstall
```

`start` / `restart` 每次先在项目根目录执行 `npm run build`，编译 Backend 和 Admin；失败立即退出，不调用安装器或变更服务运行状态。编译成功后查询 systemd 安装状态，仅在 `not-found` 时调用现有安装器并启用开机自启，安装成功后启动；已安装配置不会被覆盖。查询或安装失败时立即退出。首次安装仍需安装依赖、配置 `.env` 和完成 Codex 登录；使用普通用户入口可在 sudo 前保留当前 nvm 的 Node / Codex 绝对路径。`stop` 只停止，重启机器仍会自启。`uninstall` 依次停止、禁用、移除 `/etc/systemd/system/ai-news-hub.service` 并重新加载 systemd；遇到其他位置的 unit 拒绝删除。卸载保留代码、环境文件、数据库、密钥、Codex 认证和日志，重复卸载已不存在的服务成功返回；再次 `start` 可重新安装。也可使用 `npm run service:uninstall`。

开机自启和 systemd 故障重启仍直接运行现有构建，不执行编译。已运行的服务执行 `start` 不会重新加载代码，更新后使用 `restart`。

以下为高级安装方式，用于自定义账号/路径、预览或更新已有 unit。直接使用安装器前仍需手动执行 `npm run build`。

先查看生成的服务文件，确认账号、绝对路径、HOME、Codex 配置目录和环境文件：

```bash
node scripts/install-service.mjs --user "$(id -un)" \
  --codex "$(command -v codex)" --dry-run
```

确认后安装：

```bash
sudo "$(command -v node)" scripts/install-service.mjs \
  --user "$(id -un)" --codex "$(command -v codex)"
sudo systemctl is-enabled ai-news-hub.service
```

安装器先检查非 root 运行账号、Node 22.19.0 或更新的 22.x、构建产物和账号访问权限，再使用 `systemd-analyze verify` 检查服务文件。服务写入 `/etc/systemd/system/ai-news-hub.service`，执行 `daemon-reload` 和 `enable`。它不启动、停止或重启当前后台；手动实例可继续运行到关机，下次开机由系统服务启动，无需用户登录。需要立即交给 systemd 时，先正常停止手动实例，再执行 `sudo systemctl start ai-news-hub.service`，避免同一数据目录的两个 Backend 冲突。

| 选项 | 用途 |
| --- | --- |
| `--user` | 已存在的非 root 服务账号，默认 sudo 的调用账号 |
| `--node` | 名为 `node` 的 Node 可执行文件绝对路径，默认运行安装器的 Node |
| `--codex` | 名为 `codex` 的可执行文件绝对路径，默认在当前 PATH 中查找 |
| `--env-file` | systemd 环境文件，默认项目 `.env` |
| `--extra-env-file` | 显式指定额外私有环境文件，默认识别项目根目录已有的 `network.env` |
| `--codex-home` | Codex 配置/认证目录，默认服务账号 HOME 下的 `.codex` |
| `--log-dir` | 日志目录，默认项目 `logs/`；已有目录须为服务账号所有、0700 且不是符号链接 |
| `--dry-run` | 仅显示服务文件，不安装或启用 |
| `--replace` | 显式覆盖已有服务文件，不会自动重启 |

安装器将所选 Node/Codex 的目录加入服务 PATH，并拒绝会被同名文件遮蔽的选择。后台已保存的 Codex 可执行文件设置仍优先，若它是自定义路径，应确认服务账号也能访问；安装器不会替你修改网站设置。终端的代理和其他环境不会自动带入 systemd，可放在上述环境文件中（限制权限，不提交 Git）。环境文件使用 systemd 的变量赋值格式，不执行 shell 或展开 `$HOME`；数据目录填写绝对路径。

已有 unit 会拒绝覆盖，检查旧配置后使用 `--replace`。若 `daemon-reload` 或 `enable` 失败，错误会说明服务文件已写入并保留，修正原因后可用 `--replace` 重试。仓库测试覆盖生成、权限/覆盖保护和安装命令顺序；本机验证过系统服务文件语法，以及临时用户服务下带空格/百分号路径的实际解析。系统级安装及真实重启仍须在目标机完成，不能以 dry-run 代替验收。

### 代理网络配置

代理使用项目根目录中的独立 `network.env`，由 systemd 的 `EnvironmentFile` 注入 Backend，再通过已有环境白名单传给 Codex。GitHub 归档与删除请求使用 `EnvHttpProxyAgent` 读取同一组 HTTP(S) 代理变量。主机网络配置通过文件管理，管理员界面管理模型与业务设置。

手动配置可从仓库根目录的 [`network.env.example`](../network.env.example) 创建：

```bash
cp -n network.env.example network.env
chmod 600 network.env
```

在编辑器中取消所需代理项的注释并填写实际地址。成对的大小写变量须一致，NO_PROXY 中保留本机地址。已有配置可直接编辑。`service.sh` 通过 systemd 启动服务，systemd 在每次启动时读取已安装 unit 引用的环境文件。

安装器默认识别根目录中已有的 `network.env`，仅将路径写入 unit。首次创建文件后，若旧 unit 尚未引用它，使用 `--replace` 更新一次安装。后续修改文件执行 `sudo bash scripts/service.sh restart` 即可。显式的 `--extra-env-file` 优先于默认文件，自定义 CA/代理配置应一并维护在该指定文件中。

先在已配置代理的普通服务用户终端复制，保留该终端的代理环境：

```bash
npm run network:configure
```

命令默认输出脚本所在项目根目录的 `network.env`，与 `.env` 并列，从其他工作目录调用也定位到同一项目。支持 `--output /absolute/path/network.env` 指定位置。重复执行会原子更新文件，权限为 `0600`，输出仅包含文件路径和变量名。脚本复制 HTTP(S) 代理、统一大小写别名并将 localhost、127.0.0.1、::1 加入绕过列表，其他应用或发布凭据由原有配置管理。当前读取小写变量优先，HTTP 代理可作为 HTTPS 的回退，HTTP(S) 类型的 ALL_PROXY 可作为回退来源；SOCKS 代理需先提供 HTTP(S) 代理端口。

在项目根目录执行以下命令：

```bash
sudo "$(command -v node)" scripts/install-service.mjs \
  --user "$(id -un)" --codex "$(command -v codex)" \
  --replace
sudo bash scripts/service.sh restart
npm run health
```

首次安装时可省略 `--replace`。安装器只在 unit 中保存配置文件路径，systemd 在启动时读取内容。现有额外环境文件若还包含 CA 配置，合并维护这些变量到同一个私有文件后再安装。

手动启动使用相同文件：

```bash
npm start -- --network-env-file network.env
```

启动脚本将文件交给 Node 的 `--env-file` 解析，路径含空格时使用引号。手动启动时，终端已经导出的同名变量按 Node 的环境优先规则生效。文件内容使用环境变量赋值格式，修改后重启服务。

代理本身须在开机后可用。健康检查只反映 Backend/SQLite 状态，Codex 账户读取与 GitHub 网络访问需要独立验证。`network.env` 与 `.env` 均由 Git 忽略，备份时单独保存这些本机配置。

## 9. Issue #3 Backend 基础服务部署

以下命令面向原生 Ubuntu Server 24.04 LTS，假设系统级 Node.js 22 与 npm 位于 `/usr/bin`。实际路径不同时先修改 unit 与命令；若采用源码目录安装器，可显式选择现有 Node/Codex 的绝对路径，但应确保这些路径在开机后仍然存在。目标主机的安装和 systemd 生命周期必须实测后才能验收。

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
sudo cp -R dist scripts package.json package-lock.json /opt/ai-news-hub/
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

systemd 读取 `/etc/ai-news-hub/ai-news-hub.env`，不会加载开发目录 `.env`，也不自动继承交互 shell 的 PATH 或代理。未启动任务时 Backend 不请求模型；未初始化时业务管理 API 关闭，第 10 节说明首次设置。
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

启动/停止/重启可直接 `sudo systemctl start|stop|restart ai-news-hub.service`（选择一个动作），或在源码目录用 `bash scripts/service.sh start` / `stop` / `restart` / `status`，按需自动请求 sudo；卸载使用 `bash scripts/service.sh uninstall`。开发启动使用 `npm start`，默认追加写入项目 `logs/backend.log`，Ctrl+C 会关闭 HTTP 和数据库。可用 `npm start -- --log-dir /absolute/path` 指定目录；相对目录以项目根目录解析。启动脚本自动创建日志目录，以私有权限创建日志文件，不覆盖已有日志。`tail -f logs/backend.log` 实时查看。systemd 模板使用同一 `scripts/start.sh`，通过 `LogsDirectory` 创建 `/var/log/ai-news-hub`，服务日志追加到该目录的 `backend.log`；journal 保留启动脚本与 systemd 生命周期信息。生产传入 `--no-env-file`，只使用 unit 的 EnvironmentFile。
验证完成后才启用开机启动：`sudo systemctl enable ai-news-hub.service`。

### 目标主机验收与当前限制

- 记录发行版、Node、SQLite、systemd 版本、服务 UID、实际可执行路径；确认只监听回环地址，root 启动会被拒绝。
- 迁移空库后再运行迁移，原数据不变；源码测试覆盖外键、幂等约束、历史 checksum 和失败回滚。
- 正常停止日志有 `server_stopped`，HTTP 关闭；再次启动原记录保留。异常杀死服务主进程后检查 systemd `NRestarts` 与健康检查恢复，记录脱敏日志，不将运行数据提交到 Git。
- 当前测试验证普通 Node 进程的停止/重启，CI 使用 Ubuntu 24.04；它们不等于完成 systemd 安装、开机启动或重启主机实测。
- CI 静态检查在临时 unit 副本中将 `/usr/bin/node` 替换成 runner 的实际 Node 路径；目标主机仍须独立确认安装路径并校验正式 unit。
- `/health` 只说明基础服务与 Schema 可读，不验证 Codex 登录/额度。现有管理 API 可手动执行样例/新闻并独立批准、归档，已支持持久计划与单实例调度；重启只中断旧 Run，不自动恢复执行。#2 认证/systemd 问题继续独立跟踪。

## 10. 管理员初始化、配置与真实任务

业务环境文件仅配置 HOST/PORT/DATA_DIR，使用第 9 节安装的 `.env.example`。启动后打开本机管理页面，首次仅需填写“设置密码”和“确认密码”，无需在终端读取初始化码。

打开 `/admin/`，设置并确认至少 12 字符的管理员密码；成功后不再允许重新初始化，后续用密码登录。后台“系统设置”保存 Codex 实际路径/模型、超时/并发/队列、日志和 GitHub 目标，SQLite 持久化，空闲时无需重启生效。任务或归档忙碌时先等待完成。

同一非 root 服务账户完成 Codex 认证，HOME/CODEX_HOME 与 systemd 配置保持一致。操作系统 PATH、代理和 CA 属主机环境，按网络要求配置；Codex 子进程只继承允许列表，不接收 Backend 管理/发布凭据。Web 不管理 Codex OAuth 文件。

按 [API 说明](TASK_ENGINE.md#手动触发样例) 获取临时 Bearer 会话并触发 sample-connectivity，核对 Run 的状态、Thread/Turn 和结果；启动本身不调用模型。每个数据目录只允许一个 Backend，重启把未完成记录标 interrupted，不自动重跑。失败/取消/审批/超时等语义见任务引擎。

旧环境配置仅在相应数据库记录缺失时一次性导入，已有 DB 后忽略旧值。旧 Token 用户可在系统设置改设密码，之后旧 Token 失效。迁移只追加到当前版本 6，不删除旧库。

备份必须停服务后保留一致的 SQLite 和私有 settings.key；密钥自动生成、0600，不写入环境文件。丢失/错误密钥导致启动失败，不自动清空配置。认证、设置 API、恢复边界见 [设置说明](SETTINGS.md)。原生 Ubuntu Server 服务账户/systemd 与长期认证仍由 #2 验收。

## 11. Codex 主题研究与多轮日报

升级前停服务并备份 SQLite，执行 `npm ci --ignore-scripts`、`npm run build`，再以原服务账户启动。迁移 5 追加新闻研究快照和 Turn mode，停用旧 news-github；历史迁移和报告不删除。启动、health 和查询不调用模型。

在 `/admin/` 选择 news-research，填写主题和初始 prompt；Run 页面可多轮继续研究，最后显式生成待审核日报。API 初始请求带 topic/input，后续 input/finalize，见 [完整协议](NEWS_PIPELINE.md)。每轮消耗账户额度，一个 Run 最多 20 轮，生成成功后不能继续修改；失败可在同 Thread 修正重试。

服务账户的 Codex、模型/provider 和受管策略须允许 hosted live web search。Backend 显式开启实时搜索，逐个禁用继承的 MCP、禁用 Shell/应用/委派，仍拒绝所有审批。不要把只读沙箱视为凭据隔离，继续遵守服务账户和环境允许列表要求。

最终生成直接使用 Codex 返回的内容与 HTTPS 来源链接，不再要求 Backend 出站抓取网页。原文访问、引文提取由 Codex 完成；Backend 仅做结构和链接格式检查。GitHub 归档按已有凭据与代理配置工作。

来源不可访问、引文不匹配、认证过期或搜索不支持时，检查 Run 错误并修正来源/prompt，不添加假内容。可按研究量调整单 Turn 总超时 后台“模型与执行”的每轮超时（默认 10 分钟），页面按分钟配置。生成的 validated 仍待人工审核，不自动归档。历史 RSS 验证不能替代当前研究验证，见 [当前记录](validation/CODEX_RESEARCH.md)。原生服务账户/systemd/长期认证仍由 #2 验收。

## 12. Issue #6 本地管理后台

在源码安装依赖并运行 `npm run build`，它同时生成 Backend 与独立 `dist/admin`。部署时保留整个 `dist`，不能只拷贝 server；重启服务后打开 `http://127.0.0.1:3000/admin/`。更新后台 UI 后需要重新构建并重启 Backend，再刷新浏览器；静态资源清单在 Backend 启动时读取。新版页面无需额外字体、图片服务或配置。后台构建缺失时入口返回 503 `admin_build_missing`，不会影响原有健康/API 路由。构建需要开发依赖；正式运行仍通过单个 Backend/systemd，不需额外 Vite 服务。

按第 10 节初始化后用密码登录，临时会话仅页面内存持有，不使用 Cookie/localStorage/sessionStorage。刷新后重新登录，Task/Run 导航与服务端历史保留。页面壳和 JS/CSS 不含私有数据，可以在认证前加载；任何任务、日志、报告读取或执行仍须 Bearer Token。退出、401 或管理 API 被关闭时移除私有视图。

在同一台 Linux 主机上直接本地访问。只有 Backend 部署在另一台机器时才需安全通道，例如在访问端运行 `ssh -L 8080:127.0.0.1:3000 user@server`，然后浏览器打开 `http://localhost:8080/admin/`；Token 认证仍必需。SSH 是远程访问方式，不是本机访问的前置条件，不要为管理界面改成公网监听。

`dist/admin` 仅部署到私有 Backend。公共阅读站应使用独立构建目录，禁止将整个 `dist` 或仓库根目录作为 Cloudflare Pages 发布目录；公开站已由 Issue #8 独立构建到 dist/web，Cloudflare 真实部署仍待验收。后台操作与限制见 [使用说明](ADMIN.md)。

## 13. Issue #7 人工批准与 GitHub 归档

先停服务并备份 SQLite，升级代码、`npm ci --ignore-scripts`、`npm run build`，由同一非 root 服务账户启动；迁移 4 自动追加，不修改历史 SQL。不要删除旧库。发布默认关闭，不影响新闻生成/预览。

在后台“系统设置”启用 GitHub 归档，填写仓库、分支和 Token，保存至 SQLite。目标分支须预先创建，推荐专用归档仓库/分支。Token 使用限定该仓库的 fine-grained PAT（Contents read/write），也可填写外部获取的短期 GitHub App token；不自动刷新。Token 加密且不回显，轮换后空闲时立即生效，历史幂等记录不变。

凭据仅放私有环境文件，不配置在 Codex HOME/CODEX_HOME、Agent 工作目录、浏览器 `VITE_*` 或 Git；Backend 不把这些变量传给 Codex。HTTP 仅访问固定 api.github.com，拒绝重定向，单次发布网络操作总上限 20 秒，响应解码限额 2 MiB，归档 JSON 上限 256 KiB。HTTP_PROXY/HTTPS_PROXY/NO_PROXY 沿用受限环境配置，不入库。

在 `/admin/` 的新闻 Run 中核对来源后勾选确认并批准，再单独点击归档。发布目标、状态、错误及 Commit SHA 可查看；401/403 可能为凭据过期、权限或 GitHub 限流，修复后显式重试。支持任务自动调度和可选自动归档；不自动重试失败运行，也不配置 Cloudflare 构建触发；若目标仓库自行配置 Actions，GitHub 提交可能触发其已有工作流。

具体 API、归档路径/Schema、冲突和恢复步骤见 [发布说明](PUBLISHING.md)，实测见 [发布验证](validation/PUBLISHING.md)。真实验证使用专用测试分支，不要把该测试分支作为正式公开站内容来源。#2 原生 Ubuntu Server/systemd/长期认证验收仍独立跟踪。

## 14. Issue #8 公共站构建与 Pages

公共阅读站按任务话题组织：一个任务对应稳定话题，首次归档后出现在首页选择器中；首页只展示当前话题的最新一期，每个话题有独立的日期/版本归档、详情与 RSS。同一天不同话题和相同来源条目互不覆盖。浏览器 localStorage 只保存话题 ID 与明暗偏好，首页有效的 `?topic=<id>` 优先于已保存偏好；禁用脚本或存储时仍可通过链接阅读。旧归档 JSON 不改写，兼容原有日期、版本与来源链接。

首页采用紧凑阅读布局：页面铺满浏览器宽度，桌面左侧只显示话题，中间显示日报，右侧显示可跳转的本期目录；窄屏将话题放回顶部、目录改为折叠入口。简报页眉从日期开始，不重复显示话题名称或“最新一期”标签，并突出显示星期与真实生成时间（北京时间）；目录底部不重复日期或话题名，移除重复期刊标题和进入/阅读整期入口。当前日报完整展示标题和事实摘要，标题仍链接到含分析与引文的详情；目录长标题最多显示三行，完整原文保留在归档和详情中。来源与分类位于正文下方，移除列表序号和大圆角容器。正文只将显式 HTTP(S) Markdown 链接渲染为安全外链，其余内容按文本转义；不执行 HTML、不加载外部图片。首页切换话题同步更新顶部归档入口；RSS 仍通过各话题页面的订阅发现链接提供。带官方仓库链接和可识别事实标签的开源项目详情按项目名、仓库、核心用途、技术要点、近期证据、适用场景、许可证及编辑判断分节阅读；桌面端正文紧接话题侧栏排布，正文自身限制行宽；旧归档仅展示已有事实，不补造技术信息。其他资讯维持原详情布局。资讯详情页头的所属日报日期只在面包屑导航中显示，分类单独显示。原文发布时间等来源元数据位于“来源与引文”。

公共站不运行 Linux Backend，不需要 Codex、管理 Token、SQLite 或发布 Token。根目录安装锁文件依赖后，运行 `SITE_URL=https://your-project.pages.dev npm run build:web`，仅上传 `dist/web`。不得将 `dist` 根目录、`dist/admin` 或 SSR 构建模块 `dist/web-render` 设为公开输出。

Cloudflare Pages 从本 GitHub 仓库 main 集成，根目录留空、命令 `npm run build:web`、输出 `dist/web`、`NODE_VERSION=22.19.0`、`SITE_URL` 为真实稳定 HTTPS origin。同分支正式 reports 提交触发自动构建；另一归档仓库/分支必须另外安全检出并触发部署，默认不会自动跨分支读取。初次没有正式日报时正常展示空状态。不要将测试归档分支或 demo fixture 当正式新闻。

详细账户/GitHub App 授权、Private Repo、路径与数据边界见 [公共站部署说明](PUBLIC_WEB.md)。当前代码与本地浏览器验证不等于 Cloudflare 已上线；实际账户接入、URL 和一次 Git 自动部署成功后才能完成 #8 上线验收。开发阶段的两日期样本仅在显式 demo 模式使用。

## 15. 代码与文档复核

仓库根目录检查 `npm ci --ignore-scripts`、lint、typecheck、test 和 build；公共站另按第 14 节构建/预览。模拟检查不消耗真实模型额度，不写入 GitHub 归档目标。消息 phase 兼容、归档目标切换后的显式写操作及只读刷新均有回归覆盖，详见 [复核记录](validation/REPOSITORY_AUDIT.md)。这不替代第 8–10 节的原生服务账户/systemd 实机验收，也不代表已连接 Cloudflare。

<!-- Settings UI update -->
管理后台侧栏平级显示任务总览、模型与执行、GitHub 归档、安全设置，不再设置父级菜单；右侧单列显示当前标题与表单，窄屏导航折为顶部菜单。切换前需保存当前修改。Token 默认仅显示配置状态，点击设置或更换后才显示输入框。分支无预填值；已有配置保留。更新前端需运行 `npm run build`。

## 用户配置任务与顺序执行

任务 CRUD、手动/单次/间隔/每日/每周调度、顺序多轮 Prompt 与可选自动 GitHub 归档已接入单实例 Backend。计划和执行快照写 SQLite，重启中断旧执行且不补跑。自动授权记录与人工批准分开，外部构建部署由目标仓库集成承担。删除采用软删除保留审计，不删除数据库。API、限制与界面见 [任务管理](TASK_MANAGEMENT.md)。

管理后台移除重复页名顶栏与静态“本地管理/A”标识；每页只保留内容标题，设置表单使用侧栏外的可用宽度。运行详情保留返回任务入口。更新后台后需刷新页面加载新静态资源。

任务新增/编辑使用独立模态卡片，表单内部滚动；保存或取消返回任务列表，编辑时不在列表上方展开表单。

任务配置与执行结果分开：任务总览负责配置、计划和启停；独立“运行与结果”提供跨任务历史、任务/状态筛选及分页，包含已删除任务的历史。详情默认展示最终日报，Prompt 输出和日志为次级标签，支持审核与发布。不再追加系统生成 Prompt，最后一条配置直接生成日报；历史来源抓取失败记录保留可查；新执行不再抓取原文。



当前日报来源模式为 `codex_reported`：Backend 不再联网核验原文或匹配引文，不再追加来源修复；保留 JSON/HTTPS 链接格式、数据关联和发布哈希检查。后端未抓取时 `fetchedAt/fetched_at` 为 null，不伪造原文发布时间或事件时间。历史 `source_only` 报告仍可读取和归档。

当前用户配置任务严格执行 N 条 Prompt = N 次 Codex Turn。最后一条原始 Prompt 直接返回日报结构，Backend 只在开发者格式指令中提供主题/时间/Schema，不改写持久化的用户 Prompt，也不再追加“依据前面所有轮次的研究结果，生成完整日报。”。旧执行记录的额外系统轮仅作为历史保留。

最终结果以固定 HTML 模板呈现为简报阅读预览：编号、中文分类、正文、可选分析和原文链接；引文及已知来源时间折叠展示，缺失日期与空分析隐藏，结构化 JSON 可展开。审核和 GitHub 归档操作保留在预览之外；仅调整展示，不增加 Codex 调用、不改写保存的结果或归档数据。

管理后台首页为“系统概览”（`/admin/#`）：展示任务总数、今日执行、运行/排队、待审核，配合最近 7 天执行图、任务分布、待处理入口和最近 5 次执行。受认证的 `GET /api/overview` 基于 SQLite 全量聚合，上海时区自然日统计；当前任务不含删除和内置任务，运行历史包含已删除的配置任务。任务管理移至 `/admin/#/tasks`，使用紧凑表格，新增/编辑仍为独立弹窗；原有 Task/Run 深链接保持可用。

任务管理支持主题搜索、手动/定时启用/定时暂停筛选及每页 10 条分页，仅查询当前页任务的最新执行状态。桌面使用紧凑表格，窄屏使用任务卡片，编辑为行内操作，删除仍需确认。任务列表和配置详情不再提供“运行记录”快捷入口，执行历史统一在“运行与结果”查看；单页列表隐藏翻页按钮。

GitHub 归档不再设全局启用开关：仓库、分支和已保存 Token 完整即为可用；允许保存未完整配置，清除凭据后恢复未配置。旧 `github.enabled` 写入参数为可选兼容字段且被忽略，返回值表示派生配置状态，旧数据库中的 false 不再禁用完整目标。任务 `autoPublish` 继续独立控制自动归档。建议创建 fine-grained PAT，仅选择归档仓库并授予 Contents read/write；后台不展示已保存 Token。

GitHub Token 使用始终可见的空白密码输入框，移除说明段落及设置/更换按钮、清除复选框；保存时留空保留已存 Token，输入新值替换，成功保存后再次清空输入框，不回显凭据。

服务日志统一使用 `info`，前端不提供日志级别配置。

运行详情保留“最终结果”“Prompt 与回复”“诊断日志”三个标签，运行元数据合并到诊断日志顶部；成功生成日报的回复直接提供阅读预览及可展开的原始输出。

GitHub 上传路径校验兼容 v1 日期归档和 v2 话题归档。升级后可重试此前因 `archive_invalid` 失败的归档，复用已生成日报。

系统概览移除“任务分布”图卡，最近 7 天执行趋势改为单列铺满；任务计数、待处理与最近执行保持可用。

本期目录按实际条目生成锚点，支持点击跳转和滚动位置高亮；刷新带话题与锚点的 URL 仍能定位。样式与目录作为正式组件构建，不依赖效果稿。

后台执行趋势使用固定高度和按实际容器宽度计算的坐标，避免单列布局将图表等比例放大。

公共邮件订阅作为可选功能：Pages Functions 处理订阅确认与退订，独立 D1 保存私有订阅/发送状态，GitHub Actions 按上海时间每日触发汇总，Resend 负责实际发送；不连接私有 Backend 或向 Codex 暴露邮件凭据。默认关闭，演示站禁用，需完成发件域名、密钥和 D1 配置才可验收真实投递。见 [邮件订阅](NEWSLETTER.md)。

部署须连同仓库根目录 `prompt-templates/` 和 Backend 一起更新，更新后刷新任务编辑器读取模板；已有开源项目任务也需重新选择“每日开源项目 · v1”并保存，才会采用分节内容要求；已有科技任务需重新选择“每日科技投资简报 · v1”并保存，或同步任务名称、主题与 Prompt。新版 `【固定 10 条】` 校验及去重上下文需要构建并重启 Backend（`bash scripts/service.sh restart` 会自动编译）。历史固定 8 条标记仍兼容；不足目标条数不会归档。建议先关闭该任务的自动发布，试跑并检查条目与来源，再决定是否恢复。历史执行快照和已归档日报保持原样。本次不新增数据库迁移。Backend 工作目录保持仓库根目录（现有启动脚本自动切换）。启动自动应用 migration 11；升级前备份完整私有数据目录。日报删除需要 GitHub Token 对历史归档仓库具备写入权限；归档服务忙碌时拒绝并发操作，远端失败保留本地日报供重试。公开站需在归档删除提交后重新构建。

邮件订阅修复 Cloudflare Workers 发信/读取日报前的请求兼容问题：使用 `redirect: manual` 并拒绝非 2xx，禁止自动跟随重定向。需重新部署 Pages，已有待确认订阅不会自动补发。排查步骤见 [邮件订阅](NEWSLETTER.md)。

邮件确认/退订页面样式随 Pages Functions 部署；更新后重新部署 Pages 即可，不需要新增 D1 迁移或重启 Linux 后台。

公共站移除底部站名、归档与 RSS 链接栏；往期归档仍由顶部导航进入，RSS 文件及页面的订阅发现链接保留。启用邮件订阅时，表单单独显示在页面底部。页面容器最小高度覆盖视口，正文区域填充剩余空间，短归档和空页面的订阅表单贴住视口底部，长页面的表单排在正文末尾。

README 已恢复动态架构图及 SVG 动画入口，生成器同步展示 systemd、任务调度、GitHub 归档、Cloudflare Pages/Web/RSS，以及 GitHub Actions → Pages Functions ↔ 私有 D1、Pages Functions → Resend → 订阅者的邮件链路。架构图作为文档资源生成，邮件投递仍以生产配置和实际验收为准。

升级执行删除功能后运行 `npm run build` 并重启 Backend，刷新管理页面即可在“运行与结果”操作“删除记录”。复用现有日报删除表与发布配置，远端移除需要历史归档目标的 GitHub 写入权限。现有数据库自动沿用当前迁移版本，删除由用户确认触发。

公共站话题归档列表使用侧栏旁的完整可用宽度，取消居中的 900px 限制；邮件订阅保持在页脚，正文阅读页宽度规则不变。

后台“运行与结果”的删除确认采用居中模态弹窗，显示任务、触发时间与 DB/GitHub 删除范围；默认聚焦取消，支持 Esc 关闭，删除进行中禁止关闭和重复提交，失败可在弹窗内重试。

每日热点观察 `daily-headlines` 保持 v1 与两轮结构：第一轮建立全球新闻候选池，第二轮核查筛选简报；严格限定北京时间最近 24 小时，扩大经济、金融、数字资产、AI 和产业覆盖，不设类别配额。模板更新不自动修改已有任务，已保存任务需重新选择模板并保存；历史 Run 配置快照保留。
