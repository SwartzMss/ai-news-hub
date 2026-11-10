# AI News Hub

设置感兴趣的话题，让 Codex 每天搜索并整理资讯。你可以在后台查看结果、审核内容，也可以发布到 GitHub 并生成公开阅读网站。

## 架构一览

![动态架构图，展示 Prompt、Linux Backend、Codex、SQLite、GitHub、Cloudflare Pages、D1、Resend 与订阅者之间的数据流。](docs/assets/architecture.gif)

[查看 SVG 动画](docs/assets/architecture.svg) · [详细架构](docs/ARCHITECTURE.md)

Linux Backend 通过 stdio 驱动 Codex 研究，SQLite 保存任务与日报，批准后的 JSON 归档到 GitHub。Cloudflare Pages 构建公开网站和 RSS。GitHub Actions 定时触发每日汇总，Pages Functions 使用独立 D1 管理订阅状态，并通过 Resend 发送确认邮件和每日汇总。邮件投递需完成生产环境配置。

## 开始使用

准备 Linux 环境、Node.js 22.19.0 或更新的 22.x，以及已安装并登录的 Codex CLI。

### 1. 下载并安装

```bash
git clone https://github.com/SwartzMss/ai-news-hub.git
cd ai-news-hub
npm ci --ignore-scripts
cp .env.example .env
```

### 2. 设置保存目录

编辑 `.env`，把数据目录改成当前用户可写的绝对路径，例如：

```dotenv
AI_NEWS_HUB_HOST=127.0.0.1
AI_NEWS_HUB_PORT=3000
AI_NEWS_HUB_DATA_DIR=/home/你的用户名/.local/share/ai-news-hub
```

创建对应目录，并限制访问权限：

```bash
mkdir -p "$HOME/.local/share/ai-news-hub"
chmod 700 "$HOME/.local/share/ai-news-hub"
```

上面的目录应与 `.env` 中填写的路径一致。

### 按需配置代理

代理示例见 [`network.env.example`](network.env.example)。在项目根目录首次手动创建：

```bash
cp -n network.env.example network.env
chmod 600 network.env
```

用编辑器填写代理地址，大小写成对变量保持一致。已有 `network.env` 可直接编辑。服务安装器自动识别根目录中已存在的该文件，日常修改后执行 `sudo bash scripts/service.sh restart` 即可重新加载。

在已经配置 `.env` 的普通服务用户终端执行，读取当前用户的代理环境变量：

```bash
npm run network:configure
```

命令将 HTTP(S) 代理和本机绕过规则保存到项目根目录的 `network.env`，与 `.env` 并列，权限为 `0600`，重复执行会更新该文件。代理通过私有文件管理，模型、任务及 GitHub 业务设置仍在后台维护。

在项目根目录手动启动时指定配置文件：

```bash
npm start -- --network-env-file network.env
```

systemd 安装器默认识别项目根目录已有的 `network.env`。已有服务首次接入该文件时使用 `--replace` 重新安装一次，后续编辑后重启服务。自定义文件路径可用 `--extra-env-file /absolute/path/network.env`。GitHub HTTPS 归档客户端和 Codex 子进程均使用代理环境变量。代理服务须在开机后可用，配置步骤见 [Linux 部署指南](docs/DEPLOY_LINUX.md#代理网络配置)。

### 3. 启动

```bash
npm run build
npm start
```

打开 [管理后台](http://127.0.0.1:3000/admin/)，首次访问设置管理员密码。刷新页面后需要重新登录。

## 开机启动（可选）

在已安装依赖、配置 `.env` 并登录 Codex 的项目目录，以普通用户运行（先停止已有手动实例）：

```bash
bash scripts/service.sh start
```

`start` / `restart` 每次先自动编译 Backend 和 Admin，编译失败时退出，不安装、启动或重启服务。编译成功后检查 systemd 服务，未安装时使用当前用户的 Node / Codex 路径安装并启用开机启动，再启动后台；需要权限时自动调用 sudo。已有服务执行指定的启动或重启动作，不覆盖安装配置。开机自启直接运行已有构建，不执行编译。

```bash
bash scripts/service.sh status     # 查看状态
bash scripts/service.sh stop       # 停止，保留开机自启
bash scripts/service.sh restart    # 重启，未安装时先安装
bash scripts/service.sh uninstall  # 停止并卸载服务，取消开机自启
```

卸载保留项目、`.env`、`network.env`、SQLite、认证和日志；之后再次 `start` 会重新安装。也可使用 `npm run service:start` 等同名命令。自定义账号/路径及更新已有 unit 继续使用安装器，见 [Linux 部署指南](docs/DEPLOY_LINUX.md#源码目录安装开机启动服务)。

## 创建任务

进入“任务总览”，点击“新增任务”：

1. 填写任务主题，例如“每日开源项目”“每日 AI 动态”“每日热点观察”。
2. 填写 Prompt，说明关注范围、时间范围、条目数量和来源要求。
3. 设置执行计划。默认每天早上 **08:00，上海时区**，也可改为手动或其他时间。
4. 保存后，点击“立即运行”即可试跑。

一般使用一轮 Prompt 即可。需要先搜集再筛选时，可以添加多轮；系统按顺序执行，最后一轮生成日报。

例如“每日开源项目”的 Prompt：

> 搜索最近 24 小时值得关注的开源项目和重要版本更新，选择 5–8 条。优先引用官方仓库、Release 和维护者公告。每条说明项目用途、本次变化及使用价值，提供原文链接和支持摘要的原文短引文。用中文生成日报，不收录无关财报或股价消息，不为凑数加入旧新闻。

系统概览可查看任务总数、紧凑的近期执行趋势和待处理日报。

## 查看结果

进入“运行与结果”，选择一次执行：

- **最终结果**：阅读日报、检查来源并操作发布。
- **Prompt 与回复**：查看每轮要求、回复和可展开的原始内容。
- **诊断日志**：执行失败或超时时，查看运行信息和错误记录。

任务的编辑、立即运行、停止、定时启停和删除，在“任务总览”中操作。

“运行与结果”每条已结束的执行提供“删除记录”，确认后删除该 Run、对话、日志及研究快照；有关联日报时同步删除日报和 GitHub 归档，公开站与 RSS 随构建更新。任务配置保留，运行、排队或发布中的记录须完成或停止后操作。

## 发布到 GitHub

先进入“GitHub 归档”，填写仓库、分支和 Token。例如仓库填写 `SwartzMss/ai-news-hub`，分支填写 `main`。可以使用当前项目仓库，也可以使用独立归档仓库。

建议使用细粒度 Token，仅授权目标仓库，并开启 **Contents → Read and write**。已保存的 Token 不会显示，留空保存会保留原值。

- **手动发布**：查看最终结果，审核并批准后，再归档到 GitHub。
- **自动发布**：打开任务的“自动发布”开关，成功生成日报后自动归档到配置的仓库。

建议先试跑并查看结果，再决定是否开启自动发布。归档失败时，可在结果页面查看原因并重试，无需为重试归档重新执行研究。

## 公开阅读网站（可选）

在 Cloudflare Pages 中连接包含项目代码和已发布日报的仓库，设置：

| 设置 | 填写内容 |
| --- | --- |
| 生产分支 | 与归档目标一致，例如 `main` |
| 构建命令 | `npm run build:web` |
| 输出目录 | `dist/web` |
| 环境变量 `SITE_URL` | 你的网站地址，例如 `https://your-project.pages.dev` |
| 环境变量 `NODE_VERSION` | `22.19.0` |

完成 Git 自动部署配置后，新的归档提交会触发网站更新。每个任务首次归档后会成为独立话题，读者可以在电脑左侧或手机顶部切换话题、查看往期内容和订阅 RSS，浏览器会记住阅读偏好。

日报按全屏布局展示，简报页眉从日期开始，不重复显示话题名称或“最新一期”标签，并显示生成时间；可从本期目录跳转到对应资讯。点击资讯标题查看全文，点击来源打开原文。带官方仓库链接和可识别事实标签的开源项目详情按项目名、仓库、核心用途、技术要点、近期证据、适用场景、许可证及编辑判断分节阅读；宽屏项目详情页保留左侧话题导航，中间显示限宽正文，右侧提供本文目录和本期其他项目；窄屏隐藏右侧辅助栏，面包屑保留话题入口；旧归档仅展示已有事实，不补造技术信息。含结构化 details 的科技投资条目提供数据表、产业链影响、投资逻辑、风险和多来源证据分节；缺少 details 的旧条目仍使用原详情。其他资讯维持原详情布局。资讯详情页头的所属日报日期只在面包屑导航中显示，分类单独显示。原文发布时间等来源元数据位于“来源与引文”。

开源项目的分节详情依赖日报中的可核实标签；更新模板后，已保存任务需在后台重新选择模板并保存，历史归档不会自动补齐技术信息。

详细步骤见 [公共网站部署](docs/PUBLIC_WEB.md)。

## 订阅更新（可选）

- **RSS 订阅**：点击网站上的「RSS 订阅」，将链接添加到 RSS 阅读器，获取话题更新。
- **邮件订阅**：通过 Resend 发送。启用后，读者填写邮箱并确认，即可每天收到一封汇总全部话题的邮件，也可随时通过邮件退订。

邮件订阅默认关闭，需要自有发件域名；每日发送从北京时间 09:00 开始检查，配置缺失时工作流不会发信。启用及 GitHub 设置核对步骤见 [邮件订阅设置](docs/NEWSLETTER.md)。

## 日常使用

- 停止服务：在启动终端按 `Ctrl+C`。
- 再次启动：运行 `npm start`。
- 查看服务日志：运行 `tail -f logs/backend.log`。
- 更新代码后：停止服务，重新运行 `npm run build`，再启动。
- 开机启动与后台常驻：按 [Linux 部署指南](docs/DEPLOY_LINUX.md) 安装 systemd 服务。

更多操作见 [后台使用说明](docs/ADMIN.md)。
