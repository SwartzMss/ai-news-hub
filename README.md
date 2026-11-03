# AI News Hub

> 指定主题，通过多轮 prompt 让 Codex 搜索、核实和整理新闻；人工审核后归档 GitHub，提供静态 Web / RSS 阅读。

**当前状态：Codex 主题研究、多轮追问、显式生成待审核日报、人工批准及归档已实现；定时调度、原生 Linux 服务账户/systemd 与 Cloudflare 自动部署仍待验收。**

运行目标为 **Linux，首选 Ubuntu Server 24.04 LTS**。本地管理后台可以先独立使用，公开站点部署不是运行 Backend 的前置条件。

## 架构一览

![架构动画：主题和多轮 prompt 经 Backend 驱动 Codex 实时搜索，最终结果通过来源校验存入 SQLite，人工批准后归档 GitHub，构建独立 Web 和输出 RSS。](docs/assets/architecture.gif)

[查看静态架构图](docs/assets/architecture.svg) · [详细架构](docs/ARCHITECTURE.md)

**Task → Run → Thread → Turn**：主题和会话属于一次具体 Run，后续 prompt 恢复同一个 Thread。Codex 负责搜索、提取和分析；Backend 管理校验、状态、存储和发布。人工批准才允许归档，公开站只消费已批准的 JSON。SQLite、管理 Token 和运行日志留在私有服务侧。

## 已实现的能力

| 模块 | 当前范围 |
| --- | --- |
| Linux Backend | Node.js 22 / TypeScript、Fastify、私有 SQLite、追加式校验迁移、单实例锁、健康检查 |
| 任务引擎 | 主题与 prompt 输入、多轮 Turn、队列/并发限制、幂等、状态/历史/日志、取消、超时、重启中断 |
| Codex Adapter | stdio JSON-RPC、独立 Thread/Turn、只读沙箱、拒绝工具审批、子进程清理；过程消息与最终结果分离 |
| 新闻研究 | Codex 实时搜索原文，多轮筛选/补查，显式生成 JSON；Backend 核对公开原文与精确引文后保存待审核日报 |
| 管理后台 | 独立 React/Vite `/admin/`，填写主题/初始 prompt、继续研究、生成日报、查看日志/来源及人工批准 |
| GitHub 归档 | 显式配置目标与凭据，按日期/频道/版本追加 JSON，保存 SHA，幂等及失败显式重试 |
| 公共阅读站 | 独立 React/Vite 静态首页、开源频道、详情、日期/版本归档、全站/频道 RSS；无 JS 也可阅读 |

研究主题可自由填写，不再从外部 RSS 采集候选；来源由 Codex 搜索选择。归档 v1 仍使用 `opensource` 频道键，专题不等于新建发布频道。任务定义编辑、持久化调度、SSE、Agent 工具交互审批及更多发布频道仍在 [路线图](docs/ROADMAP.md) 中。

`validated` 仅代表结构和来源关联校验，`approved` 代表人工允许发布；两者都不等于独立事实核验。事实摘要、分析推断、来源发布时间、事件时间与抓取时间分开保存和展示，未知时间保留空值。

## 本地运行管理后台

准备非 root Linux 账户、Node.js **22.19.0 或更新的 22.x**，以及服务账户已认证的 Codex CLI：

```bash
npm ci --ignore-scripts
cp .env.example .env
```

`.env` 只保留监听地址、端口和数据库目录：

```dotenv
AI_NEWS_HUB_HOST=127.0.0.1
AI_NEWS_HUB_PORT=3000
AI_NEWS_HUB_DATA_DIR=/home/your-user/.local/share/ai-news-hub
```

数据目录使用当前用户有权限的仓库外绝对路径，权限 0700；正式服务默认 `/var/lib/ai-news-hub`。

```bash
npm run build
npm start
```

打开 **http://127.0.0.1:3000/admin/**。首次从数据目录的 `setup-code` 文件读取初始化码，在页面设置管理员密码；之后使用密码登录。进入“系统设置”管理 Codex 路径/模型、超时/并发、日志及 GitHub 归档目标，无需修改环境文件或重启。

会话只保存在页面内存，刷新重新登录。配置保存在 SQLite，GitHub Token 加密且不回显，密钥自动保存在私有数据目录。备份、旧版本一次性迁移与 API 见 [设置说明](docs/SETTINGS.md)。任务或归档执行中暂不允许保存设置。

手动运行 `sample-connectivity` 验证接入。选择 `news-research`，填写主题（如“AI 开源模型”）和初始 prompt；在 Run 页面继续追问，最后填写整理要求并点击“生成待审核日报”。每轮都会使用账户额度。生成成功后本 Run 固定，修改需新建研究；审核后单独批准、归档。发布默认关闭，配置见 [GitHub 归档](docs/PUBLISHING.md)。

新闻 Thread 启用 Codex 实时 web search，禁用继承的 MCP、Shell 与委派；服务账户和模型/provider 须支持搜索。最终生成时 Backend 只校验 Codex 选定的公开 HTTPS 原文，不另行采集候选。校验需要服务器能直接访问原文；暂不跟随重定向，也不执行页面 JavaScript。限制与错误处理见 [新闻流程](docs/NEWS_PIPELINE.md)。

`npm run health` 检查本地服务/数据库，不验证 Codex 登录或额度。启动自动迁移，也可显式运行 `npm run db:migrate`；失败不清空旧库。SQLite 使用 Node 22 内置实验性 `node:sqlite`，保留其提示。

## 构建公共站

```bash
# 正式构建：读取当前 checkout 的 reports/，无数据时展示空状态
SITE_URL=https://your-project.pages.dev npm run build:web

# 显式演示：两个日期的测试样本，页面/RSS 标记 DEMO
npm run build:web:demo
```

唯一公开输出是 **`dist/web`**。`dist/admin`、`dist/apps` 与构建用的 `dist/web-render` 都不能上传到公开站。生成后的 HTML、静态数据与 RSS 不依赖 Backend 在线。

Cloudflare Pages 的 GitHub 授权、HTTPS 与自动构建尚待实际验收，不能把本地构建成功当作已经上线。构建命令、输出目录、`SITE_URL`、Private Repo 和跨分支归档约束见 [公共站与部署](docs/PUBLIC_WEB.md)。

## 工程结构与检查

```text
apps/server/src/       Backend、任务引擎、Codex Adapter、SQLite、来源校验与归档
apps/admin/            私有管理后台
apps/web/              公共阅读组件与独立静态生成器
packages/shared/src/   共享接口、状态与 Agent 环境白名单
tools/codex-probe/     独立接入诊断工具
scripts/               健康检查、服务操作与架构图生成
```

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` 包含 Backend、Admin 与公共站的模拟测试/静态构建，会启动回环 HTTP 和模拟子进程，不访问真实新闻源或模型。构建 Backend/Admin 与构建公共站是两个独立入口。

开发工具链以 `overrides` 固定 minimatch 11.0.1，处理 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)；后续更新依赖时应重新评估。架构图资源及可复现生成方式见 [资源说明](docs/assets/README.md)。

## 文档与验收

| 内容 | 文档 |
| --- | --- |
| 架构与数据边界 | [ARCHITECTURE](docs/ARCHITECTURE.md)、[DATA_MODEL](docs/DATA_MODEL.md) |
| Linux 安装、systemd 与认证 | [DEPLOY_LINUX](docs/DEPLOY_LINUX.md) |
| 系统配置与认证 | [SETTINGS](docs/SETTINGS.md) |
| 任务 API / 管理后台 | [TASK_ENGINE](docs/TASK_ENGINE.md)、[ADMIN](docs/ADMIN.md) |
| Codex 研究与日报 / GitHub 归档 | [NEWS_PIPELINE](docs/NEWS_PIPELINE.md)、[PUBLISHING](docs/PUBLISHING.md) |
| 静态站、RSS 与 Pages 配置 | [PUBLIC_WEB](docs/PUBLIC_WEB.md) |
| 计划和 UI | [ROADMAP](docs/ROADMAP.md)、[UI_DESIGN_SPEC](docs/UI_DESIGN_SPEC.md) |

真实开发验证记录包括 [Codex 探针](docs/validation/CODEX_LINUX_PROBE.md)、[任务引擎](docs/validation/TASK_ENGINE.md)、[新闻流水线](docs/validation/NEWS_PIPELINE.md)、[管理后台](docs/validation/ADMIN.md)、[归档](docs/validation/PUBLISHING.md) 与 [公共站](docs/validation/PUBLIC_WEB.md)。它们的日期、环境和范围各自注明；原生服务器长期认证与 systemd 验收仍由 [#2](https://github.com/SwartzMss/ai-news-hub/issues/2) 跟踪，Cloudflare 上线由 [#8](https://github.com/SwartzMss/ai-news-hub/issues/8) 跟踪。

## 数据与安全

- 非 root、最小权限；Backend 和 Agent RPC 不默认开放公网。
- 发布凭据由后台加密保存，不继承给 Codex；管理会话不进入浏览器持久存储。
- SQLite、OAuth 凭据、Cookie、代理配置和私密运行日志不入 Git，不导出到公开站。
- 无有效来源不发布；原文更正刷新当前来源，已生成报告与候选快照保留历史。
- GitHub 只归档人工允许发布的内容；公共页面清楚标注来源与推断，不伪造评论、点赞或热度。

## License

**待确定。** 尚未添加许可证；在明确选择开源协议前，不应假定已授予额外复制、修改或分发权限。
