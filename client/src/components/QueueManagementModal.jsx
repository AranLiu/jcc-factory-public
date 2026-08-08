import React, { useState, useEffect } from 'react';
import { 
  Modal, Card, Row, Col, Statistic, List, Avatar, 
  Tag, Button, Tabs, message, Popconfirm, Empty, Spin, Tooltip, Table, Badge, Space
} from 'antd';
import { 
  ReloadOutlined, DeleteOutlined, RedoOutlined, 
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, ExclamationCircleOutlined, PlayCircleOutlined,
  VideoCameraOutlined, ClearOutlined, PauseOutlined, CaretRightOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { secureFetch } from '../services/httpSecurity';

const QueueManagementModal = ({ visible, onClose }) => {
  const [queueData, setQueueData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('queue');
  const [operationLoading, setOperationLoading] = useState({});
  const [globalOperationLoading, setGlobalOperationLoading] = useState({});
  
  // 分页状态管理
  const [queuePagination, setQueuePagination] = useState({ current: 1, pageSize: 50 });
  const [completedPagination, setCompletedPagination] = useState({ current: 1, pageSize: 50 });
  const [failedPagination, setFailedPagination] = useState({ current: 1, pageSize: 50 });
  
  // 加载队列状态
  const loadQueueStatus = async () => {
    try {
      setLoading(true);
      const response = await secureFetch('/api/queue/status');

      if (!response.ok) {
        throw new Error('获取队列状态失败');
      }

      const data = await response.json();
      setQueueData(data);
    } catch (error) {
      console.error('获取队列状态失败:', error);
      message.error('获取队列状态失败');
    } finally {
      setLoading(false);
    }
  };
  
  // 删除任务
  const deleteTask = async (taskId) => {
    try {
      setOperationLoading(prev => ({ ...prev, [`delete_${taskId}`]: true }));
      
      const response = await secureFetch(`/api/queue/${taskId}`, { method: 'DELETE' });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '删除失败');
      }

      message.success('任务已删除');
      loadQueueStatus();
    } catch (error) {
      console.error('删除失败:', error);
      message.error(error.message || '删除失败');
    } finally {
      setOperationLoading(prev => ({ ...prev, [`delete_${taskId}`]: false }));
    }
  };

  // 一键清除所有已完成和失败的任务
  const clearAllTasks = async (type) => {
    try {
      setOperationLoading(prev => ({ ...prev, [`clear_${type}`]: true }));
      
      // 改为调用后端批量清理接口，清理全部，不受分页影响
      // 使用POST版本，兼容某些前端代理对DELETE的限制
      const endpoint = type === 'completed' ? '/api/queue/clear-completed' : '/api/queue/clear-failed';
      let response = await secureFetch(endpoint, { method: 'POST' });

      // 兼容后端不识别POST路由或代理不转发的情况，回退到DELETE接口
      if (response.status === 404) {
        const fallbackEndpoint = type === 'completed' ? '/api/queue/clear/completed' : '/api/queue/clear/failed';
        response = await secureFetch(fallbackEndpoint, { method: 'DELETE' });
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || '批量删除失败');
      }

      const result = await response.json().catch(() => ({}));
      message.success(result.message || `已清除所有${type === 'completed' ? '已完成' : '失败'}的任务`);
      loadQueueStatus();
    } catch (error) {
      console.error('批量删除失败:', error);
      message.error('批量删除失败');
    } finally {
      setOperationLoading(prev => ({ ...prev, [`clear_${type}`]: false }));
    }
  };
  
  // 重新加入队列
  const retryTask = async (taskId) => {
    try {
      setOperationLoading(prev => ({ ...prev, [`retry_${taskId}`]: true }));
      
      const response = await secureFetch(`/api/queue/${taskId}/retry`, { method: 'POST' });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '重新加入失败');
      }

      const result = await response.json();
      message.success(result.message);
      loadQueueStatus();
      
      // 切换到队列标签页
      setActiveTab('queue');
    } catch (error) {
      console.error('重新加入失败:', error);
      message.error(error.message || '重新加入失败');
    } finally {
      setOperationLoading(prev => ({ ...prev, [`retry_${taskId}`]: false }));
    }
  };

  // 全部暂停
  const pauseAllTasks = async () => {
    try {
      setGlobalOperationLoading(prev => ({ ...prev, pause: true }));
      
      const response = await secureFetch('/api/queue/global/pause', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pause: true })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '暂停失败');
      }

      message.success('已暂停所有队列任务');
      loadQueueStatus();
    } catch (error) {
      console.error('暂停失败:', error);
      message.error(error.message || '暂停失败');
    } finally {
      setGlobalOperationLoading(prev => ({ ...prev, pause: false }));
    }
  };

  // 全部开始
  const resumeAllTasks = async () => {
    try {
      setGlobalOperationLoading(prev => ({ ...prev, resume: true }));
      
      // 同时恢复处理器和将所有 paused 任务置为 pending
      const [resumeProcessorResp, bulkResumeResp] = await Promise.all([
        secureFetch('/api/queue/global/pause', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ pause: false })
        }),
        secureFetch('/api/queue/bulk/resume', { method: 'POST' })
      ]);

      if (!resumeProcessorResp.ok || !bulkResumeResp.ok) {
        const errorData = (!resumeProcessorResp.ok ? await resumeProcessorResp.json() : await bulkResumeResp.json());
        throw new Error(errorData.message || '开始失败');
      }

      message.success('已恢复所有队列任务');
      loadQueueStatus();
    } catch (error) {
      console.error('开始失败:', error);
      message.error(error.message || '开始失败');
    } finally {
      setGlobalOperationLoading(prev => ({ ...prev, resume: false }));
    }
  };

  // 全部删除
  const deleteAllTasks = async () => {
    try {
      setGlobalOperationLoading(prev => ({ ...prev, deleteAll: true }));
      
      // 首选POST（兼容反向代理），失败则回退到DELETE /clear
      let response = await secureFetch('/api/queue/clear-all', { method: 'POST' });

      if (response.status === 404) {
        response = await secureFetch('/api/queue/clear', { method: 'DELETE' });
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || '删除失败');
      }

      const result = await response.json().catch(() => ({}));
      message.success(result.message || '已删除所有队列任务');
      loadQueueStatus();
    } catch (error) {
      console.error('删除失败:', error);
      message.error(error.message || '删除失败');
    } finally {
      setGlobalOperationLoading(prev => ({ ...prev, deleteAll: false }));
    }
  };

  // 暂停单个任务
  const pauseTask = async (taskId) => {
    try {
      setOperationLoading(prev => ({ ...prev, [`pause_${taskId}`]: true }));
      
      const response = await secureFetch(`/api/queue/${taskId}/pause`, { method: 'POST' });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '暂停失败');
      }

      message.success('任务已暂停');
      loadQueueStatus();
    } catch (error) {
      console.error('暂停失败:', error);
      message.error(error.message || '暂停失败');
    } finally {
      setOperationLoading(prev => ({ ...prev, [`pause_${taskId}`]: false }));
    }
  };

  // 恢复单个任务
  const resumeTask = async (taskId) => {
    try {
      setOperationLoading(prev => ({ ...prev, [`resume_${taskId}`]: true }));
      
      const response = await secureFetch(`/api/queue/${taskId}/resume`, { method: 'POST' });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '恢复失败');
      }

      message.success('任务已恢复');
      loadQueueStatus();
    } catch (error) {
      console.error('恢复失败:', error);
      message.error(error.message || '恢复失败');
    } finally {
      setOperationLoading(prev => ({ ...prev, [`resume_${taskId}`]: false }));
    }
  };
  
  useEffect(() => {
    if (visible) {
      loadQueueStatus();
      const interval = setInterval(loadQueueStatus, 5000); // 每5秒刷新一次
      return () => clearInterval(interval);
    }
  }, [visible]);
  
  if (!queueData) {
    return (
      <Modal
        title="任务列表"
        open={visible}
        onCancel={onClose}
        width={900}
        footer={[
          <Button key="close" onClick={onClose}>
            关闭
          </Button>
        ]}
      >
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#666' }}>加载队列状态中...</div>
        </div>
      </Modal>
    );
  }

  const { statistics = {}, activeTasks = [], processingTasks = [], pausedTasks = [], currentTask, pendingTasks = [], failedTasks = [], completedTasks = [] } = queueData;
  
  // 简化调试日志，避免命名冲突
  console.log('🔍 前端接收到的队列数据:', {
    totalPending: pendingTasks.length,
    statistics
  });
  
  // 合并待处理和处理中的任务到队列标签（支持多并发processing）
  // 后端统一返回 activeTasks 优先使用，保证与徽标一致且不丢失
  const normalizedActive = (activeTasks && activeTasks.length > 0)
    ? activeTasks
    : [...(pausedTasks || []), ...((processingTasks && processingTasks.length > 0) ? processingTasks : (currentTask ? [currentTask] : [])), ...(pendingTasks || [])];
  const queueTasks = normalizedActive;

  // 计算正在进行的任务数量
  const activeTasksCount = queueTasks.filter(t => t.status === 'processing').length;

  // 获取统计数据
  const getStatValue = (key) => statistics[key] || 0;
  
  // 渲染模型配置信息
  const renderModelConfig = (modelConfig) => {
    if (!modelConfig) return '--';
    
    try {
      const config = typeof modelConfig === 'string' ? JSON.parse(modelConfig) : modelConfig;
      return `${config.model || '未知'}${config.temperature ? ` (${config.temperature})` : ''}`;
    } catch (e) {
      return '配置错误';
    }
  };

  // 表格列配置
  const getColumns = (type) => {
    const baseColumns = [
      {
        title: '文件',
        dataIndex: 'fileName',
        key: 'fileName',
        width: 200,
        render: (text, record) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <VideoCameraOutlined style={{ color: '#1890ff' }} />
            <span style={{ fontWeight: 500 }}>{text}</span>
          </div>
        ),
      },
      {
        title: '项目',
        dataIndex: 'projectName',
        key: 'projectName',
        width: 150,
        ellipsis: true,
      },
      {
        title: '模型',
        dataIndex: 'model_config',
        key: 'model_config',
        width: 120,
        render: renderModelConfig,
      },

    ];

    // 根据不同类型添加特定列
    if (type === 'queue') {
      baseColumns.push({
        title: '时间',
        key: 'time',
        width: 140,
        render: (_, record) => {
          if (record.id === currentTask?.id) {
            return dayjs(record.started_at).format('MM-DD HH:mm:ss');
          }
          return dayjs(record.created_at).format('MM-DD HH:mm:ss');
        },
      });
      baseColumns.push({
        title: '状态',
        key: 'task_status',
        width: 100,
        render: (_, record) => {
          if (record.status === 'processing') {
            return <Tag color="green">处理中</Tag>;
          }
          if (record.status === 'paused') {
            return <Tag color="orange">已暂停</Tag>;
          }
          if (record.status === 'pending') {
            return <Tag color="blue">等待中</Tag>;
          }
          return <Tag color="default">未知</Tag>;
        },
      });
    } else if (type === 'completed') {
      baseColumns.push({
        title: '完成时间',
        key: 'completed_time',
        width: 140,
        render: (_, record) => dayjs(record.completed_at || record.updated_at).format('MM-DD HH:mm:ss'),
      });
    } else if (type === 'failed') {
      baseColumns.push({
        title: '错误信息',
        dataIndex: 'error_message',
        key: 'error_message',
        width: 200,
        ellipsis: true,
        render: (text) => text || '未知错误',
      });
      baseColumns.push({
        title: '失败时间',
        key: 'failed_time',
        width: 140,
        render: (_, record) => dayjs(record.updated_at).format('MM-DD HH:mm:ss'),
      });
    }

    // 操作列
    baseColumns.push({
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, record) => {
        if (record.id === currentTask?.id) {
          return (
            <Tooltip title="正在处理中，无法操作">
              <Button size="small" disabled icon={<ClearOutlined />}>
                {type === 'queue' ? '删除任务' : '清除记录'}
              </Button>
            </Tooltip>
          );
        }

        const actions = [];
        
        if (type === 'queue') {
          // 队列任务的暂停/恢复按钮
          if (record.status === 'paused') {
            actions.push(
              <Button 
                key="resume"
                size="small" 
                type="link"
                icon={<CaretRightOutlined />}
                onClick={() => resumeTask(record.id)}
                loading={operationLoading[`resume_${record.id}`]}
                style={{ 
                  color: '#1677ff',
                  padding: '0',
                  height: 'auto',
                  marginRight: '8px'
                }}
              >
                开始
              </Button>
            );
          } else {
            actions.push(
              <Button 
                key="pause"
                size="small" 
                type="link"
                icon={<PauseOutlined />}
                onClick={() => pauseTask(record.id)}
                loading={operationLoading[`pause_${record.id}`]}
                style={{ 
                  color: '#1677ff',
                  padding: '0',
                  height: 'auto',
                  marginRight: '8px'
                }}
              >
                暂停
              </Button>
            );
          }
        }
        
        if (type === 'failed') {
          actions.push(
            <Button 
              key="retry"
              size="small" 
              type="link"
              icon={<RedoOutlined />}
              onClick={() => retryTask(record.id)}
              loading={operationLoading[`retry_${record.id}`]}
              style={{ 
                color: '#1677ff',
                padding: '0',
                height: 'auto',
                marginRight: '8px'
              }}
            >
              重试
            </Button>
          );
        }

        actions.push(
          <Popconfirm
            key="delete"
            title={type === 'queue' ? '确定要删除这个任务吗？' : '确定要清除这个任务记录吗？'}
            description={type === 'queue' ? '删除后无法恢复，请确认操作' : '清除后无法恢复，请确认操作'}
            onConfirm={() => deleteTask(record.id)}
            okText={type === 'queue' ? '确定删除' : '确定清除'}
            cancelText="取消"
            okType="danger"
          >
            <Button 
              size="small" 
              type="link"
              icon={<ClearOutlined />}
              loading={operationLoading[`delete_${record.id}`]}
              style={{ 
                color: '#1677ff',
                padding: '0',
                height: 'auto'
              }}
            >
              {type === 'queue' ? '删除任务' : '清除记录'}
            </Button>
          </Popconfirm>
        );

        return <Space size={4}>{actions}</Space>;
      },
    });

    return baseColumns;
  };

  
  return (
    <Modal
      title="任务列表"
      open={visible}
      onCancel={onClose}
      width={900}
      height={700}
      styles={{
        header: { 
          borderBottom: '1px solid #f0f0f0',
          paddingBottom: '8px'
        },
        body: { 
          padding: '16px 24px'
        }
      }}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>
      ]}
    >


      {/* 简化的标签页设计 */}
      <div style={{ 
        position: 'sticky', 
        top: 0, 
        zIndex: 10, 
        backgroundColor: '#fff',
        borderBottom: '1px solid #f0f0f0',
        marginBottom: '16px',
        marginTop: '-8px'
      }}>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          style={{ marginBottom: 0 }}
          items={[
          {
            key: 'queue',
            label: (
              <Badge 
                count={activeTasksCount} 
                size="small"
                style={{ backgroundColor: '#52c41a' }}
              >
                 进行中 ({queueTasks.length})
              </Badge>
            ),
            children: (
              <div>
                {queueTasks.length > 0 && (
                  <div style={{ marginBottom: '16px', textAlign: 'right' }}>
                    <Space size="small">
                      <Button 
                        type="text"
                        icon={<PauseOutlined />}
                        loading={globalOperationLoading.pause}
                        size="small"
                        style={{ 
                          color: '#1677ff',
                          padding: '0',
                          height: 'auto'
                        }}
                        onClick={pauseAllTasks}
                      >
                        全部暂停
                      </Button>
                      <Button 
                        type="text"
                        icon={<CaretRightOutlined />}
                        loading={globalOperationLoading.resume}
                        size="small"
                        style={{ 
                          color: '#1677ff',
                          padding: '0',
                          height: 'auto'
                        }}
                        onClick={resumeAllTasks}
                      >
                        全部开始
                      </Button>
                      <Popconfirm
                        title="确定要删除所有队列任务吗？"
                        description="删除后无法恢复，请确认操作"
                        onConfirm={deleteAllTasks}
                        okText="确定删除"
                        cancelText="取消"
                        okType="danger"
                      >
                        <Button 
                          type="text"
                          icon={<ClearOutlined />}
                          loading={globalOperationLoading.deleteAll}
                          size="small"
                          style={{ 
                            color: '#1677ff',
                            padding: '0',
                            height: 'auto'
                          }}
                        >
                          全部删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                )}
                <Table
                  dataSource={queueTasks}
                  columns={getColumns('queue')}
                  rowKey="id"
                  pagination={{
                    ...queuePagination,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                    pageSizeOptions: ['20', '50', '100', '200'],
                    onChange: (page, pageSize) => {
                      setQueuePagination({ current: page, pageSize });
                    },
                    onShowSizeChange: (current, size) => {
                      setQueuePagination({ current: 1, pageSize: size });
                    }
                  }}
                  size="small"
                  scroll={{ y: 500 }}
                  locale={{
                    emptyText: <Empty description="暂无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  }}
                  rowClassName={(record) => record.status === 'processing' ? 'processing-row' : ''}
                />
              </div>
            )
          },
          {
            key: 'completed',
            label: `已完成 (${completedTasks.length})`,
            children: (
              <div>
                {completedTasks.length > 0 && (
                  <div style={{ marginBottom: '16px', textAlign: 'right' }}>
                    <Popconfirm
                      title="确定要清除所有已完成的任务吗？"
                      description="清除后无法恢复，请确认操作"
                      onConfirm={() => clearAllTasks('completed')}
                      okText="确定清除"
                      cancelText="取消"
                      okType="danger"
                    >
                      <Button 
                        type="link"
                        icon={<ClearOutlined />}
                        loading={operationLoading.clear_completed}
                        size="small"
                        style={{ 
                          color: '#1677ff',
                          padding: '0',
                          height: 'auto'
                        }}
                      >
                        清空全部记录
                      </Button>
                    </Popconfirm>
                  </div>
                )}
                <Table
                  dataSource={completedTasks}
                  columns={getColumns('completed')}
                  rowKey="id"
                  pagination={{
                    ...completedPagination,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                    pageSizeOptions: ['20', '50', '100', '200'],
                    onChange: (page, pageSize) => {
                      setCompletedPagination({ current: page, pageSize });
                    },
                    onShowSizeChange: (current, size) => {
                      setCompletedPagination({ current: 1, pageSize: size });
                    }
                  }}
                  size="small"
                  scroll={{ y: 500 }}
                  locale={{
                    emptyText: <Empty description="暂无已完成任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  }}
                />
              </div>
            )
          },
          {
            key: 'failed',
            label: `失败 (${failedTasks.length})`,
            children: (
              <div>
                {failedTasks.length > 0 && (
                  <div style={{ marginBottom: '16px', textAlign: 'right' }}>
                    <Popconfirm
                      title="确定要清除所有失败的任务吗？"
                      description="清除后无法恢复，请确认操作"
                      onConfirm={() => clearAllTasks('failed')}
                      okText="确定清除"
                      cancelText="取消"
                      okType="danger"
                    >
                      <Button 
                        type="link"
                        icon={<ClearOutlined />}
                        loading={operationLoading.clear_failed}
                        size="small"
                        style={{ 
                          color: '#1677ff',
                          padding: '0',
                          height: 'auto'
                        }}
                      >
                        清空全部记录
                      </Button>
                    </Popconfirm>
                  </div>
                )}
                <Table
                  dataSource={failedTasks}
                  columns={getColumns('failed')}
                  rowKey="id"
                  pagination={{
                    ...failedPagination,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                    pageSizeOptions: ['20', '50', '100', '200'],
                    onChange: (page, pageSize) => {
                      setFailedPagination({ current: page, pageSize });
                    },
                    onShowSizeChange: (current, size) => {
                      setFailedPagination({ current: 1, pageSize: size });
                    }
                  }}
                  size="small"
                  scroll={{ y: 500 }}
                  locale={{
                    emptyText: <Empty description="暂无失败任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  }}
                />
              </div>
            )
          }
        ]}
      />
      </div>

      <style jsx>{`
        .processing-row {
          background-color: #f6ffed !important;
        }
        .processing-row:hover {
          background-color: #f6ffed !important;
        }
      `}</style>
    </Modal>
  );
};

export default QueueManagementModal;
