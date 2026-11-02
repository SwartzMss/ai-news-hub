# Codex Linux Probe Implementation Plan

**Goal:** 为 Issue #2 提供可重复的 stdio 调用及 Linux 生命周期验证工具。

**Architecture:** 独立 TypeScript stdio 客户端 + 一次性 CLI + 专用 systemd unit。失败封闭，不发布任何内容。

**Tech Stack:** Node 22、TypeScript、node:test、systemd。

- [x] 添加 tests/codex-probe.test.mjs 与 tests/fixtures/app-server.mjs，验证初始化、终态、隔离、审批、超时、进程退出和协议错误；先运行观察失败。
- [x] 实现 tools/codex-probe/client.ts 与 cli.ts；npm test、npm run check。
- [ ] 原生 Ubuntu Server 24.04：真实账户运行两个 Run，检查不同 Thread 与固定输出；临时 systemd 用户 unit 检查退出、重启和 journal。当前仅有开发宿主观察，不能计入验收。
- [x] 添加 deploy/systemd/ai-news-hub-codex-probe.service 和 .env.example；开发宿主 systemd-analyze verify 已运行，目标服务器复核仍待完成。
- [x] 同步 README、ARCHITECTURE、ROADMAP、DEPLOY_LINUX 和验证记录，记录实际环境和未验收项目。
- [x] 最终 npm test（25/25）、npm run check、git diff --check；Draft PR #9 与 Issue #2 进展已同步，不提前关闭。Ubuntu 24.04 push CI 已通过。
