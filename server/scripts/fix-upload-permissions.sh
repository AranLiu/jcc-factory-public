#!/bin/bash

# JCC Factory - 上传目录权限修复脚本
# 此脚本用于修复因权限问题导致的文件上传错误

echo "🔧 开始修复JCC Factory上传目录权限..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
UPLOADS_DIR="$PROJECT_ROOT/uploads"

# 检查uploads目录是否存在
if [ ! -d "$UPLOADS_DIR" ]; then
    echo "❌ uploads目录不存在: $UPLOADS_DIR"
    exit 1
fi

echo "📁 检查目录: $UPLOADS_DIR"

# 查找所有非devbox用户拥有的文件
NON_DEVBOX_FILES=$(find "$UPLOADS_DIR" -not -user devbox 2>/dev/null | wc -l)

if [ "$NON_DEVBOX_FILES" -eq 0 ]; then
    echo "✅ 所有文件权限正常，无需修复"
else
    echo "⚠️  发现 $NON_DEVBOX_FILES 个文件/目录权限异常"
    echo "📋 异常文件列表:"
    find "$UPLOADS_DIR" -not -user devbox -exec ls -la {} \;
    
    echo ""
    echo "🔧 开始修复权限..."
    
    # 修复权限
    if sudo chown -R devbox:devbox "$UPLOADS_DIR"; then
        echo "✅ 权限修复成功"
        
        # 设置正确的目录权限
        find "$UPLOADS_DIR" -type d -exec chmod 755 {} \;
        # 设置正确的文件权限  
        find "$UPLOADS_DIR" -type f -exec chmod 644 {} \;
        
        echo "✅ 权限设置完成"
    else
        echo "❌ 权限修复失败，请检查sudo权限"
        exit 1
    fi
fi

echo "🎉 权限修复完成！"

# 提供使用建议
echo ""
echo "💡 使用建议:"
echo "1. 定期运行此脚本检查权限: bash scripts/fix-upload-permissions.sh"
echo "2. 确保应用程序始终以devbox用户身份运行"
echo "3. 避免以root用户身份运行应用程序"
echo "" 