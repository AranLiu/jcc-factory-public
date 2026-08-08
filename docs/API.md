# API 会话与安全契约

所有接口以 `/api` 为基础路径。当前公开端点是：

- `POST /api/auth/login`
- `GET /api/auth/setup-status`
- `POST /api/auth/setup`
- `GET /api/health`

其余 `/api/*` 端点都经过全局会话认证；不要从某个路由文件缺少局部中间件推断它是公开接口。本文列出稳定的安全与行为边界，不试图复制每个实现路由。

## 一次性首次设置

浏览器 `/setup` 是新安装的默认首启路径。页面先调用 `GET /api/auth/setup-status`：空 users 表返回 `200 {"initialized":false}`，并设置浏览器初始化所需的 CSRF cookie；已有任意用户时返回 `200 {"initialized":true}`，调用方应转到普通登录流程。旧安装即使没有 `AUTO_PROVISION_ADMIN` 也按 `false` 处理，既有用户仍可正常登录。

`POST /api/auth/setup` 接收 JSON `username`、`password`，要求用户名 3–50 个可见字符、密码 8–128 个字符，并要求请求 `Origin` 精确属于 `ALLOWED_ORIGINS`。项目没有邮件验证链路，首次初始化不要求或采集邮箱。成功时返回 `201`：

```json
{"created":true,"user":{"id":1,"username":"...","email":null,"role":"admin","permission":"global"}}
```

初始化完成后，`GET /api/auth/setup-status` 始终返回 `{"initialized":true}`，所有后续 `POST /api/auth/setup` 永久返回 `409`：

```json
{"code":"already_initialized","message":"The system is already initialized"}
```

并发设置由数据库锁串行化；短暂竞争可返回 `503 setup_busy` 和 `Retry-After: 1`，无效字段返回 `400`。该 API 是一次性创建首位管理员的入口，不是密码重置或新增用户接口，也没有重新开启初始化的管理开关。自动化环境若明确选择 headless provisioning，应使用部署文档中的 `AUTO_PROVISION_ADMIN=true` 或 `npm run setup:admin` 流程。

## Cookie 会话与 CSRF

登录成功后服务端设置：

- `jcc_session`：`HttpOnly`、`SameSite=Lax`；生产环境设置 `Secure`。
- `jcc_csrf`：浏览器可读的双提交 CSRF token。

浏览器请求必须携带 Cookie（Axios `withCredentials` 或 Fetch `credentials: 'include'`）。`POST`、`PUT`、`PATCH`、`DELETE` 还必须同时满足：

1. `Origin` 精确属于 `ALLOWED_ORIGINS`；
2. `X-CSRF-Token` 与 `jcc_csrf` Cookie 一致。

API 不接受 Bearer token 或 URL token。登录、改密、管理员重置密码和停用用户会按实现建立或撤销数据库中的可撤销会话；JWT 只是带签名的会话票据，不替代服务端会话记录。

## 身份与管理员边界

常用身份端点：

- `POST /api/auth/login`：验证用户名/密码并创建会话。
- `GET /api/auth/verify`：返回当前会话用户。
- `POST /api/auth/logout`：撤销当前会话并清理 Cookie。
- `POST /api/auth/change-password`：登录用户修改自己的密码。

明确由 `requireAdmin` 保护的管理员权限包括用户创建/列表/管理（`/api/auth/create-user`、`/api/auth/users*`）以及 `POST /api/queue/global/pause`。普通用户的数据范围还受 `personal`、`readonly_global`、`global` 权限与资源所有权约束；管理员身份不应由客户端字段决定。

不要把“已登录”当作管理员授权。新增管理端点必须同时加入服务端管理员检查、CSRF/Origin 覆盖和授权测试。

## 文件、文档与知识库

上传使用 `multipart/form-data`。服务端检查扩展名、MIME、文件签名、`Content-Length`、大小、并发和用户配额；压缩格式还受解包安全限制。用户提供的文件名只用于展示/下载名，服务端以随机名称保存。

- 项目文件位于 `/api/files/*`；下载、视频 Range 流与缩略图均为受控端点。
- 文档操作位于 `/api/documents/*`；上传入口接受 `.docx`、`.txt`。
- 知识库位于 `/api/knowledge-base/*`。知识库上传仅支持 `.docx` 和 `.txt`，不支持 PDF、HTML、旧 Word 或其他压缩格式。
- 知识库列表、内容、预览、下载、改名、标签、完整性检查和恢复都必须经过当前用户的数据范围/所有权检查。

上传目录和对象存储桶没有公开静态 URL。客户端必须使用 API 返回的受控下载路径。HTML 预览/导出会净化内容；导出默认作为附件，不能依赖用户 HTML 获得脚本执行。

## 任务队列、幂等与 SSE

AI 分析任务可在请求头提供 `Idempotency-Key`。键是长度受限的 opaque 值；同一用户/操作重复使用同一键时返回既有任务，避免重复执行。客户端在网络重试中应保留原键，不要为一次逻辑操作生成多个键。

队列端点位于 `/api/queue/*`，任务暂停、恢复、重试、取消和清理会再次执行任务所有权或管理员授权。静态清理路由在数字任务 ID 路由之前匹配，任务 ID 只接受十进制数字。

事件流为 `GET /api/events`，响应类型是 `text/event-stream`。连接必须携带有效 Cookie；服务端只向任务所有者或管理员发送相应事件，并限制每用户连接数。事件不应包含其他用户数据、秘密值或原始内部错误。断线后客户端应查询任务状态，不把 SSE 当作唯一事实源。

## 状态与错误语义

成功创建通常使用 `200` 或 `201`，删除可使用 `200`/`204`；具体响应体以端点实现为准。客户端至少按以下错误类别处理：

- `400`：参数、路径、幂等键、扩展名/MIME/签名不合法。
- `401`：未登录、会话撤销或过期。
- `403`：已登录但缺少角色、数据范围、资源权限，或 CSRF/Origin 校验失败。
- `404`：端点或当前调用者可见范围内的资源不存在。
- `409`：状态冲突、重复或并发条件不允许当前操作。
- `411`：上传缺少有效 `Content-Length`。
- `413`：请求、文件或用户存储配额超限。
- `415`：已有知识库对象的实际格式不受支持。
- `429`：登录速率、API 速率或并发上传/连接超限。
- `500` / `503`：应用或依赖服务异常；生产响应不得暴露堆栈、SQL、路径或秘密值。

调用方不得根据中文错误文本编程；使用 HTTP 状态和结构化字段，并把未知 5xx 视为可观察但不可盲目重放的失败。带副作用的重试应使用 `Idempotency-Key` 或先查询当前状态。
