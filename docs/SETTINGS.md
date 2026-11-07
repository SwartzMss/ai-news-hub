# 后台设置与管理员初始化

应用环境文件只保留三个启动参数：

```dotenv
AI_NEWS_HUB_HOST=127.0.0.1
AI_NEWS_HUB_PORT=3000
AI_NEWS_HUB_DATA_DIR=/var/lib/ai-news-hub
```

HOST 仅允许 127.0.0.1 / ::1；端口 1–65535；数据目录须为当前非 root 服务用户拥有的绝对路径，权限 0700。改变这三项需要重启。默认值如上；本地开发应使用自己有权限的仓库外目录。

## 首次使用

1. 构建并启动 Backend，打开 `/admin/`。后台未初始化时，业务 API 返回 503 management_disabled。
2. 页面只有“设置密码”和“确认密码”，填写至少 12 字符的密码，两次一致后提交。
3. 页面自动获取并提交本次启动的初始化校验，成功后进入后台；不需要初始密码、终端操作或手动复制初始化码。
4. 在“系统设置”保存 Codex 与 GitHub 配置；不再维护其他应用环境变量。

单管理员模式，不需要创建用户名。密码用带随机盐的 scrypt 哈希保存，不能读回。登录返回 12 小时临时 Bearer 会话，浏览器仅保留在页面内存；刷新重新登录，退出撤销当前会话，改密码会使其他会话及旧 Token 全部失效。认证入口限制本机 Host/同源访问，初始化校验仅在未设置管理员时向本机页面提供；重启换新、成功后失效，并发请求只能一个完成初始化。此流程允许能访问本机服务的用户首次设置，不校验其 Linux 账户身份；服务仍只绑定回环。初始化/登录/密码更新总计每进程每分钟最多 5 次尝试。

## 可保存的设置

| 设置 | 默认值 / 范围 |
| --- | --- |
| Codex 可执行文件 | codex；可设置服务账户可执行的实际路径 |
| 模型 | 空，沿用 Codex 当前配置 |
| 每轮总超时 | 默认 10 分钟；页面按分钟输入（可小数），API/数据库仍使用毫秒，范围 1000–3600000 ms |
| 并发 | 1；1–4，不取消同任务互斥 |
| 等待队列 | 20；1–100 |
| 日志级别 | 固定 info，不在管理页面配置；旧 API 字段保留兼容 |
| GitHub 归档 | 默认关闭；启用需仓库、预先存在的分支和 Token |
| 管理员密码 | 登录后可修改，旧 Token 迁移用户也可改设密码 |

任务或归档执行/排队中拒绝保存设置，返回 settings_busy，不中途替换正在使用的模型、超时或发布目标。空闲时保存立即生效，无需重启；修改 IP/端口/数据目录仍需改启动配置。页面通过 revision 检测其他窗口的更新，冲突时重新进入设置页核对。

Codex 账户登录、HOME/CODEX_HOME、系统 PATH、代理/CA 与 systemd 运行身份仍由主机管理，Web 不接收或存储 Codex OAuth 文件，也不替代操作系统部署。独立 codex-probe 诊断工具的专用环境文件保持独立，不是业务 Backend 配置。

## GitHub Token

Token 在 SQLite 中以 AES-256-GCM 加密，密钥由 Backend 自动生成于 `DATA_DIR/settings.key`（0600），不需要额外环境变量。读取 API 只返回 tokenConfigured，不能回显原值；输入框留空保留原 Token，填写新值替换，勾选清除显式删除。禁用归档可保留配置，清除 Token 后不能继续启用。

配置只改变归档目标/认证，不批准或发布报告；人工审核与发布操作仍独立。不要把 Token、密钥或数据库提交 Git，也不要把它们放入 VITE 构建变量。更换目标产生独立归档身份，历史保留，轮换 Token 不改变归档身份。

## API

| 路径 | 认证 / 语义 |
| --- | --- |
| GET /api/auth/status | 本机同源；initialized/mode，未初始化时额外返回 setupToken，由页面自动使用 |
| POST /api/auth/setup | 自动的 setupToken + password；仅首次，成功 201，返回 token/expiresAt |
| POST /api/auth/login | password 字段；旧迁移模式传原 Token；返回临时会话 |
| POST /api/auth/logout | Bearer；空对象，撤销当前会话 |
| POST /api/auth/password | Bearer；currentPassword/newPassword，返回替换会话 |
| GET /api/settings | Bearer；revision、Codex、执行、日志及无密钥的 GitHub 元数据 |
| PUT /api/settings | Bearer；完整设置 + 当前 revision，成功返回新视图 |

PUT 的 GitHub 对象含 enabled/repository/branch，可选 token 或 clearToken，不能同时提交。读取视图中的 tokenConfigured 仅为只读字段，不能原样放入 PUT。新增配置字段须显式更新严格 Schema，不接受任意配置键或命令参数。

## 旧版本升级与备份

迁移 6 只追加 app_settings/admin_credentials/admin_sessions，不修改迁移 1–5。对应数据库记录缺失时，旧应用环境变量校验后一次性导入；已有数据库配置/管理员凭据后忽略相应旧变量，包括无效残留值，不覆盖 Web 修改。

旧管理 Token 仅保存哈希，可继续兼容已有 Bearer API，也可在旧 Token 登录页换取临时会话。建议在系统设置改设密码，旧 Token 随即失效；后续即使环境中仍残留该 Token 也不会重新启用。迁移后可将旧应用变量全部删除，只保留三个启动参数。

备份应停止 Backend 后保存整个私有数据目录，至少包含一致的 SQLite 和 settings.key；同机权限须保持。不应只备份 DB 而丢失密钥。有加密凭据时缺少/错误密钥将拒绝启动，不自动创建新密钥或丢弃旧数据。恢复时不删除数据库规避错误。当前不提供匿名密码重置或多用户管理，密码与本机恢复资料需妥善保管。

本次自动化、浏览器及独立审查证据见 [设置验证](validation/SETTINGS.md)。

旧版本 setup-code 文件不再生成或接受为初始化凭据；升级无需删除数据库或重设已有密码。未初始化实例在新页面完成设置后会清理该旧文件。

GitHub 归档不再设全局启用开关：仓库、分支和已保存 Token 完整即为可用；允许保存未完整配置，清除凭据后恢复未配置。旧 `github.enabled` 写入参数为可选兼容字段且被忽略，返回值表示派生配置状态，旧数据库中的 false 不再禁用完整目标。任务 `autoPublish` 继续独立控制自动归档。建议创建 fine-grained PAT，仅选择归档仓库并授予 Contents read/write；后台不展示已保存 Token。

GitHub Token 使用始终可见的空白密码输入框，移除说明段落及设置/更换按钮、清除复选框；保存时留空保留已存 Token，输入新值替换，成功保存后再次清空输入框，不回显凭据。
