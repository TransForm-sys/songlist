# 后端 API 契约

后端：`node server/index.mjs`，默认 `http://127.0.0.1:5181`。
开发时前端 dev server（5180）会把 `/api` 与 `/uploads` 代理过去。

所有响应都是 JSON（下载类接口除外）。错误统一为：

```json
{ "error": "人类可读的中文错误", "status": 401 }
```

鉴权用 HttpOnly cookie（`songlist_session`），前端只要带上同源请求即可，**不需要**手工传 token。
未登录访问管理接口返回 `401 { "error": "未登录或登录已过期" }`。

---

## 公开接口（前台用，无需登录）

### `GET /api/health`
```json
{ "ok": true, "songs": 779, "time": 1760000000000 }
```

### `GET /api/songs`
前台的全部数据，一次拿完（几百首约 100KB）。
```json
{
  "meta": { "streamerName": "示例主播", "liveUrl": "https://live.bilibili.com/123", "icp": "", "notice": "" },
  "songs": [
    { "id": 1, "isNew": false, "title": "渡口", "singer": "蔡琴", "language": "中文", "genre": "中文流行", "sc": "", "note": "" }
  ],
  "total": 779,
  "generatedAt": 1760000000000
}
```
> 前台拿不到这个接口时会自动回退去读静态 `/list.txt`，所以别把它做成必需依赖。

### `GET /api/profile`
主播简介对象，没有配置时返回 `null`。结构见 `public/profile.json`：
```ts
{
  title?: string
  bio?: string
  avatar?: string   // 图片地址，可用 /uploads/xxx.png
  cover?: string
  tags?: string[]
  links?: { label: string; url: string }[]
  blocks?: (
    | { type: 'notice' | 'text'; title?: string; content: string }
    | { type: 'list'; title?: string; items: string[] }
    | { type: 'kv'; title?: string; items: { label: string; value: string }[] }
  )[]
}
```

---

## 登录

### `GET /api/auth/session`
```json
{ "authed": true, "user": { "username": "admin" } }
```

### `POST /api/auth/login`
请求 `{ "username": "admin", "password": "..." }` → `{ "ok": true, "user": { "username": "admin" } }`
失败：`401 用户名或密码不对`；同一 IP 10 分钟内失败 8 次后返回 `429`。

### `POST /api/auth/logout` → `{ "ok": true }`

---

## 管理接口（全部需要登录）

### `GET /api/admin/overview`
```json
{
  "songs": 779, "scSongs": 8, "newSongs": 0, "singers": 338,
  "languages": [{ "value": "中文", "count": 507 }],
  "genres": [{ "value": "中文流行", "count": 496 }],
  "lastBackup": { "id": 3, "createdAt": 1760000000000, "reason": "auto", "file": "backup-....json", "songCount": 779 },
  "backups": 3, "dbBytes": 245760,
  "settings": { "streamerName": "示例主播", "liveUrl": "", "icp": "", "notice": "" }
}
```

### `GET /api/admin/songs`
查询参数（都可省略）：

| 参数 | 说明 |
| --- | --- |
| `q` | 关键词。**支持拼音**：`dukou`、`dk`、`渡口` 都能命中（后端已建好检索列） |
| `language` / `genre` / `singer` | 多选，用英文逗号分隔，如 `language=中文,日语` |
| `sc=1` | 只看需要 SC 的 |
| `isNew=1` | 只看标记为「新」的 |
| `page` / `pageSize` | 默认 1 / 50，`pageSize` 最大 500 |
| `sort` | `position`（默认，即手工顺序）/ `title` / `singer` / `updated` / `created` |

响应：
```json
{
  "items": [ { "id": 1, "title": "渡口", "singer": "蔡琴", "language": "中文", "genre": "中文流行",
               "sc": "", "note": "", "isNew": false, "position": 1,
               "createdAt": 1760000000000, "updatedAt": 1760000000000 } ],
  "total": 779, "page": 1, "pageSize": 50,
  "facets": {
    "language": [{ "value": "中文", "count": 507 }],
    "genre": [{ "value": "中文流行", "count": 496 }],
    "singer": [{ "value": "蔡琴", "count": 1 }]
  },
  "scCount": 8
}
```
`facets` 是**分面统计**：每一维的数量都排除了自己这一维的筛选（选了「中文」之后，语种列表仍然显示所有语种的数量）。`singer` 可能有几百项，前端用可搜索下拉。

### `GET /api/admin/songs/:id` → 单首歌

### `POST /api/admin/songs`
请求体即歌曲字段（`title` 必填）：
```json
{ "title": "渡口", "singer": "蔡琴", "language": "中文", "genre": "中文流行", "sc": "", "note": "", "isNew": false }
```
→ `{ "ok": true, "id": 780, "song": { ... } }`（新歌追加在最后）

### `PUT /api/admin/songs/:id`
同上，只传要改的字段也行（会与现有值合并）。

### `DELETE /api/admin/songs/:id` → `{ "ok": true }`

### `POST /api/admin/songs/bulk-delete`
`{ "ids": [1, 2, 3] }` → `{ "ok": true, "removed": 3 }`

### `POST /api/admin/songs/bulk`（批量导入 / 对应旧后台的「批量新增」）
```json
{
  "mode": "append",
  "items": [ { "title": "渡口", "singer": "蔡琴", "language": "中文", "genre": "中文流行", "sc": "", "note": "", "isNew": false } ]
}
```
- `mode`: `append` 追加 / `replace` 清空后导入（会先自动留一份 `before-replace` 备份）
- 服务端按 `歌名 + 歌手` 去重：与库里已有重复、或本次请求内部重复的都会跳过
- **文本解析在前端做**（可复用 `src/utils/parse.ts` 解析从 Excel 复制过来的内容），服务端只收结构化数组

响应：
```json
{ "ok": true, "mode": "append", "received": 120, "added": 118, "skipped": 2,
  "duplicates": [{ "title": "渡口", "singer": "蔡琴" }], "duplicateCount": 2, "total": 897 }
```

### `POST /api/admin/songs/reorder`（拖拽排序）
`{ "ids": [12, 3, 88, ...] }` —— 传入**当前页或全部**的 id 顺序，服务端按这个顺序重写 `position`。
→ `{ "ok": true, "count": 3 }`

> 建议做法：拖拽结束后把「受影响的完整顺序」提交上来（例如当前页 + 前后各一条），或者后台直接把 `sort=position` 时的全部 id 一次性提交。

### `POST /api/admin/songs/pin`（置顶 / 置底）
`{ "ids": [3, 8], "mode": "top" }`（`mode` 可为 `top` / `bottom`）→ `{ "ok": true, "mode": "top", "count": 2 }`

### `POST /api/admin/songs/:id/move`（上移 / 下移一格）
`{ "direction": "up" }` → `{ "ok": true, "moved": true }`（已在边界时 `moved: false`）

### `GET /api/admin/profile` → `{ "profile": {...} | null }`
### `PUT /api/admin/profile`
`{ "profile": { ...完整对象... } }`（整体覆盖；`blocks`/`tags`/`links` 必须是数组，否则 400）

### `GET /api/admin/settings`
→ `{ "settings": { "streamerName": "", "liveUrl": "", "icp": "", "notice": "" }, "defaults": {...} }`
### `PUT /api/admin/settings`
`{ "settings": { "streamerName": "浅野天琪", "notice": "公告文本" } }`（只传要改的键；未知键会 400）

### `POST /api/admin/upload`
```json
{ "filename": "avatar.png", "dataUrl": "data:image/png;base64,iVBORw0..." }
```
→ `{ "ok": true, "url": "/uploads/1760000000-ab12cd34.png", "bytes": 12345 }`
允许 `png / jpeg / webp / gif / svg`，上限 3MB。前端用 `FileReader.readAsDataURL` 读文件即可。

### `GET /api/admin/backups`
→ `{ "backups": [ { "id": 3, "createdAt": 1760000000000, "reason": "auto", "file": "backup-...json", "bytes": 12345, "songCount": 779 } ], "keep": 60 }`
`reason` 取值：`auto`（普通写入前的节流备份）、`manual`、`before-replace`、`before-restore`。

### `POST /api/admin/backups` → `{ "ok": true, "backup": {...} }`（手动打一份）
### `POST /api/admin/backups/:id/restore`
→ `{ "ok": true, "restored": 779, "from": {...}, "total": 779 }`（恢复前会先自动存一份 `before-restore`）
### `DELETE /api/admin/backups/:id` → `{ "ok": true }`
### `GET /api/admin/backups/:id/download` → 下载该备份的 JSON 文件

### `GET /api/admin/export?format=txt|json`
- `txt`（默认）：下载与表格导出格式一致的 `list.txt`（可直接回填表格）
- `json`：下载含 settings + profile + songs 的完整快照

### `GET /api/admin/audit?limit=100`
→ `{ "items": [ { "id": 12, "createdAt": 1760000000000, "action": "song.create", "detail": "渡口", "ip": "127.0.0.1" } ] }`

---

## 行为约定（实现后台时需要知道的）

1. **任何写操作都会尝试再生静态文件**：`dist/list.txt` 与 `dist/profile.json` 会跟着数据库一起更新，所以前台即使退回纯静态也是最新的。
2. **写操作前会自动备份**（同类操作 5 分钟内只留一份，节流），破坏性操作（覆盖导入、回滚）必定单独备份。
3. **操作会记审计日志**，最近 500 条。
4. 管理接口的 `q` 支持拼音，是因为服务端维护了一列 `search_blob`（原名 + 全拼 + 首字母，小写去空格）。
