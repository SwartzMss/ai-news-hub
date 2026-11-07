# README 架构图资源

- `architecture.gif` 为 1000×750、约 16 秒循环的 README 动画，展示 Prompt → Codex 研究 → SQLite → 批准 → GitHub → Cloudflare Pages，以及独立的订阅发信链路。
- `architecture.svg` 使用同一布局和文字，包含 title/desc 和无脚本的 SVG 数据流动画，系统偏好减少动态效果时隐藏移动指示点。全部架构信息在静止状态下仍然可读。
- `../../scripts/render-architecture.py` 使用同一绘图逻辑生成两种资源，临时帧只在内存，PNG 预览写入 `/tmp`。

可选开发工具为 Python 3、Pillow 12 和 Ubuntu 的 DejaVu Sans 字体，它们是架构图生成工具的依赖。

```bash
python3 scripts/render-architecture.py
```

图中 Linux Backend 由 systemd 管理，支持持久化任务调度，最后一轮 Prompt 返回结构化日报；Backend 检查结构及链接格式，批准方式遵循人工操作或任务自动授权策略。

公开站构建来自 GitHub 归档。邮件链路由 GitHub Actions 定时触发，Pages Functions 读取当天公开日报及 D1 订阅状态，通过 Resend 发信。D1 的邮箱、确认及投递记录与 Linux SQLite 分开保存。邮件功能需配置生产绑定和密钥后启用，图中不会展示凭据。
