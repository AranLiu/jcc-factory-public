import React, { useState, useRef, useEffect } from 'react';
import { Button, Space, message } from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import KnowledgeCanvasPreview from './KnowledgeCanvasPreview';
import KnowledgeWordEditor from './KnowledgeWordEditor';

const UnifiedDocumentModal = ({ 
  item, 
  onSave, 
  onCancel 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef(null);
  const { user } = useAuth();

  // 确保每次打开文档都是预览模式
  useEffect(() => {
    setIsEditing(false);
  }, [item?.id]);

  // 权限检查逻辑
  const canEdit = () => {
    if (!user || !item) return false;
    
    // 管理员总是可以编辑
    if (user.role === 'admin') return true;
    
    // 全局权限用户总是可以编辑
    if (user.permission === 'global') return true;
    
    // 个人权限用户只能编辑自己的文档
    if (user.permission === 'personal') {
      return Number(item.user_id) === Number(user.id);
    }
    
    // readonly_global权限用户只能编辑自己创建的文档
    if (user.permission === 'readonly_global') {
      return Number(item.user_id) === Number(user.id);
    }
    
    return false;
  };

  const isEditAllowed = canEdit();

  const handleStartEdit = () => {
    if (!isEditAllowed) {
      message.warning('您没有编辑此文档的权限');
      return;
    }
    setIsEditing(true);
  };

  const handleSave = async () => {
    // 触发编辑器内部的保存逻辑
    if (editorRef.current && editorRef.current.handleSave) {
      try {
        await editorRef.current.handleSave();
        // 保存成功后回到预览模式，不关闭模态框
        setIsEditing(false);
        // 调用父组件的保存回调
        if (onSave) {
          onSave();
        }
      } catch (error) {
        console.error('保存失败:', error);
        // 保存失败时不切换模式
      }
    }
  };

  const handleCancel = () => {
    if (isEditing) {
      // 如果在编辑模式，取消编辑回到预览模式
      setIsEditing(false);
    } else {
      // 如果在预览模式，关闭整个模态框
      onCancel();
    }
  };

  // 自定义头部操作按钮
  const renderHeaderActions = () => (
    <Space>
      {!isEditing && (
        <Button
          type="primary"
          icon={<EditOutlined />}
          onClick={handleStartEdit}
          disabled={!isEditAllowed}
          style={{
            backgroundColor: !isEditAllowed ? '#f5f5f5' : undefined,
            borderColor: !isEditAllowed ? '#d9d9d9' : undefined,
            color: !isEditAllowed ? '#bfbfbf' : undefined
          }}
        >
          编辑
        </Button>
      )}
      {isEditing && (
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
        >
          保存
        </Button>
      )}
      <Button
        icon={<CloseOutlined />}
        onClick={handleCancel}
        danger={isEditing}
      >
        {isEditing ? '取消' : '关闭'}
      </Button>
    </Space>
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* 自定义头部 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '12px 16px',
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #d9d9d9',
        borderRadius: '8px 8px 0 0'
      }}>
        <div>
          <strong>{isEditing ? '编辑文档' : '预览文档'}：{item?.title}</strong>
          <span style={{ color: '#999', marginLeft: '8px', fontSize: '12px' }}>
            {isEditing ? '编辑模式' : '只读模式'}
          </span>
          {!isEditAllowed && !isEditing && (
            <span style={{ color: '#ff7875', marginLeft: '8px', fontSize: '12px' }}>
              （只读权限）
            </span>
          )}
        </div>
        {renderHeaderActions()}
      </div>

      {/* 内容区域 */}
      <div style={{ 
        backgroundColor: '#ffffff',
        minHeight: '500px',
        maxHeight: '70vh',
        overflow: 'hidden'
      }}>
        {!isEditing && (
          <KnowledgeCanvasPreview
            item={item}
            onEdit={isEditAllowed ? handleStartEdit : null}
            hideHeader={true} // 隐藏预览组件自己的头部
          />
        )}
        
        {isEditing && (
          <KnowledgeWordEditor
            ref={editorRef}
            item={item}
            onSave={handleSave}
            onCancel={handleCancel}
            hideHeader={true} // 隐藏编辑组件自己的头部
          />
        )}
      </div>
    </div>
  );
};

export default UnifiedDocumentModal; 