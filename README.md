# AI News Hub

> 基于 Codex App Server 的 AI 信息聚合、定时分析与多渠道订阅平台。

**项目状态：规划 / 初始搭建阶段（尚不可运行）**

**v0.1 平台决策：仅支持 Linux（首选 Ubuntu Server 24.04 LTS）；不开发或测试 Windows / WSL 部署。**

AI News Hub 旨在将新闻采集、AI 研究与分析、任务调度、内容发布组合成一套可自托管的系统。支持通过网页浏览日报，也支持使用标准 RSS 订阅。核心设计是 **Linux 主机运行 Codex Agent 和管理后台，GitHub 归档日报，Cloudflare Pages 公开发布静态阅读内容**。

## 目标

- **自动化信息处理**：按计划采集信息，去重、核实来源，并交由 Codex 分析。
- **网页 + RSS**：生成可检索、按频道归档的网页内容和独立 RSS Feed。
- **可观察的 Agent 任务**：管理任务、查看执行状态、日志、失败原因，必要时手动重试。
- **低运维成本**：v0.1 以 Linux + systemd 部署为唯一目标，公开内容交由静态托管平台。
- **可扩展的专题频道**：新闻只是第一个场景，后续可增加任意研究主题。

## 计划支持的频道

| 频道 | 内容方向 |
| --- | --- |
| 综合新闻 | 当日重要事件与事实摘要 |
| AI / 科技 | 大模型、开发者生态、科技公司和产业趋势 |
| 投资市场 | 市场动态、公司事件与影响逻辑（不构成投资建议） |
| 开源项目 | GitHub 新项目、热门仓库与重要版本更新 |
| 热点话题 | 社交媒体讨论、观点分歧与典型评论（需标注来源与可验证性） |

## 计划功能

### 公共阅读端

- 按频道、日期查看每日简报与新闻条目
- 展示事件时间、原始来源、引用链接与 AI 整理结论
- 提供频道级 RSS Feed 与全站 RSS Feed
- 历史内容归档；静态发布后的内容在本地 Agent 离线时仍可访问

### 管理端（Linux 服务端，仅授权访问）

- 创建、编辑、暂停、手动执行定时任务
- 通过 Codex App Server 创建 / 恢复 Thread、启动 Turn、订阅执行事件
- 展示运行日志、完成状态、失败原因和重试入口
- 在任务详情中选择 Run / Thread，查看事件、继续多轮 Turn、审核结果
- 审核生成内容后发布；支持自动发布策略（需显式配置）
- 不设独立的「Agent 工作台」一级模块；Agent 交互归属具体任务与执行记录

## 预期架构

```text
新闻来源（RSS / 官方网站 / 授权 API）
                  |
                  v
          采集、规范化与去重
                  |
                  v
      Backend / Scheduler / Database
                  |
           JSON-RPC over stdio
                  |
                  v
           Codex App Server
           研究、分析、总结
                  |
                  v
        内容校验 / 审核 / 存储
                  |
            静态内容构建
             /          \
            v            v
        Web 页面       RSS / JSON
            \            /
             静态托管平台
```

**职责边界**：后端负责采集、调度、状态、存储和发布；Codex 负责需要推理和工具调用的分析任务。不要把数据真实性、定时可靠性或发布权限全部交给 Agent。

## 建议技术选型（尚未落地）

| 模块 | 计划方案 |
| --- | --- |
| 运行环境 | Linux（首选 Ubuntu Server 24.04 LTS），Node.js + TypeScript；v0.1 不支持 Windows |
| Agent 接入 | Codex App Server，优先 stdio |
| 后端 API | Fastify |
| 服务管理 | systemd：管理 Backend，由 Backend 启动 Codex App Server 子进程 |
| 定时调度 | 应用内调度 + SQLite 持久化任务状态；systemd 负责服务恢复 |
| 存储 | SQLite |
| 前端 | React + Vite |
| 实时任务事件 | SSE |
| 内容格式 | Markdown / JSON / RSS 2.0 |
| 内容归档 | GitHub（每日按日期提交 JSON / Markdown，保留历史数据） |
| 网站发布 | GitHub 触发 Cloudflare Pages 静态构建；公开 Web / RSS |

以上是初步方案，不代表依赖已经安装，也不代表相关功能已实现。

## 开发路线

- **v0.1：Linux 端到端 MVP** — systemd 托管、App Server、基础新闻采集、结构化输出、Web / RSS，以及最小任务管理页面（启动、状态、日志、结果预览）
- **v0.2：任务增强** — 持久化调度完善、可编辑 Prompt、多轮 Turn、历史运行、重试和审核流程
- **v0.3：内容质量** — 来源核验、跨来源去重、审核流程与频道配置
- **后续** — 更多消息推送方式、搜索、远程安全管理和多运行节点

详见 [开发计划](docs/ROADMAP.md) 与 [架构设计](docs/ARCHITECTURE.md)。

## Linux 部署（规划中）

v0.1 仅针对 **Linux** 开发与验收。当前仓库尚无可启动的 Backend；请不要将下面的环境检查命令理解为服务已实现。

在 Linux 上安装 Node.js LTS、Codex CLI 后，可检查：

```bash
codex --version
codex app-server --help
codex login status
```

计划以非 root 服务账户运行 Backend，交由 `systemd` 守护；Backend 以 `stdio` 子进程方式管理 Codex App Server。无图形界面的服务器需在部署前完成合适的 Codex 认证和凭据续期验证，不能假定无人值守会永久有效。

详见 [Linux 部署设计](docs/DEPLOY_LINUX.md)。使用额度受登录方式及计划限制，不能视为无限免费调用。

## 数据与安全原则

- 每条新闻保留 **原文链接、来源、事件时间（若已知）、抓取时间**，区分事实、观点和未经证实的信息。
- 不伪造高赞评论、点赞数、来源或新闻时间；无法验证时明确说明。
- 新闻摘要以可追溯来源为基础；不把 AI 输出当作未经核对的事实。
- 不在仓库提交凭据、OAuth Token、浏览器 Cookie、数据库运行文件和本地日志。
- 不把 App Server 的通信端口直接暴露到公网；后台需要认证，危险操作遵循最小权限。
- 发布站点与本地管理后台分离，默认仅公开已生成的阅读内容。

## 参与与反馈

欢迎通过 [Issues](https://github.com/SwartzMss/ai-news-hub/issues) 反馈问题或提出功能建议。当前以完成 v0.1 最小可用闭环为优先目标。

## 参考资料

- [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
- [OpenAI Codex](https://github.com/openai/codex)

## License

**待确定。** 尚未添加许可证；在选定明确的开源协议前，不应假定本仓库已授予额外的复制、修改或分发权限。

## UI 交互原型（设计预览）

已提交 **混合风格 UI Prototype 0.1**，包含新闻门户首页、RSS 阅读器式频道页、AI 深度文章详情、历史归档、搜索、收藏、RSS 入口及本地任务控制台（模拟）。

- [打开原型源文件](prototype/index.html)（下载后使用现代浏览器打开；与服务端 Linux 平台无关）
- [原型使用说明](prototype/README.md)
- [前端交互与设计规范](docs/UI_DESIGN_SPEC.md)

**注意**：这是独立 HTML 演示，不含真实新闻、RSS、Codex、SQLite 或生产后台。正式前端仍需按路线图开发。
