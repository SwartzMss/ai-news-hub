# 永久收藏 API

Issue [#160](https://github.com/SwartzMss/ai-news-hub/issues/160) 在 Pages Functions 增加用户收藏；[#161](https://github.com/SwartzMss/ai-news-hub/issues/161) 增加私有分类；[#162](https://github.com/SwartzMss/ai-news-hub/issues/162) 加入收藏与分类前端。数据写在独立的 `USER_DB`。目标用户 D1 先执行 `users/migrations/0003.sql`，再执行 `0004.sql`；已执行的版本不重复运行。生产认证仍由 `AUTH_ENABLED` 控制，未完成真实验收前保持关闭。

| 接口 | 请求 | 响应 |
| --- | --- | --- |
| `POST /api/favorites` | JSON `{ "articleKey": "32位小写十六进制" }` | 新增 201、重复 200，返回已有或新增完整快照 |
| `GET /api/favorites?limit=20&offset=0&sort=newest` | `limit` 1–50，`offset` 0–10000，`sort` 为 `newest`/`oldest`；可选 `q`（标题/来源，最多 100 字符）、`category`（`all`/`none`/分类 UUID）、`articleKey`（32 位 key） | 含来源名称、原文日期的收藏摘要列表和 `hasMore` |
| `GET /api/favorites/:id` | 收藏 UUID | 当前用户的版本化完整快照 |
| `PATCH /api/favorites/:id/category` | JSON `{ "categoryId": "分类 UUID" }` 或 `{ "categoryId": null }` | 移动收藏或回到未分类，返回更新后的收藏 |
| `DELETE /api/favorites/:id` | 收藏 UUID | 成功 204，不存在或其他用户的 ID 返回 404 |
| `GET /api/favorite-categories` | 无 | 当前用户分类，按 `sortOrder`、创建时间和 ID 排序 |
| `POST /api/favorite-categories` | JSON `{ "name": "分类名", "sortOrder": 0 }` | 新建 201，同名重复提交返回原分类 200 |
| `PATCH /api/favorite-categories/:id` | JSON `{ "name": "新名" }` 和/或 `{ "sortOrder": 1 }` | 修改分类，重名返回 409 |
| `DELETE /api/favorite-categories/:id` | 分类 UUID | 删除分类 204，旗下收藏回到未分类 |

所有接口读取 `__Host-anh_session`，按认证 Session 的有效期、撤销状态、闲置时间和用户状态校验；POST/PATCH/DELETE 还要求同源 `Origin`。SQL 查询、修改和删除都包含 `user_id`。客户端不能提交 `user_id` 或文章内容，创建时服务端从同次 Pages 部署的 `/data/articles/<key>.json` 读取已发布文章。文章 key 按 `SHA-256(topic.id + ':' + article.id)` 的前 32 位小写十六进制复核；缺失或非法文章拒绝。静态文件由公共站构建生成，只包含当前公开文章。对同一用户同一 key，重复创建返回原收藏，不覆盖快照；即使原文章后来不在公开数据中，已有收藏仍可读取和重复确认。

`favorites` 表只关联 `users`，不关联日报 `report_id`、归档路径或公共搜索索引。`snapshot_version=1` 与 JSON 中的 `schemaVersion=1` 表示当前快照格式；保存标题、话题、报告时间、分类、事实摘要、分析、详情结构、原文与证据 URL。服务端限制 JSON 请求 64 KiB，并校验字段白名单、类型、嵌套深度、文本长度、链接协议和证据引用；拒绝 HTML 标签。列表只返回摘要，详情返回完整快照。日报 30 天清理或归档修订不修改此表；删除用户时按外键级联删除该用户收藏。收藏数据属于私有用户数据，备份与恢复需包含生产 `USER_DB`。

`favorite_categories` 与收藏的 `category_id` 分别属于当前 Session 用户；数据库触发器禁止跨用户分类归属。分类名称会做 Unicode NFKC、首尾空白清理和大小写归一，同一用户同名唯一；1–50 字符，拒绝控制字符、双向控制字符和 HTML 标签尖括号。`sortOrder` 为 0–10000 的整数，省略时为 0。每篇收藏最多属于一个分类；分类不存在或属于他人时移动返回 404。删除分类不删除或覆盖收藏快照，分类排序不影响其他用户或公共站主题。
