# 公共用户生产上线与恢复

Issue [#163](https://github.com/SwartzMss/ai-news-hub/issues/163) 的操作清单。本仓库只交付代码与模板；Cloudflare 资源、密钥、真实邮件和恢复演练必须在目标账户实际验收。完成前保持 Production `AUTH_ENABLED=0`，Preview 未启用。不要把用户库、SQL 导出、墓碑、凭据、验证邮件或 Cookie 上传到 GitHub/Issue。

## 1. 资源和隔离

在 Cloudflare Dashboard → Workers & Pages → 目标 Pages 项目 → Settings 确认 Production 的 `USER_DB` 绑定生产 `ai-news-hub-users`，Preview 的 `USER_DB` 只绑定 `ai-news-hub-users-preview`。两库分别执行 `users/migrations/0001.sql` 到 `0004.sql`，每个文件仅一次；核对表与迁移记录，不能对 `NEWSLETTER_DB` 执行。若尚未打算验收 Preview，保持 Preview 认证关闭。创建两个**私有** R2 bucket，例如 `ai-news-hub-user-backup` 与 `ai-news-hub-user-backup-preview`；不要为其开启公共访问或自定义域名。在 Pages → Settings → Bindings → Production 添加 R2 bucket Binding，变量名严格为 `USER_BACKUP_BUCKET`，选择生产 bucket；Preview 绑定预览 bucket。保存后重新部署对应环境。使用 Wrangler 管理 Pages 配置时，参考 `deploy/newsletter/wrangler.toml.example` 并核对配置来源，避免 Dashboard 中的绑定被文件覆盖。

分别设置认证变量与 Secret，逐项见 [AUTH.md](AUTH.md)。生产 `AUTH_SITE_URL` 必须是最终 HTTPS 站点 origin；`SITE_URL` 与邮件链接/页面域名一致。确认 Cloudflare Pages 的域名、TLS 和部署成功后再验收 Cookie 与重定向。Turnstile 站点限制为对应环境主机名。Resend 发件域名必须已经完成 DNS 验证；用自有邮箱检查验证/找回邮件的发件人、链接和交付状态。域名服务商只需完成所用域名的 DNS/邮件验证记录；不要改无关记录。

## 2. 私有备份和保留

D1 Time Travel 可作为短期回退，但它会原地恢复，且保留窗口由 Cloudflare 计划决定；另设独立 SQL 备份。`deploy/user-backup/` 是单独的 Cloudflare Worker/Workflow，不能作为 Pages 项目部署。复制 `wrangler.toml.example` 到该目录内的私有 `wrangler.toml`，填入生产账户 ID、用户 D1 ID 和私有 R2 bucket 名。创建只允许目标 D1 导出的最小权限 Cloudflare API Token，作为 Worker Secret `D1_EXPORT_TOKEN` 保存；不要放入 `[vars]` 或 Git。模板的 Workflow 每天 18:00 UTC 导出生产 D1 到 `backups/YYYY-MM-DD/`，Worker 每小时清理过期 Session、邮件 Token 和限流记录。首次部署后检查 Workflow 执行成功、R2 对象大小非零和错误日志；手工触发一次备份并验证可下载 SQL 后才依赖定时备份。导出期间 D1 可能短暂不可查询，故安排低流量时段并监控错误率。

在 R2 bucket 的 Settings → Object lifecycle 设置前缀规则：`backups/` 在 30 天后删除；`tombstones/` 至少保留 90 天，并且**长于所有可恢复备份和 D1 Time Travel 窗口**。不要让全 bucket 的短期规则先删除墓碑。Cloudflare 对 R2 静态数据加密、传输使用 TLS；只有受限维护人员能读取备份 bucket、D1、Worker Secret。API Token 定期轮换，轮换后验证下一次导出。预览 bucket 单独配置保留规则。账号注销先写 `tombstones/<userId>.json` 再删 D1 用户；墓碑写入失败会阻止注销。历史备份中的个人数据到期自动删除，墓碑用于恢复时剔除已注销账户。

## 3. 隔离恢复演练

至少每次上线前和备份策略变更后做一次演练。先把 `AUTH_ENABLED` 设为 `0` 并重新部署，确认 `/api/auth/me` 返回 503；真实恢复期间始终保持关闭。选取最近一次成功 SQL 备份，下载到受限的本地目录（文件权限 0600）。从私有 R2 列出并下载**所有** `tombstones/` 对象，记录数量与最后时间，确认列表完整、没有分页遗漏；不要只取与备份日期同一天的墓碑。使用 `node scripts/prepare-user-restore.mjs --backup /private/backup.sql --tombstones /private/tombstones --output /private/restore.sql` 生成恢复 SQL。脚本在导出后追加已注销用户的删除语句；临时文件与下载目录不得同步到 Git/公开位置。

创建全新隔离 D1 库，**不要对生产库做原地试验**。按 Cloudflare D1 导入流程将 `restore.sql` 导入隔离库；不要把大量 SQL 粘贴到 Dashboard Console。核对 `users`、`favorites`、`favorite_categories`、`auth_sessions`、`auth_email_tokens` 的计数、外键完整性、至少一个已注销 ID 不存在、导入完成时间与备份时间。恢复的 Session/Token 仅用于离线核对，不给隔离库配置公开 Pages Binding。演练完成删除隔离库和本地明文副本，记录日期、备份对象键、结果和操作者，不记录个人数据。若要真正恢复生产，先记录故障前状态、备份现有库，再按同一隔离流程核对，切换生产 Binding 并确认注销墓碑已应用后，才可重新开启认证。无法证明墓碑完整时保持认证关闭。

## 4. 验收、监控和回滚

以自有测试邮箱验证注册、验证、登录、`me`、改密、找回、退出、收藏/分类、数据导出和注销；导出文件应只有该账户资料，注销后旧 Cookie 必须失效且用户与级联数据不存在。检查 Pages Function 错误率、D1 查询/容量、Worker/Workflow 失败、R2 备份间隔和 Resend 投递。备份失败或超过 36 小时无成功备份应告警；真实告警渠道由运营侧配置并演练。对日志和监控隐藏密码、Token、Cookie、完整邮件地址、用户导出、SQL 和墓碑内容。

任何认证故障或恢复不确定时，将 Production `AUTH_ENABLED=0`、保存并重新部署；`/api/auth/me` 应返回 503，Newsletter 与静态新闻仍可独立运行。修复后重复登录、邮件、收藏、导出、注销和备份验收，才重新设为 `1`。生产开启之前发布并核对 [用户隐私说明草稿](USER_PRIVACY.md)的实际运营主体、联系邮箱与保留期限。代码合并或本地测试通过不代表上述 Cloudflare 验收已经完成。

参考：[Pages R2 Binding](https://developers.cloudflare.com/pages/functions/bindings/)、[D1 导出 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)、[D1 导入 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/)、[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[R2 对象生命周期](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)。
