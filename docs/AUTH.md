# 公共用户认证

Issue [#158](https://github.com/SwartzMss/ai-news-hub/issues/158) 在 Pages Functions 的 `/api/auth/*` 实现邮箱密码注册、邮箱验证、登录、当前用户和退出；Issue [#159](https://github.com/SwartzMss/ai-news-hub/issues/159) 追加密码重置、Turnstile、限流与 Session 闲置过期；[#162](https://github.com/SwartzMss/ai-news-hub/issues/162) 加入账户与收藏前端。数据仅写 `USER_DB`，依次使用 [用户 D1 迁移](USER_DB.md)的 `0001.sql`、`0002.sql`。认证默认关闭，合并代码不会自动开放注册。

## Pages 配置

启用认证的 Pages 环境必须绑定对应的 `USER_DB`；若同时使用 Production 与 Preview，两个环境必须使用不同数据库。除已存在的 `RESEND_API_KEY` Secret 外，分别设置以下服务端变量，**不要**使用 `VITE_*` 或提交到 Git：

| 变量 | 用途 |
| --- | --- |
| `AUTH_ENABLED` | 仅明确设为 `1` 时启用；配置与测试完成前保持未设置 |
| `AUTH_SITE_URL` | 当前环境的稳定 HTTPS origin，不能带路径、查询或凭据；用于校验请求 Host 与邮件链接 |
| `AUTH_FROM` | Resend 已验证域名下的发件地址，可与 Newsletter 使用相同地址，但单独配置 |
| `RESEND_API_KEY` | 现有 Resend Secret；认证与 Newsletter 共用传输服务，不共用业务开关或 Token Secret |
| `AUTH_TURNSTILE_SITE_KEY` | Turnstile 公开 Site Key，文本变量；注册/找回页面从 `/api/auth/config` 获取 |
| `AUTH_TURNSTILE_SECRET` | Turnstile Secret Key，必须使用 Cloudflare Secret，绝不放入前端或 Git |
| `AUTH_RATE_LIMIT_SECRET` | 至少 32 字符的随机密钥，用于限流键和注册验证码的 HMAC；必须使用 Cloudflare Secret，轮换后未使用的验证码会失效 |

Preview 的 `AUTH_SITE_URL` 必须是实际预览域名且使用预览 `USER_DB`；若没有稳定的预览域名，保持 Preview 的 `AUTH_ENABLED` 未设置。生产 `AUTH_SITE_URL` 指向生产站点。代码可以在认证关闭时先部署；启用任一环境的认证前，必须先在该环境用户 D1 应用 `0002.sql`。Turnstile Widget 只允许对应环境的站点主机名，并按 `register`、`forgot_password`、`login` 设置 action；Siteverify 返回的 hostname/action 必须匹配。`/api/auth/register` 和 `/api/auth/forgot-password` 还要求 `AUTH_FROM` 与 `RESEND_API_KEY`；登录、`me` 和退出在邮件配置缺失时仍可使用。页面部署后，在 Cloudflare 中保存变量/Secret 并重新部署才会生效。没有 `AUTH_RATE_LIMIT_SECRET` 或可信 `CF-Connecting-IP` 时，受限认证请求返回 503。

建议先在隔离 Preview 用自有邮箱验收；若暂不配置 Preview，则保持 Preview 认证关闭，并在生产受控测试后决定是否长期开放：输入邮箱并完成 Turnstile 后收到 6 位验证码，在同一注册页输入验证码并设置密码，随后登录、检查 `me` 和退出。核对 60 秒重发间隔、10 分钟到期、Cloudflare Workers CPU/错误日志及 Resend 投递情况。**不要**把密码、验证码、重置链接、Cookie、API Key 或完整请求日志发到 Issue。Newsletter 的 `NEWSLETTER_ENABLED` 保持独立；不需要改 Newsletter D1 或密钥。改用验证码无需新增 Pages 变量、Binding、DNS 或 D1 迁移，只需部署新的 Pages 代码。

## 接口与数据边界

| 路径 | 方法 | 结果 |
| --- | --- | --- |
| `/api/auth/register` | POST JSON `{email,turnstileToken}` | 202 统一提示；可注册邮箱发送 6 位验证码，10 分钟有效，同一未验证邮箱至少间隔 60 秒才重发 |
| `/api/auth/verify-email-code` | POST JSON `{email,code,password}` | 校验最新验证码并一次性激活账户，将密码哈希写入 D1；错误/过期码返回 400 |
| `/api/auth/verify-email?token=...` | GET | 只兼容部署前已发出的 24 小时验证链接，不再由新注册邮件生成 |
| `/api/auth/verify-email` | POST JSON 或表单 `{token,password}` | 只兼容旧验证链接，消费后由邮箱持有人设置密码 |
| `/api/auth/login` | POST JSON `{email,password,turnstileToken?}` | 200 最小用户资料，设置 `__Host-anh_session` Cookie |
| `/api/auth/me` | GET | 200 当前用户最小资料；无效/过期/撤销会话返回 401 |
| `/api/auth/logout` | POST | 撤销当前 Session，204 并清除 Cookie |
| `/api/auth/config` | GET | 仅返回公开 Turnstile Site Key，不返回 Secret |
| `/api/auth/forgot-password` | POST JSON `{email,turnstileToken}` | 202 统一提示；有效账户发送 30 分钟重置链接 |
| `/api/auth/reset-password?token=...` | GET | 仅展示设置新密码表单，不修改密码 |
| `/api/auth/reset-password` | POST JSON 或表单 `{token,password}` | 一次性消费重置 Token，更新密码并撤销该用户全部 Session |
| `/api/auth/change-password` | POST JSON `{currentPassword,newPassword}` | 必须有有效 Session 并验证当前密码；更新后撤销全部 Session |
| `/api/auth/export-data` | POST JSON `{password}`，后续页提交返回的 `cursor`、`exportedAt`、`exportToken` | 有效 Session、同源请求和当前密码；按页读取该账户资料、收藏快照及分类，前端合成下载文件，不含凭据/令牌 |

当前版本暂不提供账户注销接口；认证启用时 `POST /api/auth/delete-account` 返回 404，认证关闭时统一返回 503。数据导出仍可用。生产开放注册前须确定账户删除途径与数据保留政策，见 [用户生产验收](USER_PRODUCTION.md)。

请求体上限 4096 字节；所有写入接口拒绝额外字段，密码为 12–128 个字符且最多 256 UTF-8 字节。第一步只提交邮箱，D1 中未验证用户的密码字段写入不可登录的占位值；第二步凭最新验证码设置最终密码，避免他人提前注册该邮箱后让邮箱持有人激活攻击者密码。验证码只在邮件中出现，数据库仅存储以现有 Secret、用户 ID、令牌 ID 和验证码计算的 HMAC，不保存明文或可离线枚举的普通 SHA-256。所有 POST 要求 `Origin` 与 `AUTH_SITE_URL` 完全相同；所有路由要求请求 URL 的 origin 与配置一致；Fetch Metadata 拒绝跨站 API 子资源请求，但允许从邮件跨站导航到旧验证/重置 GET 页面。Cookie 使用 `HttpOnly; Secure; SameSite=Lax; Path=/`，无 `Domain` 属性，Session 绝对有效期 30 天、服务端闲置有效期 7 天；`me` 活动每隔至少 5 分钟刷新闲置时间。API 与确认页使用 `no-store`，确认页禁止外部资源与跨站表单。登录错误不区分账号不存在、密码错误、未验证或禁用；注册和找回密码对已存在/不存在邮箱返回相同 202。两类邮件请求通过 Pages `waitUntil` 在统一响应后处理发信；发信失败会释放验证码预约。验证码 10 分钟有效、最新一封生效，60 秒内同一邮箱不重发；重置链接 30 分钟有效，活跃链接期间不重发，过期后可重新申请。重置 Token 的消费标识还防止同一毫秒内重复提交改写密码。

### 滥用防护

注册和找回密码必须提交 Turnstile Token；服务端调用 Cloudflare Siteverify，验证 `success`、本站 hostname 与对应 action，并在用户 D1 记录令牌哈希，拒绝重复使用。登录在同一 IP 或邮箱 15 分钟内超过 6 次尝试时要求 action 为 `login` 的新挑战；即使密码正确也不能绕过。Siteverify Token 过期或失败需重新获取。Turnstile 校验前先限制 IP，成功后才计入注册/找回的邮箱额度，避免无效挑战耗尽他人的邮箱额度。具体 [Cloudflare 服务端验证规则](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)指出 Token 约 5 分钟有效且只能使用一次；本地 D1 去重补足短时间内的重放收敛窗口。

固定窗口限流保存在 `auth_rate_limits`，IP/邮箱键由 Secret 通过 HMAC 派生，Turnstile Token 另存 SHA-256 哈希；不保存原始 IP/邮箱/挑战 Token；仅信任 Cloudflare 的 `CF-Connecting-IP`，忽略客户端 `X-Forwarded-For`。注册：每 IP 10 次/小时、每邮箱 3 次/天，另有同邮箱 60 秒冷却；找回：每 IP 10 次/天、每邮箱 3 次/天；登录：每 IP 30 次/15 分钟、每邮箱 12 次/15 分钟；验证码验证：每 IP 30 次/小时、每封验证码 5 次/小时，重发后新验证码有独立次数；旧链接验证仍按 Token 限流；重置与改密各有 IP 与 Token/账户额度。邮件链接 GET 只计 IP，不耗尽一次性 Token 的提交额度。超限返回 429。过期窗口在请求过程中分批清理。以上规则降低滥用，但不能替代 Cloudflare 平台监控与实际流量验收。

数据库只保存已验证用户的密码派生值、Session Token 的 SHA-256 哈希、旧链接 Token 的 SHA-256 哈希及新验证码的 HMAC；明文随机 Token/验证码只发给浏览器或邮件，不入日志。邮箱由写入端规范化为小写，数据库再次约束唯一性。验证和 Session 查询始终从服务端记录查用户，忽略客户端提供的 `user_id`。

## 密码哈希选型与升级

Cloudflare Workers 生产运行时目前拒绝单次超过 100,000 次的 PBKDF2 调用（见 [workerd 限制记录](https://github.com/cloudflare/workerd/issues/1346)）。新密码哈希使用 WebCrypto `PBKDF2-HMAC-SHA256` 连续 6 轮、每轮 100,000 次；每个账户使用随机 16 字节盐，每轮在盐末尾附加轮次字节，并将上一轮 32 字节输出作为下一轮输入。存储格式为 `$pbkdf2-sha256-chain$r=6,i=100000$<salt>$<derived>`。这保持了每次猜测需完成 600,000 次 PBKDF2 迭代的成本，但**不是**单次 600,000 次的标准 PBKDF2，不能将其称为直接符合 [OWASP 对 PBKDF2-HMAC-SHA256 的参数建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。不能用普通 SHA-256 替代密码哈希。

验证器仍接受旧的单次 600,000–1,200,000 次 `$pbkdf2-sha256` 哈希；遇到 Workers 的上限错误时使用 `@noble/hashes` 计算同一标准 PBKDF2 值。旧哈希验证比新格式更耗 CPU。当前没有登录后自动升级逻辑，也未在真实 Cloudflare CPU 限额下完成性能验收。Cloudflare [Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)列出的 Free CPU 限额为 10 ms；多轮密码派生很可能超过此限额，因此**合入代码和重新部署不等于生产注册已修复**。启用认证前须在目标计划实测注册、验证邮箱、登录、重置密码和旧账户登录；若 CPU 超限，须使用能承载该成本的计划，不能降低密码参数。该修复不需要 D1 迁移或新增 Pages 变量。

## 本地验证

`npm test` 使用内存 SQLite 与假邮件传输执行真实 SQL/HTTP 处理路径；不调用 Cloudflare 或 Resend。可单独运行 `npm run build && node --test tests/auth-password.test.mjs tests/auth-routes.test.mjs`，其中密码测试模拟 Workers 的 100,000 次上限。真实发信、CPU 和 Cookie 的浏览器端验收仍需在配置完整的 Pages 环境进行。
