# 数据库设计文档

## 📊 数据库概览

### 连接信息
- **数据库类型**: MySQL 8.0+
- **数据库名**: `jcc_factory`
- **字符集**: `utf8mb4_unicode_ci`
- **连接池**: 10个连接

### 数据库架构

#### 核心表结构
```sql
-- 用户表 (users)
- 用户认证和权限管理
- 角色系统：admin, user
- 权限系统：personal, readonly_global, global

-- 项目表 (projects)
- 项目管理核心表
- 支持视频和小说两种类型
- 跟踪项目状态和操作历史

-- 文件表 (files)
- 文件上传和存储管理
- 支持多种媒体类型
- 自动生成缩略图
```

#### 新增工作流表
```sql
-- 剧本单元表 (script_units)
- 多步骤工作流管理
- 角色图谱生成
- 内容整合流程

-- 完整剧本表 (full_scripts)
- 完整剧本生成
- 三步骤审核流程
- 内容归档管理
```

#### 知识库系统
```sql
-- 知识库表 (knowledge_base)
- 文档管理和存储
- 全文搜索支持
- 标签系统集成

-- 标签表 (tags)
- 多彩标签系统
- 用户级别隔离
```

#### AI处理系统
```sql
-- AI任务表 (ai_tasks)
- AI处理任务管理
- 状态跟踪和错误处理
- 性能监控

-- 系统配置表 (system_config)
- 系统参数管理
- Gemini模型配置
- 代理服务配置
```

## 🔧 数据库优化

### 索引策略
- 主键自动索引
- 外键约束索引
- 查询优化复合索引
- 全文搜索索引

### 性能监控
- 连接池监控
- 查询性能分析
- 存储空间管理

## 🔄 数据库迁移

### 迁移文件位置
`server/database/migrations/`

### 迁移脚本
- `database-character-model.sql` - 角色模型扩展
- `database-character-integration.sql` - 角色整合功能
- `database-full-scripts.sql` - 完整剧本系统
- `database-script-units.sql` - 剧本单元系统
- `database-refactor.sql` - 数据库重构
- `database-upgrade.sql` - 系统升级

## 📈 数据统计 (当前)

- **用户数量**: 3
- **项目数量**: 2
- **文件数量**: 114
- **AI任务数量**: 490

## 🔐 备份策略

### 建议备份频率
- **每日备份**: 数据库完整备份
- **实时备份**: 二进制日志备份
- **每周备份**: 结构备份

### 备份命令
```bash
# 完整备份
mysqldump -u root -p jcc_factory > backup_$(date +%Y%m%d).sql

# 仅结构备份
mysqldump -u root -p --no-data jcc_factory > structure_$(date +%Y%m%d).sql
```

## 🛡️ 安全配置

### 用户权限
- 最小权限原则
- 角色分离
- 定期密码更新

### 网络安全
- 防火墙配置
- SSL/TLS加密
- IP访问限制

---

*最后更新: v2.1.0 - 数据库审核完成*
