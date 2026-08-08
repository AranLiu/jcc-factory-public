# 开源发布清单

本清单把仓库内可完成的工程证据与必须由外部负责人完成的操作分开。勾选仓库检查不能替代撤销凭据、真实环境演练或公开授权。

## 仓库内可完成

- [ ] `LICENSE`、`SECURITY.md`、`CONTRIBUTING.md`、README、部署/API 文档和包元数据相互一致。
- [ ] `npm test`、`npm run build`、`npm run audit:all` 全部通过并保存日期、提交 ID 与完整退出码。
- [ ] `git diff --check`、JSON 解析、文档命令/链接检查通过。
- [ ] 扫描 tracked files，确认没有专有域名、真实凭据、用户数据、构建产物、虚拟环境或本地 `.env`。
- [ ] 使用 gitleaks 扫描当前工作树和当前内部历史；对每个发现分类、撤销或记录误报依据。
- [ ] 生成候选公开制品，记录文件清单与 SHA-256；在候选目录重新运行测试、构建、依赖审计和 gitleaks。
- [ ] 记录哪些验证实际完成，哪些因外部环境未完成；不得用单元测试替代 Docker、Gemini 或数据恢复证据。

建议证据命令（不要在输出中打印 `.env`）：

```powershell
npm test
npm run build
npm run audit:all
gitleaks dir --no-banner .
gitleaks git --no-banner .
git diff --check
git ls-files
git rev-parse HEAD
```

## 外部负责人必须完成

以下均为当前发布阻断项：

- [ ] 在各服务提供方撤销/轮换历史 Gemini、数据库、MinIO、JWT、初始管理员凭据。
- [ ] 对每个旧值验证所有共享服务、备份恢复环境和自动化账户都不再接受它；只保存状态/时间/负责人证据，不保存秘密正文。
- [ ] 使用脱敏副本验证真实 legacy MySQL 8 数据库的迁移、备份与 restore，包含登录、权限、对象引用、队列和 `schema_migrations` 校验。
- [ ] 在具备 Docker 的隔离环境运行 Docker Compose build、start、health 和 e2e；验证首次登录、重跑、停止、日志与数据保留/重置行为。
- [ ] 使用专用测试项目和最小权限 key 验证真实 Gemini 调用与当前 `GEMINI_DEFAULT_MODEL` 可用性；随后按策略轮换测试 key。
- [ ] 完成 SeaweedFS/S3 服务的许可、运营、升级与兼容性评估。
- [ ] 仓库所有者书面批准候选内容、证据包、公开仓库地址和默认分支切换/发布时点。

## 非破坏的 clean snapshot / new repository 流程

当前 Git 历史未经批准用于公开发布。不要在本任务或发布准备中重写历史、删除内部分支、force-push 或覆盖现有默认分支。使用独立目录与全新空仓库形成候选公开历史：

1. 在内部分支完成审查并提交，记录源提交 ID。
2. 用 `git archive` 从获批提交导出 clean snapshot 到工作树之外；不要复制 `.git`、`.env`、用户数据或未跟踪文件。
3. 解压到新的隔离目录，在该目录运行 `gitleaks dir`、测试、构建、审计和制品哈希检查。
4. 在隔离目录执行 `git init -b main` 创建单提交候选历史；提交前再次审查 `git status` 与 `git diff --cached`。
5. 对 candidate public history 运行 `gitleaks git`，并由第二位审查者核对文件清单、许可、NOTICE/第三方义务与证据边界。
6. 只有外部凭据/真实环境阻断项全部关闭且 owner 明确授权 default branch 后，才把候选推送到一个全新空公开仓库。若目标已有默认分支，停止并重新取得方案授权；不得强制推送。

示例仅供负责人审查，`<approved-commit>` 与目标路径/URL 必须显式填写：

```powershell
git archive --format=tar --output ..\jcc-factory-public.tar <approved-commit>
# 将 tar 解压到新的 jcc-factory-public-candidate 目录后，在该目录：
git init -b main
git add --all
git diff --cached --check
git commit -m "Initial open-source snapshot"
gitleaks dir --no-banner .
gitleaks git --no-banner .
```

这个过程不改变内部仓库的任何提交或引用。不要把内部 remote 复制到候选目录；最终 remote 与首次 push 必须由仓库所有者在授权后配置。

## 发布证据包与最终授权

证据包至少包含：源提交 ID、候选提交 ID、文件清单、制品 SHA-256、测试/构建/audit/gitleaks 退出码、Docker e2e 记录、legacy DB 恢复记录、Gemini 验证边界、第三方许可决定、凭据撤销确认和未解决风险。

发布负责人逐项签署后，仓库所有者必须明确授权：候选仓库、可见性、默认分支、首次推送者和发布时间。任何一项缺失即保持私有；不得以截止时间为由跳过撤销、真实环境验证或改用历史重写/force-push。
