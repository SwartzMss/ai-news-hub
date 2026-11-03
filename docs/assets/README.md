# README 架构图资源

- `architecture.gif`：1000×480、约 10 秒循环，展示当前手动采集/分析/审核/归档/静态构建链路。
- `architecture.svg`：静态等价图，含 title/desc，便于直接查看和阅读；没有脚本、外部字体或远程资源引用。
- `../../scripts/render-architecture.py`：同一绘图逻辑生成两种资源，所有临时帧只在内存，PNG 预览写入 `/tmp`。

可选的开发工具为 Python 3、Pillow 12 和 Ubuntu 的 DejaVu Sans 字体；这些不是 Backend/Web 的安装或运行依赖，也不在 CI 中额外安装。

```bash
python3 scripts/render-architecture.py
```

输出会明确覆盖本目录的两个派生资源。GIF 中只移动数据流指示点和当前阶段高亮，没有闪烁；静态图包含全部同等信息。中文流程说明在 README 的替代文本及正文中。

图中 Cloudflare 部署与原生 systemd 实机验收标记为 pending，定时调度未实现。代码实现或验收状态变化时，同步更新生成脚本、架构文档和 README 后再生成，避免动画展示超出实际能力。
