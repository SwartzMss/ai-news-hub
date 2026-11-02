# AGENTS.md

本仓库是计划中的 AI News Hub，目标为“Codex App Server + 本地调度/采集 + Web 展示 + RSS 发布”，**不是**一个已完成的系统。

## 开发原则

1. 优先完成 v0.1 的端到端最小闭环；除非任务明确要求，不提前扩展复杂的分布式架构。
2. 主要目标环境是 **Windows 原生**，示例命令默认使用 PowerShell，不强制依赖 WSL。
3. 以 Codex App Server 作为 Agent 执行引擎；后端负责调度、采集、去重、存储、内容校验及发布。
4. 优先通过本地子进程 stdio 与 App Server 通信；用独立 Adapter 封装协议，处理初始化、事件、审批、错误和进程重启。
5. 对每个任务记录最终状态，不能将 interrupted/failed 视为 completed；要保留可核验的原始新闻链接与时间字段。
6. 对代码、测试、文档的更改应保持一致。未实现的功能必须标为 planned / TODO，禁止虚构运行结果、测试通过情况和可用 API。
7. 不提交密钥、Cookie、OAuth Token、真实数据库、临时文件和本地日志；不要擅自对外暴露本地服务。
8. 新闻内容区分事实、引用、观点与推断；来源不明的信息不得自动发布为事实。
9. 无需为了小功能引入过重依赖；技术方案修改应同步更新 README 与 docs。
10. 开源许可证未确定，不擅自加入 LICENSE。

## 主要参考

- [README.md](README.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
