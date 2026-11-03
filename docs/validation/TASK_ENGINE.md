# Issue #4 任务引擎验证记录

记录日期：2026-11-03（Asia/Shanghai；真实调用发生于 2026-11-02 UTC）。关联 [Issue #4](https://github.com/SwartzMss/ai-news-hub/issues/4)。

## 实现与测试范围

任务引擎支持新 Run、同一 Run 继续 Turn、独立 Thread、SQLite 状态/事件历史、幂等、并发/队列、取消、超时、拒绝审批和重启中断标记。管理 API 需要 Token，默认关闭。这是 #4 交付时的证据范围；后续新闻/发布和管理页面由 #5–#8 提供，不改变本次历史实测环境。

自动测试使用可控 Adapter 或模拟 stdio 子进程，不访问模型。覆盖成功与提前到达的终态、认证/额度/限流/协议失败、取消、进程退出、Token/环境隔离、迁移升级、同任务互斥与重启后历史。
进程测试实际启动 Backend，执行 SIGKILL 并回收其模拟 Codex 进程组，再启动 Backend，验证失效所有权接管及旧 Run / Turn 标 interrupted。测试自行回收进程组，不能视为已实测 systemd 控制组回收。
代码审查发现的清理失败后继续调度问题已增加回归：`cleanup_failed` 会冻结调度、拒绝新执行，且不能被 timeout/cancelled 掩盖。正式入口触发非零关闭，交由 systemd 兜底。

本地最终检查：`npm test` 90/90 通过（含完成后的迟到事件不能改写终态），`npm run lint`、`npm run typecheck` 和测试内的构建通过，`git diff --check` 无输出。Node 22 的 SQLite 实验性提示保留，不作为已稳定 API 的证明。

## 真实开发调用

使用当前非 root 开发账户、Node.js 22.19.0、Codex CLI 0.166.0，通过新 Backend 的认证管理 API 执行固定无工具样例，临时数据目录在验证后清理；未复制或提交凭据、原始协议或本地 SQLite。
当前开发宿主为 Ubuntu 22.04 用户空间 / WSL2。这些结果证明开发链路可用，不计入原生 Ubuntu Server 24.04 服务账户/systemd 部署验收，也不增加该宿主的部署支持。

| 阶段 | Run | Thread | 结果 |
| --- | --- | --- | --- |
| 新建 | `1923c80c-ebc5-463d-9b5d-9922cb176091` | `01a19cb7-4286-73f1-8807-6d6bf6b1fdf0` | succeeded；固定样例输出匹配 |
| 继续第二个 Turn | 同上 | 同上 | succeeded；恢复原 Thread，继续输出匹配 |
| 独立新 Run | `deb306e6-9ce2-43ca-9707-17cf211ca772` | `01a19cb7-c12f-7ab1-b57c-f286fb95995d` | succeeded；与原 Run 的 Thread 不同 |

三个服务器 Turn ID 依次为 `01a19cb7-44d2-7d73-95a4-329d1c4a8603`、`01a19cb7-7e60-7b10-b1ea-5cf73c61855a`、`01a19cb7-c151-7e43-abbd-1594558dfb1e`。仅记录标识、状态与输出是否匹配，不记录认证响应或任意模型正文。

## 仍需目标服务器验收

- [ ] 原生 Ubuntu Server 24.04、独立非 root 服务账户，确认 HOME / PATH / CODEX_HOME、凭据权限与 Codex 认证。
- [ ] systemd 托管 Backend，手动执行样例、继续 Turn、取消和异常重启；验证 journal、控制组无残留进程和历史中断标记。
- [ ] 真实登录过期、额度限制/恢复与长期无人值守观察；模拟失败不等于真实上游故障验证。

#2 的待验收事项继续保留。一次真实成功不证明永久可用或使用额度无限；部署步骤见 [Linux 文档](../DEPLOY_LINUX.md)。
