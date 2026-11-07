# 网站邮件订阅

读者在公共网站填写邮箱，点击确认邮件中的链接并确认后，开始订阅每日汇总。每封汇总包含配置的话题，并带退订链接。订阅、确认、退订与发送代码已实现；启用真实邮件需要配置 Cloudflare D1 和 Resend，代码合并不会自动开始发邮件。

## 1. 配置发件域名

在 Resend 添加你的发件域名或子域名，按提示添加 DNS 记录并完成验证，然后创建发送邮件的 API Key。发件地址例如 `AI News Hub <news@updates.example.com>`，不使用别人的邮箱或 `pages.dev` 作为发件域名。

官方步骤：[验证域名](https://resend.com/docs/dashboard/domains/introduction)。按实际订阅人数选择服务额度；确认邮件也占发送量。

## 2. 配置订阅数据库

在 Cloudflare 创建 D1 数据库，例如 `ai-news-hub-newsletter`。复制 `deploy/newsletter/wrangler.toml.example` 到仓库根目录 `wrangler.toml`，填入该数据库 ID；这是本地部署配置，不要提交。

在项目根目录用 Cloudflare Wrangler 登录并应用迁移：

```bash
npx wrangler login
npx wrangler d1 migrations apply ai-news-hub-newsletter --remote
```

在当前 Pages 项目的生产环境绑定该 D1 数据库，绑定名为 **`NEWSLETTER_DB`**。只放入订阅数据，不上传 Linux 后台的数据库。不要将生产 D1 或邮件密钥绑定到预览环境。

## 3. 设置 Pages 生产环境

| 变量 | 填写内容 |
| --- | --- |
| `SITE_URL` | 实际网站的稳定 HTTPS 地址，例如 `https://ai-news-hub-bxk.pages.dev`，不带路径 |
| `NEWSLETTER_FROM` | 已验证域名下的发件地址 |
| `NEWSLETTER_ENABLED` | 最后准备启用时设为 `1`；未设置时入口和接口关闭 |
| `NEWSLETTER_TOPIC_IDS` | 可选，逗号分隔的话题 ID；留空汇总全部已发布话题 |

将下面三项添加为 **Secrets**：

- `RESEND_API_KEY`：Resend API Key。
- `NEWSLETTER_TOKEN_SECRET`：至少 32 字符的随机值，用于签署退订链接。
- `NEWSLETTER_SEND_SECRET`：另一段至少 32 字符的随机值，仅用于定时发送。

可以在终端分别运行 `openssl rand -hex 32` 生成两段随机值。不要使用管理后台密码，也不要把密钥填入 `VITE_*`、公开页面或 Git。更换签名密钥会使旧退订链接失效，正常运行时请保留此密钥。

配置好后重新部署 Pages。页面顶栏会出现“邮件订阅”，点击后跳到页尾表单。未启用时现有阅读、RSS 和后台不受影响；演示站始终不显示表单。预览域名与 `SITE_URL` 不一致时接口拒绝操作。

订阅接口由仓库根目录的 Pages Functions 提供，构建输出仍为 `dist/web`。Pages 的 Functions 路由只处理 `/api/newsletter/*`，不连接私有管理后台。

## 4. 开启每日发送

在 GitHub 仓库的 Actions 设置中添加：

- Repository variable `NEWSLETTER_SITE_URL`：与 Pages 的 `SITE_URL` 一致。
- Repository secret `NEWSLETTER_SEND_SECRET`：与 Pages 中对应的 Secret 一致。

`Daily public newsletter` 工作流在北京时间 **09:30** 开始检查，每隔 15 分钟重试，至 **10:30**。GitHub 定时任务可能延迟，不保证精确到分钟；也可以从 Actions 手动运行。

发送前会等待所有目标话题都有当天的已发布日报。任何话题尚未更新时先等待，不把昨天的日报当今天发送。暂停某个话题后，如仍需发送其他话题，请相应调整 `NEWSLETTER_TOPIC_IDS`。当前三个话题 ID 可以从网站话题链接读取。

同一读者每天只创建一份汇总发送记录，重试使用原内容与原发送标识，不跟随当天后续修订重复发邮件。每次请求最多发送 8 封，工作流每次最多尝试 200 个收件人；更大规模需增加受控批次并匹配邮件服务额度。

## 5. 验证

1. 用你自己的邮箱在网站申请订阅。
2. 打开确认链接，点击“确认订阅”；仅打开链接不会激活，避免邮件扫描器误操作。
3. 当目标话题当天日报均已发布时，从 GitHub Actions 手动运行发送任务。
4. 检查邮件内容、完整日报链接和退订操作，再测试重复执行不会重复发当日汇总。

邮件服务返回接受不等于已进入收件箱；可在 Resend 查看实际投递情况。请先用自己的测试邮箱验收，不导入未经确认的地址。

申请订阅会显示统一提示，避免暴露某个邮箱是否已订阅。同一邮箱一小时内不会重复发送确认信，确认链接有效期 24 小时；超过次数后稍后再试。单个 IP 每小时最多允许五次有效申请，最多保存 5000 个订阅记录。确认发送失败时仍保留一小时冷却时间。

## 数据、失败与维护

D1 保存订阅邮箱、确认状态、确认令牌哈希、每日快照和发送记录，不写入 GitHub 日报或公共静态索引。只向已确认且未退订的读者发送；不把收件人列表放在 To/Cc 群发中。发送密钥只保存在服务端，日志不输出邮箱、令牌或服务商响应原文。

网络结果不确定时，保留原邮件内容和服务商幂等键重试。超过保守的 23 小时重试窗口后标为 `uncertain`，不会盲目再发；在 D1 的 `newsletter_deliveries` 和 Resend 中人工核对。定时任务只输出无个人信息的发送计数。API/域名配置出错时，也可检查 Pages Functions 日志中的脱敏错误码。

D1 备份/导出含个人信息，应按私有数据处理。Linux 私有 Backend、Codex 和系统任务不需要读取订阅数据库或邮件密钥。

参考：[Pages Functions](https://developers.cloudflare.com/pages/functions/)、[D1 绑定](https://developers.cloudflare.com/pages/functions/bindings/)、[Resend 发信接口](https://resend.com/docs/api-reference/emails/send-email)。

## 确认邮件未收到

先检查 Resend 的 Emails/Logs，再到 Pages 最新生产部署的 Functions 查看实时日志。数据库为 `pending` 只说明申请已保存，不代表邮件发送成功。日志中的 `newsletter_confirmation_failed` 包含脱敏错误码，不需要复制 API Key 或完整请求头。

Cloudflare Workers 的 `fetch` 不支持 `redirect: error`，此前会在请求 Resend 前抛错并记录 `mail_unavailable`。发信与公共日报索引请求现使用 `manual` 并拒绝非 2xx 响应，保持禁止跟随重定向。重新部署修复后，等待同一邮箱的一小时冷却结束再重试；需要立即测试时，仅针对自己的未确认订阅清空 `confirmation_sent_at`，不要将状态手工改为 `active`。
