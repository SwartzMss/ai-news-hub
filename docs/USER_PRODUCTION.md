# 公共用户生产验收（暂缓开放）

Issue [#163](https://github.com/SwartzMss/ai-news-hub/issues/163) 跟踪公共用户系统正式开放。当前仓库有账户、收藏、分类和数据导出代码，但按当前部署选择，**暂不提供账户注销，也不部署 R2 用户库备份**。生产 `AUTH_ENABLED` 保持 `0`；当前代码合并不代表生产验收完成。不要把用户 D1、SQL 导出、凭据、邮件链接或 Cookie 放入 GitHub、公开构建产物或 Issue。

## 当前可以核对的配置

在 Cloudflare Dashboard → Workers & Pages → Pages 项目 → Settings 核对 Production 的 `USER_DB` 指向生产 `ai-news-hub-users`。若启用 Preview，`USER_DB` 必须指向独立的 `ai-news-hub-users-preview`；若不验收 Preview，保持 Preview 认证关闭。两库各自核对 `users/migrations/0001.sql` 至 `0004.sql` 是否按顺序应用，每个迁移仅一次，不能对 `NEWSLETTER_DB` 执行。认证配置见 [AUTH.md](AUTH.md)；Production `AUTH_SITE_URL` 应为实际 HTTPS 站点 origin，Turnstile 主机名、Resend 发件域名/DNS 与该环境一致。不要因为代码已合并而把 `AUTH_ENABLED` 设为 `1`。

## 开放注册前尚需决定和完成

1. **备份与恢复**：D1 Time Travel 自动开启，但只能恢复有限时间内的数据。确定独立、受控的用户 D1 导出存储方案、执行周期、加密/访问权限、保留期限及清理规则。可以选择 R2 以外的私有存储；目前仓库没有自动导出服务。完成一次从备份恢复到**隔离 D1** 的演练，核对账户、Session、收藏、分类及外键，不在生产库上试验。
2. **删除政策**：当前没有注销 API 或页面入口。确定用户可行的删除请求渠道和身份核验方式，再实现/验收在线数据删除。若使用旧备份或 Time Travel 恢复，必须防止已删除账户重新出现；不能只依赖恢复前数据库中的删除记录。
3. **隐私说明**：核对 [隐私说明草稿](USER_PRIVACY.md)的实际运营主体、联系邮箱、数据处理方、备份与删除期限，发布可访问的正式说明。草稿不得直接当作已生效政策。
4. **过期认证数据清理**：`deploy/user-cleanup/` 是独立于 R2 的可选定时 Worker 模板。启用公共账户时，按模板绑定生产 `USER_DB` 并部署，验证它每小时清除过期 Session、邮件令牌和限流记录；不要把它部署为 Pages 项目。
5. **真实验收与监控**：用自有测试邮箱完成注册、验证、登录、改密、找回、退出、收藏、分类和数据导出；核对限流、Turnstile、Cookie、Session 撤销、用户隔离、邮件投递和 Pages/D1 错误率。日志不得包含密码、Token、Cookie 或密钥。配置备份失败与邮件失败告警并实际验证。

## 回滚

认证故障或恢复不确定时，在 Cloudflare Pages 的 Production 变量中将 `AUTH_ENABLED` 设为 `0`、保存并重新部署；`/api/auth/me` 应返回 503。静态阅读站与 Newsletter 独立运行。修复并重做真实验收后才考虑重新开放。Issue #163 的备份、删除、隐私和端到端验收项在完成前保持未勾选。

参考：[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[D1 导出与导入](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、[Pages D1 Binding](https://developers.cloudflare.com/pages/functions/bindings/)。
