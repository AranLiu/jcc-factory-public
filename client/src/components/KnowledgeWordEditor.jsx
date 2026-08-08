import React, { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Button, Space, message, Spin, Alert, Input } from 'antd';
import { SaveOutlined, CloseOutlined, EyeOutlined, EditOutlined } from '@ant-design/icons';
import { knowledgeBaseAPI } from '../services/api';
import { formatContentAsHtmlSimple } from '../utils/markdownFormatter';
import { sanitizeRenderedHtml } from '../utils/htmlSecurity';

const { TextArea } = Input;

// 共享缓存（与预览组件共享）
const getSharedCache = () => {
  if (!window.documentContentCache) {
    window.documentContentCache = new Map();
  }
  return window.documentContentCache;
};

const getSharedPendingRequests = () => {
  if (!window.documentPendingRequests) {
    window.documentPendingRequests = new Map();
  }
  return window.documentPendingRequests;
};

const KnowledgeWordEditor = forwardRef(({ 
  item,
  onSave,
  onCancel,
  loading: externalLoading = false,
  hideHeader = false
}, ref) => {
  const [documentContent, setDocumentContent] = useState('');
  const [originalContent, setOriginalContent] = useState(''); // 记录原始内容
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
  const textAreaRef = useRef(null);

  // 自动保存定时器
  const autoSaveTimer = useRef(null);
  // 防抖定时器
  const debounceTimer = useRef(null);

  // 确保每次打开文档都是预览模式（仅在独立使用时，不在UnifiedDocumentModal中使用时）
  useEffect(() => {
    // 如果hideHeader为true，说明是在UnifiedDocumentModal中使用，应该是编辑模式
    if (hideHeader) {
      setPreviewMode(false); // 在统一模态框中时，编辑组件应该是编辑模式
    } else {
      setPreviewMode(true); // 独立使用时，默认预览模式
    }
  }, [item?.id, hideHeader]);

  // 优化的内容加载函数
  const loadContent = useCallback(async () => {
    if (!item?.id) {
      setLoading(false);
      return;
    }

    const contentCache = getSharedCache();
    const pendingRequests = getSharedPendingRequests();

    // 检查缓存
    const cacheKey = `doc_${item.id}`;
    if (contentCache.has(cacheKey)) {
      console.log(`📋 编辑器从缓存获取文档内容，ID: ${item.id}`);
      setDocumentContent(contentCache.get(cacheKey));
      setHasChanges(false);
      setLoading(false);
      return;
    }

    // 检查是否有正在进行的请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`⏳ 编辑器等待正在进行的请求，ID: ${item.id}`);
      try {
        const content = await pendingRequests.get(cacheKey);
        setDocumentContent(content);
        setHasChanges(false);
      } catch (error) {
        handleLoadError(error);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    
    // 创建请求Promise并缓存
    const requestPromise = (async () => {
      try {
        console.log(`📖 正在加载文档内容，ID: ${item.id}`);
        const contentResponse = await knowledgeBaseAPI.getContent(item.id);
        
        // 处理不同类型的内容
        let content = '';
        if (typeof contentResponse.content === 'string') {
          content = contentResponse.content;
        } else if (contentResponse.content && typeof contentResponse.content === 'object') {
          // 如果返回的是对象，尝试提取文本内容
          content = contentResponse.content.text || contentResponse.content.html || JSON.stringify(contentResponse.content, null, 2);
        } else {
          content = '开始编辑您的文档...';
        }
        
        // 缓存内容（只缓存已保存的内容）
        contentCache.set(cacheKey, content);
        console.log('✅ 文档内容加载成功并已缓存');
        return content;
      } finally {
        // 清除请求缓存
        pendingRequests.delete(cacheKey);
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const content = await requestPromise;
      setDocumentContent(content);
      setOriginalContent(content); // 记录原始内容
      setHasChanges(false);
    } catch (error) {
      console.error('加载文档内容失败:', error);
      handleLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [item?.id]);

  // 加载文档内容
  useEffect(() => {
    // 清除之前的防抖定时器
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // 使用防抖避免快速切换文档时的重复请求
    debounceTimer.current = setTimeout(() => {
      loadContent();
    }, 100);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [loadContent]);

  // 处理加载错误
  const handleLoadError = (error) => {
    let errorMessage = '无法加载原文档内容，您可以重新编辑';
    let defaultContent = '开始编辑您的文档...';
    
    if (error.response?.data?.error_type === 'FILE_CORRUPTED') {
      errorMessage = '原文档已损坏，无法加载内容。建议重新上传文件或从空白文档开始编辑。';
      defaultContent = '⚠️ 原文档已损坏，无法加载\n\n您可以从这里开始重新编辑文档内容...';
      message.error('文件已损坏，建议重新上传');
    } else if (error.response?.data?.error_type === 'FILE_INCOMPLETE') {
      errorMessage = '原文档不完整或已损坏，无法加载内容。建议重新上传文件或从空白文档开始编辑。';
      defaultContent = '⚠️ 原文档不完整或已损坏\n\n您可以从这里开始重新编辑文档内容...';
      message.error('文件不完整或已损坏，建议重新上传');
    } else if (error.response?.data?.error_type === 'FILE_NOT_FOUND') {
      errorMessage = '原文档在服务器上不存在，您可以从空白文档开始编辑。';
      defaultContent = '⚠️ 原文档文件不存在\n\n您可以从这里开始编辑新的文档内容...';
      message.warning('原文档文件不存在');
    }
    
    setDocumentContent(defaultContent);
    setOriginalContent(defaultContent); // 设置原始内容
    message.warning(errorMessage);
  };

  // 文档内容变化处理
  const handleContentChange = useCallback((e) => {
    const newContent = e.target.value;
    setDocumentContent(newContent);
    setHasChanges(newContent !== originalContent);
    
    // 注意：编辑过程中不更新缓存，只有保存后才更新缓存
    // 这样可以确保未保存的更改不会被持久化
    
    // 重置自动保存定时器
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }
    
    // 设置5秒后自动保存
    autoSaveTimer.current = setTimeout(() => {
      handleAutoSave(newContent);
    }, 5000);
  }, [item.id, originalContent]);

  // 自动保存
  const handleAutoSave = async (content) => {
    if (!hasChanges || !content.trim()) return;
    
    try {
      await knowledgeBaseAPI.updateContent(item.id, content);
      
      // 自动保存成功后更新原始内容和缓存
      setOriginalContent(content);
      setHasChanges(false);
      
      // 更新缓存（只有保存成功才更新）
      const contentCache = getSharedCache();
      const cacheKey = `doc_${item.id}`;
      contentCache.set(cacheKey, content);
      
      console.log('📝 文档已自动保存并更新缓存');
      
      // 触发预览组件刷新（修复：自动保存也需要刷新预览）
      window.dispatchEvent(new CustomEvent('forceReloadPreview'));
    } catch (error) {
      console.warn('自动保存失败:', error);
    }
  };

  // 手动保存
  const handleSave = async () => {
    if (!documentContent.trim()) {
      message.warning('文档内容不能为空');
      return;
    }

    // 清理自动保存定时器，避免重复保存
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }

    setSaving(true);
    try {
      await knowledgeBaseAPI.updateContent(item.id, documentContent);
      
      // 手动保存成功后更新原始内容和缓存
      setOriginalContent(documentContent);
      setHasChanges(false);
      
      // 更新缓存（只有保存成功才更新）
      const contentCache = getSharedCache();
      const cacheKey = `doc_${item.id}`;
      contentCache.set(cacheKey, documentContent);
      
      // 无论在哪种模式下都显示保存成功提示（统一由KnowledgeWordEditor处理）
      message.success('文档保存成功');
      
      // 触发预览组件刷新（修复：解决预览缓存问题）
      window.dispatchEvent(new CustomEvent('forceReloadPreview'));
      
      // 只有在不是通过 hideHeader（即不在UnifiedDocumentModal中）时才调用onSave回调
      // 避免与UnifiedDocumentModal形成循环调用
      if (!hideHeader && onSave) {
        onSave();
      }
    } catch (error) {
      console.error('保存失败:', error);
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // 处理取消操作
  const handleCancel = () => {
    if (hasChanges) {
      // 如果有未保存的更改，询问用户
      if (window.confirm('您有未保存的更改，确定要取消吗？未保存的内容将丢失。')) {
        // 恢复原始内容
        setDocumentContent(originalContent);
        setHasChanges(false);
        
        // 清除自动保存定时器
        if (autoSaveTimer.current) {
          clearTimeout(autoSaveTimer.current);
          autoSaveTimer.current = null;
        }
        
        console.log('🔄 已恢复到原始内容');
        
        // 调用父组件的取消回调
        if (onCancel) {
          onCancel();
        }
      }
    } else {
      // 没有更改，直接取消
      if (onCancel) {
        onCancel();
      }
    }
  };

  // 切换预览模式
  const togglePreviewMode = () => {
    setPreviewMode(!previewMode);
  };

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    handleSave
  }));

  // 清理定时器和缓存
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  if (loading || externalLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px' 
      }}>
        <Spin size="large" tip="加载文档中..." />
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* 操作按钮栏 - 仅在不隐藏头部时显示 */}
      {!hideHeader && (
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
            <strong>编辑文档：{item?.title}</strong>
            {hasChanges && (
              <span style={{ color: '#faad14', marginLeft: '8px', fontSize: '12px' }}>
                ● 有未保存的更改
              </span>
            )}
          </div>
          <Space>
            <Button 
              icon={previewMode ? <EditOutlined /> : <EyeOutlined />} 
              onClick={togglePreviewMode}
              type={previewMode ? 'primary' : 'default'}
            >
              {previewMode ? '编辑' : '预览'}
            </Button>
            <Button 
              type="primary" 
              icon={<SaveOutlined />} 
              loading={saving}
              onClick={handleSave}
              disabled={!hasChanges}
            >
              保存
            </Button>
            <Button 
              icon={<CloseOutlined />} 
              onClick={handleCancel}
            >
              关闭
            </Button>
          </Space>
        </div>
      )}

      {/* 编辑器内容区域 */}
      <div style={{ 
        padding: '16px',
        backgroundColor: '#ffffff',
        minHeight: '500px',
        borderRadius: hideHeader ? '8px' : '0 0 8px 8px',
        border: hideHeader ? 'none' : '1px solid #d9d9d9',
        borderTop: hideHeader ? 'none' : 'none'
      }}>
        {previewMode ? (
          // 预览模式
          <div 
            style={{ 
              minHeight: '400px',
              padding: '20px',
              backgroundColor: '#fafafa',
              borderRadius: '6px',
              border: '1px solid #e8e8e8'
            }}
            dangerouslySetInnerHTML={{ 
              __html: sanitizeRenderedHtml(formatContentAsHtmlSimple(documentContent))
            }}
          />
        ) : (
          // 编辑模式
          <div>
            <TextArea
              ref={textAreaRef}
              value={documentContent}
              onChange={handleContentChange}
              placeholder="开始编辑您的文档内容..."
              style={{
                minHeight: '450px',
                fontSize: '14px',
                lineHeight: '1.6',
                fontFamily: '"Microsoft YaHei", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif'
              }}
              showCount
              maxLength={300000}
            />
          </div>
        )}
      </div>

      {/* 帮助信息 */}
      <div style={{ 
        padding: '8px 16px',
        backgroundColor: '#f6f8fa',
        borderRadius: '0 0 8px 8px',
        fontSize: '12px',
        color: '#666'
      }}>
        💡 支持自动保存，修改后5秒自动保存一次 | 
        使用 Ctrl+S 快速保存 | 
        支持基础Markdown语法
      </div>
    </div>
  );
});

export default KnowledgeWordEditor;
