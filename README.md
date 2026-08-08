# JCC Factory

JCC Factory 是一套可私有化部署的短剧拆解与剧本工作台，支持视频素材管理、AI 拉片、角色关系分析、知识库管理和剧本整合。当前版本仅支持短剧拆解工作流。

## 主要功能

- 管理短剧项目和视频素材
- 使用 AI 生成分集拉片结果
- 自动整理跨集角色档案与关系图谱
- 管理 `.docx`、`.txt` 知识库
- 完成内容整合、角色整合和结果导出
- 通过任务队列查看处理进度

## Docker 快速开始

准备以下环境：

- Docker Desktop，或 Docker Engine + Docker Compose v2
- Node.js 22.15+ 与 npm 10+

克隆仓库后，在根目录运行：

```powershell
npm run quickstart
```

首次运行会构建并启动应用、MySQL 和 SeaweedFS 对象存储，同时生成本地 `.env` 与 `server/.env`。`--wait` 会等待应用健康检查通过后再返回。

启动完成后打开：

- 应用：`http://127.0.0.1:${APP_PORT:-8080}`，默认是 `http://127.0.0.1:8080`
- 首次设置：`http://127.0.0.1:8080/setup`
- 健康检查：`http://127.0.0.1:${APP_PORT:-8080}/api/health`

## 第一次使用

1. 打开 `/setup` 创建首次管理员，密码长度为 8–128 个字符。
2. 使用管理员账号登录。
3. 按引导进入“系统配置 → AI 与工作流配置”。
4. 配置所需的 AI 服务并测试连接。
5. 创建项目、上传视频并开始拆解。

首次管理员创建后，设置入口会永久关闭。已有用户直接从登录页进入系统。

## 配置 AI 服务

文本生成服务支持 OpenAI、Gemini、DeepSeek、阿里云百炼/通义千问、智谱 GLM、火山方舟/豆包、Mistral、Ollama 和自定义 OpenAI-compatible 服务。

视频解析与角色图谱仍使用 Gemini。只浏览界面时 Gemini 可以暂不配置，但执行对应 AI 任务前必须提供有效配置。

管理员可以在“系统配置 → AI 与工作流配置”中填写服务商、模型、密钥和 `API Base URL`。密钥保存后只写不回显。远程服务地址必须使用 HTTPS；本地开发的 `localhost`、`127.0.0.1` 或 `::1` 可以使用 HTTP。

Docker 或主机部署也可以使用环境变量：

```dotenv
GEMINI_API_KEY=
GEMINI_DEFAULT_MODEL=
AI_PROVIDER_TIMEOUT_MS=180000
```

服务商模型与地区可用性可能变化，请按实际账号和服务商文档选择。第三方服务的费用、内容政策和数据处理规则由部署者自行确认。

## 支持的文件

- 视频：`.mp4`、`.mov`、`.avi`、`.mkv`
- 知识库：`.docx`、`.txt`

## 常用命令

```powershell
# 停止服务并保留数据
npm run docker:down

# 使用现有配置重新启动
npm run docker:up

# 查看服务日志
npm run docker:logs
```

再次执行 `npm run quickstart` 会复用现有 `.env` 配置，不会覆盖已经生成的本地凭据。

下面的命令会销毁数据卷并删除全部本地数据：

```powershell
npm run docker:reset
```

该操作无法通过应用恢复，请仅在确定不需要保留本地数据时使用。

## 自定义应用端口

默认端口无需修改即可使用。更改应用端口时，必须同步配置允许的访问来源：

```dotenv
APP_PORT=8081
ALLOWED_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
```

随后通过 `http://127.0.0.1:8081` 访问应用。

数据库、对象存储、HTTPS 和生产环境配置见 [部署指南](docs/DEPLOYMENT.md)。

## 本地开发

主机开发需要 Node.js 22.15+、npm 10+、Python 3.12、MySQL 8.4 和 S3 兼容对象存储。

```powershell
npm ci
npm ci --prefix server
npm ci --prefix client
python -m venv server/python_services/.venv
server/python_services/.venv/Scripts/python.exe -m pip install -r server/python_services/requirements.txt
npm run migrate
npm run dev
```

提交改动前可运行：

```powershell
npm test
npm run build
npm run audit:all
```

## 更多文档

- [部署指南](docs/DEPLOYMENT.md)
- [API 文档](docs/API.md)
- [API 中继说明](docs/API_RELAY_COMPLIANCE.md)
- [贡献指南](CONTRIBUTING.md)
- [安全报告方式](SECURITY.md)

代码采用 [MIT License](LICENSE)。
