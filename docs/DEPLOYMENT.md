# 生产部署与恢复

本文面向受控生产环境。首次本地体验请先使用根目录 [README](../README.md) 的 Compose 快速开始。生产环境不得照搬开发 Compose 的端口、凭据或 `NODE_ENV`。

## 发布前置条件

- 完成 [OPEN_SOURCE_RELEASE.md](OPEN_SOURCE_RELEASE.md) 中的仓库检查与外部负责人事项。
- 运行 `npm test`、`npm run build`、`npm run audit:all`，保存不含秘密值的输出与制品哈希。
- 为应用、MySQL 8.4 和 S3 兼容对象存储建立备份、恢复、监控和容量方案。
- 使用精确版本的镜像/制品；不要从开发工作目录直接运行生产服务。

## 网络、HTTPS 与来源

生产环境必须设置 `NODE_ENV=production`，由可信反向代理或入口网关终止 HTTPS，并设置 `SESSION_COOKIE_SECURE=true`。`ALLOWED_ORIGINS` 必须是逗号分隔的精确 HTTPS origin，例如 `https://app.example.org`；不得包含路径、通配符、凭据、查询参数或仅为方便而加入的其他来源。

根目录 Docker Compose 快速开始只监听本机 HTTP，因此显式使用 `SESSION_COOKIE_SECURE=false`。服务端只允许该设置与 `localhost`、`127.0.0.1` 或 `::1` 来源组合；任何非本机生产来源必须使用 HTTPS 和 Secure Cookie。

只向用户网络暴露 HTTPS 应用入口。MySQL 和 S3 对象存储端点不得公开到公网；安全组、防火墙与容器网络应同时执行这一边界。对象存储桶保持私有，上传目录不作为静态目录提供。

反向代理需要：

- 保留 `Cookie`、`Origin`、`Range`、`X-CSRF-Token`、`Idempotency-Key` 请求头和范围响应头。
- 传递正确的外部协议与主机信息；禁止降级到明文会话。
- 请求体上限与应用上传限制一致，为大文件上传和 SSE 设置合理超时。
- 日志不记录 Cookie、CSRF token、密码、API key、授权头或敏感查询参数。

## 配置与秘密管理

以 `server/env.example` 为变量清单，通过秘密管理系统注入，不把 `.env` 放入镜像或制品。Docker Compose 本地运行编辑根目录 `.env`，host 主机运行编辑 `server/.env`。Gemini 的非空环境变量优先于 UI/数据库配置；空值允许采用 UI/数据库配置，Gemini 本身仍是可选能力。

| 类别 | 变量 | 生产要求 |
| --- | --- | --- |
| 数据库 | `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` | 独立最小权限账户；启用传输保护与备份 |
| 会话/来源 | `JWT_SECRET`、`ALLOWED_ORIGINS`、`NODE_ENV=production`、`SESSION_COOKIE_SECURE=true` | JWT 至少 32 个随机字符；来源为精确 HTTPS origin；会话 Cookie 仅通过 HTTPS 发送 |
| 对象存储 | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_USE_SSL`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`、可选 `MINIO_REGION` | 私有桶、最小权限、TLS、生命周期与容量策略 |
| AI（可选） | `GEMINI_API_KEY`、`GEMINI_DEFAULT_MODEL` | 只在启用 AI 时提供；限制权限并定期轮换 |
| 配额/运行时 | `MAX_*`、`QUOTA_LOCK_*`、`PORT`、`PYTHON_COMMAND`、`FFMPEG_COMMAND` | 按容量测试设定，避免默认值替代生产规划 |

建立轮换手册：签发新值、双轨或维护窗切换、验证新值、撤销旧值、检查共享服务拒绝旧值，并记录操作时间与负责人但不记录秘密正文。历史凭据必须先完成服务侧撤销，不能仅靠改 Git。

### 可选 API 中继

API 中继不是 VPN。只允许组织内部自建并授权的中继，或授权链、数据处理和退出安排均已核实的第三方中继。请求内容和元数据会经过中继；部署负责人必须在启用前完成真实数据流、隐私、保留删除、跨境传输、提供商条款、地区可用性、安全、配额和计费评审。不得用于地区或安全规避，也不得把公共转售当作内部中继的自然扩展。

生产 URL 必须使用 HTTPS，URL 不得嵌入凭据。当前实现要求通过受控管理员界面/API 将中继 URL 和 token 写入数据库持久化配置，不支持从环境变量或秘密管理系统直接注入中继 token；需要该能力时必须另行实现并验证受支持的集成。中继 token 在读取响应中保持遮蔽，但应用未提供数据库字段级静态加密，因此必须限制数据库/备份/转储访问并采用适用的存储静态加密。轮换时先停用中继、写入替换值，再重新确认启用。公开、商业、第三方或跨境部署的详细检查项与官方来源见 [API_RELAY_COMPLIANCE.md](API_RELAY_COMPLIANCE.md)。该文档是运营指引，不是法律意见；公开或商业部署应咨询适用法域的当地法律顾问。

## 构建与启动顺序

开发 Compose 启动命令使用 `--wait` 等待应用、MySQL 和 SeaweedFS 的健康检查；这不替代下述生产就绪与外部验证。

使用锁定的 Node/Python 依赖：

```bash
npm ci
npm ci --prefix server
npm ci --prefix client
python -m venv server/python_services/.venv
server/python_services/.venv/bin/python -m pip install -r server/python_services/requirements.txt
npm run build
npm test
npm run audit:all
```

空数据库只导入一次 `server/database/init.sql`。所有数据库随后按顺序运行：

```bash
npm run migrate
NODE_ENV=production npm --prefix server start
```

启动过程会连接数据库、检查并执行 `server/database/migrations/`、验证对象存储并确保桶存在，然后启动队列处理器与 HTTP 服务。任一步失败都应阻止实例进入流量池。`schema_migrations` 保存版本与校验和；已执行的迁移文件不得修改，新变更必须新增下一个编号文件。

首次管理员默认通过浏览器 `/setup` 创建。新数据库第一次启动时，应只允许受控运维来源访问应用，在维护窗口完成设置后再开放一般流量；完成后 `GET /api/auth/setup-status` 返回 `{"initialized":true}`，`POST /api/auth/setup` 永久返回 `409 already_initialized`，接口不提供重新开启方式。已有 users 的安装保持正常登录；没有 `AUTO_PROVISION_ADMIN` 的旧配置按 `false` 处理，不会在升级启动时自动创建或改写管理员。

无界面初始化是显式 opt-in。Docker 部署只有在 `AUTO_PROVISION_ADMIN=true`，且 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 两项完整、密码为 8–128 个字符时才运行 `setup-admin.js`；不完整配置会令启动失败关闭。非 Docker 部署可在受控维护窗口临时注入同样两项并执行 `npm run setup:admin`。项目没有邮件验证链路，因此该流程不要求邮箱。`ADMIN_*` 不应长期保留在生产运行环境；创建后移除临时值、恢复 `AUTO_PROVISION_ADMIN=false`，并按组织策略轮换账户密码。不要在文档、镜像、日志或版本库中保存固定密码。

## 对象存储准备与兼容边界

部署前验证桶存在或运行身份有创建桶权限，并验证读写、删除、Range 下载、容量告警与备份恢复。应用只通过 S3 兼容接口访问私有桶。

开发 Compose 使用 Apache-2.0 许可的 SeaweedFS 4.41，通过 S3 兼容端点提供本地对象存储。JCC Factory 目前仍沿用 `MINIO_*` 运行时变量和 MinIO JavaScript SDK 作为 S3 客户端命名，这不表示服务端必须使用 MinIO。生产环境可替换为经批准的 S3 兼容服务，但必须用真实上传、下载、删除、Range 下载、桶就绪与恢复流程验证兼容性。

旧版 Compose 使用 MinIO，并将数据写入 `minio_data` 卷；新版 SeaweedFS 使用独立的 `object_storage_data` 卷，绝不会把 MinIO 的磁盘布局当作 SeaweedFS 数据直接挂载。升级已有实例前，必须先通过 S3 API 从旧服务导出对象，再导入新服务并核对对象数量、大小和抽样哈希；确认应用读取正常后才能停用旧卷。直接重命名或复用旧卷不属于受支持的迁移方式。

## 迁移、备份与恢复

- 新实例：创建空库，导入 `init.sql`，再运行 `npm run migrate`。
- 既有实例：不要重新导入 `init.sql`，只运行 `npm run migrate`。
- 升级前同时备份 MySQL 与对象存储，并记录一致的恢复点和制品版本。
- 恢复时先恢复两类数据，再运行与目标版本匹配的迁移；不要手工写入 `schema_migrations`。
- 定期演练登录、受控下载、对象完整性、任务唯一领取和租约到期恢复。真实 legacy MySQL 8 迁移/恢复仍是发布前外部验证项。

## Worker、副本与租约

每个应用实例会启动 `UnifiedTaskProcessor`。多副本依赖 MySQL 8 行锁、`FOR UPDATE SKIP LOCKED` 与任务租约确保单次领取；不要并行启动旧调度器或额外消费者。部署滚动更新时先停止新任务领取，允许或中止在途任务，再终止进程。异常退出的任务只应在租约到期后重新领取。

## 健康、日志与资源限制

- 存活/基础健康：`GET /api/health`；外部探针地址为部署后的同源 HTTPS URL。
- 就绪：实例只有在启动期数据库迁移、对象存储检查和 worker 初始化成功后才接收流量；`/api/health` 本身不替代依赖级就绪证据。
- 日志：集中采集 stdout/stderr，设置保留期、访问控制和脱敏；监控启动失败、迁移失败、对象存储错误、401/403/429/5xx、队列积压和租约回收。
- 资源：为应用设置 CPU、内存、文件描述符、临时磁盘、上传空间和进程数限制；为 MySQL 连接池、配额锁池、上传并发及 worker 并发保留容量。

上线回滚应优先回滚应用制品；数据库变更必须采用向前兼容策略。任何需要数据回退的操作都应基于已演练的备份/恢复方案，而不是临时修改已执行迁移。
