import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Spin, Alert, Button, Space } from 'antd';
import { DownloadOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { knowledgeBaseAPI } from '../services/api';
import { formatContentAsHtmlEnhanced } from '../utils/markdownFormatter';
import { sanitizeRenderedHtml } from '../utils/htmlSecurity';

// 共享缓存（与编辑器组件共享）
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

const KnowledgeCanvasPreview = ({ 
  item,
  loading: externalLoading = false,
  onEdit,
  hideHeader = false
}) => {
  const [documentContent, setDocumentContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debounceTimer = useRef(null);

  // 优化的内容加载函数
  const loadContent = useCallback(async () => {
    if (!item?.id) {
      setLoading(false);
      return;
    }

    const contentCache = getSharedCache();
    const pendingRequests = getSharedPendingRequests();
    
    setLoading(true);
    setError(null);
    
    // 检查缓存
    const cacheKey = `doc_${item.id}`;
    if (contentCache.has(cacheKey)) {
      console.log(`📋 预览从缓存获取文档内容，ID: ${item.id}`);
      setDocumentContent(contentCache.get(cacheKey));
      setLoading(false);
      return;
    }

    // 检查是否有正在进行的请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`⏳ 预览等待正在进行的请求，ID: ${item.id}`);
      try {
        const content = await pendingRequests.get(cacheKey);
        setDocumentContent(content);
      } catch (error) {
        handlePreviewError(error);
      } finally {
        setLoading(false);
      }
      return;
    }

    // 创建请求Promise并缓存
    const requestPromise = (async () => {
      try {
        console.log(`👀 正在加载预览内容，ID: ${item.id}`);
        const contentResponse = await knowledgeBaseAPI.getContent(item.id);
        
        // 处理不同类型的内容
        let content = '';
        if (typeof contentResponse.content === 'string') {
          content = contentResponse.content;
        } else if (contentResponse.content && typeof contentResponse.content === 'object') {
          // 如果返回的是对象，尝试提取文本内容
          content = contentResponse.content.text || contentResponse.content.html || JSON.stringify(contentResponse.content, null, 2);
        } else {
          content = '暂无内容';
        }
        
        // 缓存内容
        contentCache.set(cacheKey, content);
        console.log('✅ 预览内容加载成功并已缓存');
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
    } catch (error) {
      console.error('加载预览内容失败:', error);
      handlePreviewError(error);
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
    }, 50); // 预览组件响应更快

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [loadContent]);

  // 添加自定义事件监听器，用于强制刷新预览内容（修复：解决缓存问题）
  useEffect(() => {
    const handleForceReload = () => {
      const contentCache = getSharedCache();
      const cacheKey = `doc_${item?.id}`;
      // 清除缓存，强制重新加载
      contentCache.delete(cacheKey);
      loadContent();
    };

    window.addEventListener('forceReloadPreview', handleForceReload);
    return () => {
      window.removeEventListener('forceReloadPreview', handleForceReload);
    };
  }, [item?.id, loadContent]);

  // 处理预览错误
  const handlePreviewError = (error) => {
    let errorInfo = {
      type: 'error',
      title: '预览加载失败',
      message: '无法加载文档预览内容'
    };
    
    if (error.response?.data?.error_type === 'FILE_CORRUPTED') {
      errorInfo = {
        type: 'error',
        title: '文件损坏',
        message: '文件已损坏，无法预览。建议重新上传此文件。'
      };
    } else if (error.response?.data?.error_type === 'FILE_INCOMPLETE') {
      errorInfo = {
        type: 'warning',
        title: '文件不完整',
        message: '文件不完整或已损坏，无法预览。建议重新上传此文件。'
      };
    } else if (error.response?.data?.error_type === 'FILE_NOT_FOUND') {
      errorInfo = {
        type: 'info',
        title: '文件不存在',
        message: '文件在服务器上不存在，无法预览。'
      };
    } else if (error.response?.status === 401) {
      errorInfo = {
        type: 'error',
        title: '认证失败',
        message: '权限不足，无法访问此文件。'
      };
    } else if (error.response?.status >= 500) {
      errorInfo = {
        type: 'error',
        title: '服务器错误',
        message: '服务器暂时不可用，请稍后重试。'
      };
    }
    
    setError(errorInfo);
    setDocumentContent('');
  };

  // 使用统一的增强格式化函数（修复：格式一致性问题）

  // 重新加载
  const handleReload = () => {
    setError(null);
    setLoading(true);
    
    // 强制重新加载内容
    const loadContent = async () => {
      if (!item?.id) {
        setLoading(false);
        return;
      }
      
      try {
        console.log(`🔄 手动重新加载预览内容，ID: ${item.id}`);
        const contentResponse = await knowledgeBaseAPI.getContent(item.id);
        
        // 处理不同类型的内容
        let content = '';
        if (typeof contentResponse.content === 'string') {
          content = contentResponse.content;
        } else if (contentResponse.content && typeof contentResponse.content === 'object') {
          content = contentResponse.content.text || contentResponse.content.html || JSON.stringify(contentResponse.content, null, 2);
        } else {
          content = '暂无内容';
        }
        
        setDocumentContent(content);
        console.log('✅ 手动重新加载成功');
      } catch (error) {
        console.error('手动重新加载失败:', error);
        handlePreviewError(error);
      } finally {
        setLoading(false);
      }
    };
    
    loadContent();
  };

  // 下载文件
  const handleDownload = () => {
    if (item?.id) {
      const downloadUrl = `/api/knowledge-base/${item.id}/download`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = item.title || `document_${item.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  if (loading || externalLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px' 
      }}>
        <Spin size="large" tip="加载预览中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px' }}>
        <Alert
          type={error.type}
          message={error.title}
          description={error.message}
          showIcon
          action={
            <Space>
              <Button size="small" onClick={handleReload} icon={<ReloadOutlined />}>
                重新加载
              </Button>
              {onEdit && (
                <Button size="small" type="primary" onClick={onEdit} icon={<EditOutlined />}>
                  编辑文档
                </Button>
              )}
            </Space>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* 预览操作栏 - 仅在不隐藏头部时显示 */}
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
            <strong>预览文档：{item?.title}</strong>
            <span style={{ color: '#999', marginLeft: '8px', fontSize: '12px' }}>
              只读模式
            </span>
          </div>
          <Space>
            <Button 
              icon={<ReloadOutlined />} 
              onClick={handleReload}
              size="small"
            >
              刷新
            </Button>
            <Button 
              icon={<DownloadOutlined />} 
              onClick={handleDownload}
              size="small"
            >
              下载
            </Button>
            {onEdit && (
              <Button 
                type="primary" 
                icon={<EditOutlined />} 
                onClick={onEdit}
                size="small"
              >
                编辑
              </Button>
            )}
          </Space>
        </div>
      )}

      {/* 预览内容区域 */}
      <div style={{ 
        padding: '24px',
        backgroundColor: '#ffffff',
        minHeight: '500px',
        maxHeight: '70vh',
        overflow: 'auto',
        borderRadius: hideHeader ? '8px' : '0 0 8px 8px',
        border: hideHeader ? 'none' : '1px solid #d9d9d9',
        borderTop: hideHeader ? 'none' : 'none'
      }}>
        <div 
          style={{ 
            minHeight: '400px',
            fontSize: '14px',
            lineHeight: '1.6',
            fontFamily: '"Microsoft YaHei", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif'
          }}
          dangerouslySetInnerHTML={{ 
            __html: sanitizeRenderedHtml(formatContentAsHtmlEnhanced(documentContent))
          }}
        />
      </div>

      {/* 预览信息 */}
      <div style={{ 
        padding: '8px 16px',
        backgroundColor: '#f6f8fa',
        borderRadius: '0 0 8px 8px',
        fontSize: '12px',
        color: '#666'
      }}>
        📖 预览模式 - 支持基础Markdown语法显示 | 
        文档大小：{documentContent ? `${Math.ceil(documentContent.length / 1024)} KB` : '未知'}
      </div>
    </div>
  );
};

export default KnowledgeCanvasPreview;
