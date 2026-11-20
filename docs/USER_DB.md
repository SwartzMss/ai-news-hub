# 公共用户 D1 数据库

Issue [#157](https://github.com/SwartzMss/ai-news-hub/issues/157) 只建立用户数据基础设施。公共站仍由 Cloudflare Pages 静态构建；本阶段没有注册、登录、Session 或收藏 API，也不启用用户邮件发送。

## 数据与迁移边界

`USER_DB` 是独立 D1，生产库建议名为 `ai-news-hub-users`，预览库建议名为 `ai-news-hub-users-preview`。迁移仅在 `users/migrations/`，从 `0001.sql` 起追加；#159 的 `0002.sql` 增加 Session 闲置时间、Token 消费标识和限流表。已应用文件不可改写。`users` 保存规范化邮箱、密码哈希、验证时间及状态；`auth_sessions` 和 `auth_email_tokens` 只保存不透明令牌的哈希。时间字段为 Unix 毫秒。所有写入端须在后续认证实现中完成邮箱规范化、密码哈希和令牌哈希；数据库约束只是最后一道防线。D1 备份也按私有用户数据处理。

现有 `NEWSLETTER_DB` 仍只保存订阅者、确认、日报快照与发送记录，并继续使用 `newsletter/migrations/`。两个库没有跨库外键，也不迁移或合并历史。Linux Backend SQLite、GitHub 日报归档和公开站构建产物均不保存用户账户。认证邮件后续可以共用 Resend 服务与已验证域名，但认证配置和密钥须独立于 `NEWSLETTER_ENABLED`、`NEWSLETTER_TOKEN_SECRET`、`NEWSLETTER_SEND_SECRET`。

## 创建与配置

在仓库根目录登录 Cloudflare，并创建两个**不同**的 D1 数据库：

```bash
npx wrangler login
npx wrangler d1 create ai-news-hub-users
npx wrangler d1 create ai-news-hub-users-preview
```

复制 `deploy/newsletter/wrangler.toml.example` 为本地 `wrangler.toml`，填入现有 Newsletter 生产库 ID、新建用户生产库 ID 和用户预览库 ID。该文件被 Git 忽略，不提交真实 ID 或凭据。若已有 `wrangler.toml`，仅合并 `USER_DB` 的生产与预览条目，保留现有 Newsletter 生产配置；部署前核对当前 Pages 项目配置，因为 Wrangler 文件一旦用于 Pages 部署就会成为配置来源。生产环境的 `USER_DB` 必须指向 `ai-news-hub-users`，`env.preview` 中的 `USER_DB` 必须指向 `ai-news-hub-users-preview`。预览的 D1 列表不含生产 `NEWSLETTER_DB`。生产部署前在 Pages 设置中确认两个生产 Binding，预览部署前确认预览仅有预览用户库；如果使用 Dashboard 管理 Binding，按相同映射设置并重新部署。

## 应用和核验迁移

先分别迁移预览和生产库，再部署会使用该库的 Pages Functions。命令始终写**数据库名**，避免把 `USER_DB` 绑定名误解析到另一环境：

升级到认证加固版时，已有 `0001.sql` 的数据库只执行新增的 `0002.sql`；升级到收藏版时，再执行新增的 `0003.sql`。若使用 Cloudflare D1 控制台手动执行，打开目标**用户库**的 Console，按顺序复制并执行尚未应用的迁移文件全部内容；先核对库名，生产与预览分别执行，不能对 Newsletter 库运行。每个文件只执行一次。手动执行不会生成 Wrangler 的迁移记录，之后再改用 `wrangler d1 migrations apply` 前应先核对 `d1_migrations`，避免重复执行。

```bash
npx wrangler d1 migrations list ai-news-hub-users-preview --env preview --remote
npx wrangler d1 migrations apply ai-news-hub-users-preview --env preview --remote
npx wrangler d1 migrations list ai-news-hub-users --remote
npx wrangler d1 migrations apply ai-news-hub-users --remote
```

分别查询 `sqlite_master` 和 `d1_migrations`，核对 `users`、`auth_sessions`、`auth_email_tokens` 与 `0001.sql`，并确认两个库的 ID 不同：

```bash
npx wrangler d1 execute ai-news-hub-users-preview --env preview --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
npx wrangler d1 execute ai-news-hub-users --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
```

本地开发必须使用 `--local`，**不要**加 `--remote`；Wrangler 默认把 D1 写入本地存储。不同本地测试可用不同 `--persist-to` 目录隔离，例如：

```bash
npx wrangler d1 migrations apply ai-news-hub-users --local --persist-to .wrangler/user-local
npx wrangler d1 execute ai-news-hub-users --local --persist-to .wrangler/user-local --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
```

仓库自动化测试使用独立内存 SQLite 执行同一迁移文件并验证约束，不连接 Cloudflare，也不访问生产数据。运行 `node --test tests/user-d1-migration.test.mjs`；`npm test` 同时运行原有 Newsletter 测试。

参考：[Pages 环境配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)、[Pages D1 Binding](https://developers.cloudflare.com/pages/functions/bindings/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
