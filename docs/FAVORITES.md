# 永久收藏 API

Issue [#160](https://github.com/SwartzMss/ai-news-hub/issues/160) 在 Pages Functions 增加用户收藏，数据写在独立的 `USER_DB`。先在目标用户 D1 应用 `users/migrations/0003.sql`；生产认证仍由 `AUTH_ENABLED` 控制，未完成真实验收前保持关闭。收藏前端属于 [#162](https://github.com/SwartzMss/ai-news-hub/issues/162)。

| 接口 | 请求 | 响应 |
| --- | --- | --- |
| `POST /api/favorites` | JSON `{ "articleKey": "32位小写十六进制" }` | 新增 201、重复 200，返回已有或新增完整快照 |
| `GET /api/favorites?limit=20&offset=0&sort=newest` | `limit` 1–50，`offset` 0–10000，`sort` 为 `newest`/`oldest` | 收藏摘要列表和 `hasMore` |
| `GET /api/favorites/:id` | 收藏 UUID | 当前用户的版本化完整快照 |
| `DELETE /api/favorites/:id` | 收藏 UUID | 成功 204，不存在或其他用户的 ID 返回 404 |

所有接口读取 `__Host-anh_session`，按认证 Session 的有效期、撤销状态、闲置时间和用户状态校验；POST/DELETE 还要求同源 `Origin`。SQL 查询和删除都包含 `user_id`。客户端不能提交 `user_id` 或文章内容，创建时服务端从同次 Pages 部署的 `/data/articles/<key>.json` 读取已发布文章。文章 key 按 `SHA-256(topic.id + ':' + article.id)` 的前 32 位小写十六进制复核；缺失或非法文章拒绝。静态文件由公共站构建生成，只包含当前公开文章。对同一用户同一 key，重复创建返回原收藏，不覆盖快照；即使原文章后来不在公开数据中，已有收藏仍可读取和重复确认。

`favorites` 表只关联 `users`，不关联日报 `report_id`、归档路径或公共搜索索引。`snapshot_version=1` 与 JSON 中的 `schemaVersion=1` 表示当前快照格式；保存标题、话题、报告时间、分类、事实摘要、分析、详情结构、原文与证据 URL。服务端限制 JSON 请求 64 KiB，并校验字段白名单、类型、嵌套深度、文本长度、链接协议和证据引用；拒绝 HTML 标签。列表只返回摘要，详情返回完整快照。日报 30 天清理或归档修订不修改此表；删除用户时按外键级联删除该用户收藏。收藏数据属于私有用户数据，备份与恢复需包含生产 `USER_DB`。
