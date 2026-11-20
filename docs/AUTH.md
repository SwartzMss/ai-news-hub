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
| `AUTH_RATE_LIMIT_SECRET` | 至少 32 字符的随机密钥，用于按 IP/邮箱生成不可逆限流键；必须使用 Cloudflare Secret |

Preview 的 `AUTH_SITE_URL` 必须是实际预览域名且使用预览 `USER_DB`；若没有稳定的预览域名，保持 Preview 的 `AUTH_ENABLED` 未设置。生产 `AUTH_SITE_URL` 指向生产站点。代码可以在认证关闭时先部署；启用任一环境的认证前，必须先在该环境用户 D1 应用 `0002.sql`。Turnstile Widget 只允许对应环境的站点主机名，并按 `register`、`forgot_password`、`login` 设置 action；Siteverify 返回的 hostname/action 必须匹配。`/api/auth/register` 和 `/api/auth/forgot-password` 还要求 `AUTH_FROM` 与 `RESEND_API_KEY`；登录、`me` 和退出在邮件配置缺失时仍可使用。页面部署后，在 Cloudflare 中保存变量/Secret 并重新部署才会生效。没有 `AUTH_RATE_LIMIT_SECRET` 或可信 `CF-Connecting-IP` 时，受限认证请求返回 503。

建议先在隔离 Preview 用自有邮箱验收；若暂不配置 Preview，则保持 Preview 认证关闭，并在生产受控测试后决定是否长期开放：注册返回统一 202、收到验证邮件、GET 只展示确认页、在确认页设置最终密码并 POST 验证、登录设置 Cookie、`me` 返回最小用户资料、退出后旧 Cookie 失效。再核对 Cloudflare Workers CPU/错误日志和 Resend 投递情况，确认生产计划后才设 Production `AUTH_ENABLED=1`。**不要**把密码、验证链接、Cookie、API Key 或完整请求日志发到 Issue。Newsletter 的 `NEWSLETTER_ENABLED` 保持独立；不需要改 Newsletter D1 或密钥。

## 接口与数据边界

| 路径 | 方法 | 结果 |
| --- | --- | --- |
| `/api/auth/register` | POST JSON `{email,password,turnstileToken}` | 202 统一提示；新账户发送 24 小时验证链接，同一未验证邮箱一小时内不重发 |
| `/api/auth/verify-email?token=...` | GET | 仅展示设置密码和邮箱确认表单，不改变账户状态 |
| `/api/auth/verify-email` | POST JSON 或表单 `{token,password}` | 一次性消费验证 Token，以邮箱持有人设置的密码替换临时密码，并更新验证时间 |
| `/api/auth/login` | POST JSON `{email,password,turnstileToken?}` | 200 最小用户资料，设置 `__Host-anh_session` Cookie |
| `/api/auth/me` | GET | 200 当前用户最小资料；无效/过期/撤销会话返回 401 |
| `/api/auth/logout` | POST | 撤销当前 Session，204 并清除 Cookie |
| `/api/auth/config` | GET | 仅返回公开 Turnstile Site Key，不返回 Secret |
| `/api/auth/forgot-password` | POST JSON `{email,turnstileToken}` | 202 统一提示；有效账户发送 30 分钟重置链接 |
| `/api/auth/reset-password?token=...` | GET | 仅展示设置新密码表单，不修改密码 |
| `/api/auth/reset-password` | POST JSON 或表单 `{token,password}` | 一次性消费重置 Token，更新密码并撤销该用户全部 Session |
| `/api/auth/change-password` | POST JSON `{currentPassword,newPassword}` | 必须有有效 Session 并验证当前密码；更新后撤销全部 Session |

请求体上限 4096 字节；所有写入接口拒绝额外字段，密码为 12–128 个字符且最多 256 UTF-8 字节。注册时的密码仅为待验证账户的临时密码；邮箱持有人须在验证页再次设置最终密码，避免他人提前注册该邮箱后借验证邮件激活攻击者密码。所有 POST 要求 `Origin` 与 `AUTH_SITE_URL` 完全相同；所有路由要求请求 URL 的 origin 与配置一致；Fetch Metadata 拒绝跨站 API 子资源请求，但允许从邮件跨站导航到验证/重置 GET 页面。Cookie 使用 `HttpOnly; Secure; SameSite=Lax; Path=/`，无 `Domain` 属性，Session 绝对有效期 30 天、服务端闲置有效期 7 天；`me` 活动每隔至少 5 分钟刷新闲置时间。API 与确认页使用 `no-store`，确认页禁止外部资源与跨站表单。登录错误不区分账号不存在、密码错误、未验证或禁用；注册和找回密码对已存在/不存在邮箱返回相同 202。两类邮件请求都对任何邮箱执行令牌哈希与预约查询，并通过 Pages `waitUntil` 在统一响应后处理发信；发信失败会释放令牌预约。邮箱验证链接 24 小时有效且设置 1 小时重发冷却；重置链接 30 分钟有效，活跃链接期间不重发，过期后可重新申请。重置 Token 的消费标识还防止同一毫秒内重复提交改写密码。

### 滥用防护

注册和找回密码必须提交 Turnstile Token；服务端调用 Cloudflare Siteverify，验证 `success`、本站 hostname 与对应 action，并在用户 D1 记录令牌哈希，拒绝重复使用。登录在同一 IP 或邮箱 15 分钟内超过 6 次尝试时要求 action 为 `login` 的新挑战；即使密码正确也不能绕过。Siteverify Token 过期或失败需重新获取。Turnstile 校验前先限制 IP，成功后才计入注册/找回的邮箱额度，避免无效挑战耗尽他人的邮箱额度。具体 [Cloudflare 服务端验证规则](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)指出 Token 约 5 分钟有效且只能使用一次；本地 D1 去重补足短时间内的重放收敛窗口。

固定窗口限流保存在 `auth_rate_limits`，IP/邮箱键由 Secret 通过 HMAC 派生，Turnstile Token 另存 SHA-256 哈希；不保存原始 IP/邮箱/挑战 Token；仅信任 Cloudflare 的 `CF-Connecting-IP`，忽略客户端 `X-Forwarded-For`。注册：每 IP 10 次/小时、每邮箱 3 次/天；找回：每 IP 10 次/天、每邮箱 3 次/天；登录：每 IP 30 次/15 分钟、每邮箱 12 次/15 分钟；验证：每 IP 30 次/小时、每 Token POST 5 次/小时；重置与改密各有 IP 与 Token/账户额度。邮件链接 GET 只计 IP，不耗尽一次性 Token 的提交额度。超限返回 429。过期窗口在请求过程中分批清理。以上规则降低滥用，但不能替代 Cloudflare 平台监控与实际流量验收。

数据库只保存密码派生值、Session Token 的 SHA-256 哈希和验证 Token 的 SHA-256 哈希；明文随机 Token 只发给浏览器或邮件，不入日志。邮箱由写入端规范化为小写，数据库再次约束唯一性。验证和 Session 查询始终从哈希查用户，忽略客户端提供的 `user_id`。

## 密码哈希选型与升级

目前使用 WebCrypto `PBKDF2-HMAC-SHA256`，每个账户独立随机 16 字节盐、600,000 次迭代和 32 字节输出，编码格式为 `$pbkdf2-sha256$i=600000$<salt>$<derived>`。Argon2id 是首选，但 [Cloudflare Workers 的原生 crypto 文档](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)明确不支持 `argon2`；引入 WASM Argon2 需额外验证 128 MiB isolate 内存和实际计划的 CPU 限额。本实现使用 Workers 已支持的 [WebCrypto PBKDF2](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)；600,000 次符合 [OWASP 密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。不能用普通 SHA-256 替代密码哈希。

哈希字符串自带算法与参数，未来提升成本或改用已验证的 Argon2id 时，验证器可按格式识别旧值，并在成功登录后重新派生写回新格式；更换算法前须同时支持旧格式直到完成升级。当前没有自动升级逻辑，也未在真实 Cloudflare CPU 限额下完成性能验收。Cloudflare 文档列出的 Workers Free CPU 限额为 10 ms，开启认证前必须在目标计划实际测量注册/登录是否可执行；若超限，应选择可承载该哈希成本的计划，不能降低到不安全参数。

## 本地验证

`npm test` 使用内存 SQLite 与假邮件传输执行真实 SQL/HTTP 处理路径；不调用 Cloudflare 或 Resend。可单独运行 `npm run build && node --test tests/auth-routes.test.mjs`。真实发信与 Cookie 的浏览器端验收仍需在配置完整的 Preview 上进行。
