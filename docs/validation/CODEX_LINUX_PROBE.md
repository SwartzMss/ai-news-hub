# Issue #2 验证记录

关联：[#2](https://github.com/SwartzMss/ai-news-hub/issues/2)。记录日期：2026-11-02。

**结论：探针实现完成，目标服务器验收未完成，Issue 保持开放。**
没有真实新闻 Backend、SQLite、管理 API 或发布服务。

## 环境与证据范围

当前开发会话为 Ubuntu 22.04.5 用户空间，内核 `6.6.87.2-microsoft-standard-WSL2`，非 root 用户；Node.js 22.19.0、npm 11.6.2、Codex CLI 0.166.0、systemd 249。
这不是 v0.1 指定的原生 Ubuntu Server 24.04 环境。以下宿主观察仅为开发诊断，不能勾选目标服务器验收；不增加该环境的部署支持。

## 已完成

- TypeScript 独立探针经 stdio 完成 initialize / initialized → account/read → thread/start → turn/start。
- 每次 Run 使用独立 Thread；成功必须关联 Thread / Turn、终态为 completed 且回复固定标记。
- 服务器请求不自动批准；超时、退出、协议异常、非成功终态和输出错误均失败退出。
- SIGTERM / SIGINT 取消与整个进程组回收，必要时 SIGKILL，清理等待上限 2.5 秒；日志不包含原始协议、令牌、错误文本或 stderr。
- 确定性测试覆盖握手、早到通知、不同 Run、认证/额度/限流错误、审批、退出、超时、错误格式、错误输出及强制回收。`npm test` 不使用真实账户或模型。
- 提供独立服务账户的 systemd unit、环境文件示例与操作说明；没有启用或安装正式服务。
- 添加 Ubuntu 24.04 CI 配置，远端测试状态须查看 Actions，不能把配置存在等同于运行通过。

本地最终检查：`npm test` 25/25 通过、`npm run check` 通过、`git diff --check` 无输出。进程组清理经代码审查及两个后代进程回归用例验证。

首次 [Ubuntu 24.04 GitHub Actions](https://github.com/SwartzMss/ai-news-hub/actions/runs/41445490466) 构建/类型检查/无网络测试通过；CI 不提供 Codex 登录或真实模型调用，也不替代服务部署验收。实现见 [Draft PR #9](https://github.com/SwartzMss/ai-news-hub/pull/9)，[Issue 进展](https://github.com/SwartzMss/ai-news-hub/issues/2#issuecomment-6577240843) 已同步。

## 开发会话观察（不计入目标验收）

1. `codex login status` 报告已登录。直接运行探针于 12:19:36–12:19:44 UTC 完成真实 Turn；Run `df2b2937-624a-4e16-87e8-612e5fa0254e`，Thread `01a19c33-6ec0-7e20-97ec-c4b75f053616`，Turn `01a19c33-70df-7ad3-9116-59a57ea7b838`。收到固定标记并回收子进程，退出码 0。
2. 临时用户 systemd unit 初始化成功，但 `account/read` 在约 15 秒后返回 `-32603`，脱敏提示 `timeout`，退出码 1，无伪成功。交互 shell 存在小写代理变量、临时 unit 未继承；网络环境差异是待验证假设，尚未确认根因。
3. 故障注入 unit 的 journal 出现 `process_exit`、重启计数 1、第二个独立 Run / Thread 模拟成功；停止另一个等待中的模拟 unit 出现 `cancelled` 和 `child_closed`。这些是模拟结果，不是目标平台或真实模型恢复验收。
4. 当前个人凭据目录 0775、文件 0644，不满足部署要求。未修改或复制个人凭据，也未执行 logout；正式服务应独立登录并使用 0700 / 0600 权限。
5. `systemd-analyze verify` 返回 0，但宿主另有不可读 unit 及 snapd 未知配置项警告；不视为目标机器上的干净校验。

## 仍需在原生 Ubuntu Server 24.04 LTS 验收

- [ ] 记录目标系统、Node、Codex 和 systemd 版本及安装路径。
- [ ] 独立非 root 服务账户登录，核对 HOME / PATH / CODEX_HOME 与凭据权限。
- [ ] 正式 probe unit 在 systemd 生命周期中完成真实成功 Turn，journal 可定位错误。
- [ ] 再运行一次验证不同 Run 的真实 Thread 隔离；异常停止后无遗留进程。
- [ ] 缺失认证的受控目录返回非成功；记录认证过期/重新授权的实际处理。
- [ ] 验证真实上游错误的诊断；不为测试主动耗尽额度。
- [ ] 验证重启/重新连接后新 Run 正常执行，旧 Run 不被误报成功。
- [ ] 观察长期无人值守登录与续期；一次成功调用不证明永久可用。
- [ ] 将实际命令、脱敏结果和时间补入本记录，再更新 Issue 验收状态。

操作步骤见 [DEPLOY_LINUX.md](../DEPLOY_LINUX.md#8-issue-2-独立探针验证步骤)。
