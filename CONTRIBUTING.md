# Contributing to JCC Factory

感谢参与 JCC Factory 开发。普通安装和使用方式请先阅读 [README](README.md)。

## 开始开发

按照 README 的“本地开发”章节安装依赖并准备运行环境。运行时配置保存在本地 `.env` 和 `server/.env`，不要提交这些文件或其中的凭据。

## 提交改动

- 从最新默认分支创建短期功能分支。
- 一个提交只表达一个清晰、可审查的意图。
- PR 说明问题、改动范围、配置或迁移影响，以及实际执行的验证命令。
- UI 变更提供不含敏感信息的截图。
- API、配置或部署行为变化时，同步更新相应文档。

安全漏洞不要通过公开 Issue 或 PR 报告，请遵循 [Security Policy](SECURITY.md)。

## 验证

提交前按改动范围运行：

```powershell
npm test
npm run build
npm run audit:all
git diff --check
```

涉及 Python 的改动还应使用 Python 3.12 完成语法或测试验证。没有运行的检查应明确说明，不要写成已经通过。

## 数据库迁移

- 新结构变更在 `server/database/migrations/` 中添加下一个三位编号的 SQL 文件。
- 已经执行的迁移不得修改、重排或复用编号。
- 不要手工修改 `schema_migrations`，也不要提交真实数据库导出或用户数据。

## 不要提交

- API key、密码、JWT、Cookie、私钥、`.env` 或真实用户数据
- `node_modules/`、虚拟环境、构建产物、日志和编辑器缓存
- 未获授权的客户信息、内部域名、基础设施地址或截图

项目采用 MIT License。提交贡献即表示你有权提供相应内容，并同意其按该许可证分发。
