# Issue #2：Codex Linux 验证设计

用户已同意交付最小 Node/TypeScript 验证程序、systemd 配置和实际运行记录。
本次选择独立的一次性探针；完整 Backend 会把新闻/数据库功能混入认证验证，纯手动 RPC 则难以重复检查失败路径。

探针由 Node spawn stdio App Server，完成 initialize / initialized、account/read、thread/start、turn/start。
每个 Run 新建只读 Thread，固定无工具提示词与成功标记。只接受对应 Thread/Turn 的 completed 成功终态，且必须有预期输出。
等待期间所有服务器请求均拒绝并以 needs_approval 终止，不允许自动授权；超时、协议错误、退出、认证不足和 Turn 失败均返回非零码。
日志仅包含允许的元数据和错误类别，不记录原始协议、认证响应、stderr 或提示词内容。
SIGTERM/SIGINT 及正常结束都回收独立进程组；SIGTERM 后必要时 SIGKILL，清理等待不超过 2.5 秒，失败报告 cleanup_failed；systemd KillMode=control-group 兜底。

用模拟 stdio 子进程覆盖确定性故障，用真实已登录账户验证调用及 Run 隔离；额度/认证故障注入不等于真实耗尽或过期。
服务配置是专用 probe unit，不冒充尚不存在的 Backend。Ubuntu 24.04、独立服务用户及长期续期必须单列验收。
