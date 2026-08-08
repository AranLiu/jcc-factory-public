import React, { useState } from 'react';
import { 
  Button, 
  Space, 
  Typography, 
  Tooltip, 
  Popconfirm,
  Divider,
  Tag,
  Modal,
  Select,
  message
} from 'antd';
import { 
  FunctionOutlined,
  CloudOutlined,
  NodeIndexOutlined,
  DownloadOutlined,
  DeleteOutlined,
  BarsOutlined,
  PicCenterOutlined,
  CloseOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';

const { Text } = Typography;

/**
 * 批量操作栏组件
 * 仅在选中文件时显示，提供批量操作功能
 */
const BatchOperationsBar = ({
  // 选择状态
  selectedCount = 0,
  selectedFileIds = new Set(),
  
  // 权限控制
  canEdit = true,
  canDownload = true,
  
  // 文件状态
  processedFiles = [],
  allFiles = [], // 新增：所有文件列表，用于标记功能
  
  // 操作处理函数
  onAnalyzeFiles,
  onAddToQueue,
  onGenerateCharacterGraph,
  onDownloadFiles,
  onDeleteFiles,
  onMarkToEpisode, // 新增：标记到第X集的回调函数

  onQuickConcatenate,
  onClearSelection,
  
  // 加载状态
  addingToQueue = false,
  
  // 样式控制
  className = '',
  style = {}
}) => {
  // 标记到第X集的状态
  const [markModalVisible, setMarkModalVisible] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [markingLoading, setMarkingLoading] = useState(false);

  // 计算选中文件中已完成解析的数量
  const completedSelectedFiles = processedFiles.filter(
    f => selectedFileIds.has(f.id) && f.task_status === 'completed'
  );
  const hasCompletedFiles = completedSelectedFiles.length > 0;

  // 生成集数选项（基于文件总数）
  const episodeOptions = allFiles.map((_, index) => ({
    value: index + 1,
    label: `第${index + 1}集`
  }));

  // 处理标记到第X集
  const handleMarkToEpisode = async () => {
    if (!selectedEpisode || !onMarkToEpisode) return;
    
    try {
      setMarkingLoading(true);
      await onMarkToEpisode(selectedEpisode);
      message.success(`已标记前${selectedEpisode}集为完成状态`);
      setMarkModalVisible(false);
      setSelectedEpisode(null);
    } catch (error) {
      message.error('标记失败，请重试');
    } finally {
      setMarkingLoading(false);
    }
  };

  // 如果没有选中文件，不显示批量操作栏
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className={`batch-operations-bar ${className}`} style={style}>
      <div className="batch-operations-content" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        {/* 左侧：选择信息 */}
        <div className="selection-info" style={{ flexShrink: 0 }}>
          <Space size={4} align="center">
            <Tag color="blue" className="selection-tag">
              已选择 {selectedCount} 个文件
            </Tag>
            <Tooltip title="清除选择">
              <Button 
                type="text" 
                size="small" 
                icon={<CloseOutlined />}
                onClick={onClearSelection}
                className="clear-selection-btn"
              />
            </Tooltip>
          </Space>
        </div>

        {/* 右侧：批量操作按钮组 */}
        <div className="batch-actions" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Space size="small">
            {/* 解析操作组 */}
            <div className="action-group analysis-group">
              <Text type="secondary" className="group-label">解析</Text>
              <Space size={4}>
                <Tooltip title={canEdit ? "剧本内容解析" : "只读权限，无法解析"}>
                  <Button 
                    size="small"
                    icon={<FunctionOutlined />} 
                    disabled={!canEdit} 
                    onClick={() => onAnalyzeFiles(Array.from(selectedFileIds))}
                    className="analysis-btn"
                  >
                    剧本解析
                  </Button>
                </Tooltip>
                
                <Tooltip title={
                  !hasCompletedFiles 
                    ? "请先完成剧本内容解析" 
                    : "生成选中文件的角色图谱"
                }>
                  <Button 
                    size="small"
                    icon={<NodeIndexOutlined />} 
                    disabled={!hasCompletedFiles}
                    onClick={() => onGenerateCharacterGraph(Array.from(selectedFileIds))}
                    className="character-graph-btn"
                  >
                    角色图谱
                  </Button>
                </Tooltip>
              </Space>
            </div>

            <Divider type="vertical" className="action-divider" style={{ margin: '0 8px' }} />

            {/* 后台操作组 */}
            <div className="action-group background-group">
              <Text type="secondary" className="group-label">后台</Text>
              <Space size={4}>
                <Tooltip title={canEdit ? "添加到后台解析队列" : "只读权限，无法解析"}>
                  <Button 
                    size="small"
                    icon={<CloudOutlined />} 
                    disabled={!canEdit || addingToQueue}
                    loading={addingToQueue}
                    onClick={() => onAddToQueue(Array.from(selectedFileIds))}
                    className="queue-btn"
                  >
                    后台解析
                  </Button>
                </Tooltip>
              </Space>
            </div>

            <Divider type="vertical" className="action-divider" style={{ margin: '0 8px' }} />

            {/* 文档操作组 */}
            <div className="action-group document-group">
              <Text type="secondary" className="group-label">文档</Text>
              <Space size={4}>
                <Tooltip title={
                  !hasCompletedFiles 
                    ? "请先完成剧本内容解析" 
                    : "拼接完整剧本"
                }>
                  <Button
                    size="small"
                    icon={<PicCenterOutlined />}
                    disabled={!hasCompletedFiles}
                    onClick={() => onQuickConcatenate(Array.from(selectedFileIds))}
                    className="concatenate-btn"
                  >
                    拼接剧本
                  </Button>
                </Tooltip>
              </Space>
            </div>

            <Divider type="vertical" className="action-divider" style={{ margin: '0 8px' }} />

            {/* 管理操作组 */}
            <div className="action-group management-group">
              <Text type="secondary" className="group-label">管理</Text>
              <Space size={4}>
                <Tooltip title={canEdit ? "批量标记到指定集数" : "只读权限，无法标记"}>
                  <Button 
                    size="small"
                    icon={<CheckCircleOutlined />} 
                    disabled={!canEdit || allFiles.length === 0} 
                    onClick={() => setMarkModalVisible(true)}
                    className="mark-episode-btn"
                  >
                    标记到第X集
                  </Button>
                </Tooltip>

                <Tooltip title={canDownload ? "批量下载选中文件" : "无下载权限"}>
                  <Button 
                    size="small"
                    icon={<DownloadOutlined />} 
                    disabled={!canDownload} 
                    onClick={() => onDownloadFiles(Array.from(selectedFileIds))}
                    className="download-btn"
                  >
                    下载
                  </Button>
                </Tooltip>
                
                <Popconfirm
                  title={`确定要删除选中的 ${selectedCount} 个文件吗？`}
                  disabled={!canEdit}
                  onConfirm={() => onDeleteFiles(Array.from(selectedFileIds))}
                  okText="确定"
                  cancelText="取消"
                >
                  <Tooltip title={canEdit ? "批量删除选中文件" : "只读权限，无法删除"}>
                    <Button 
                      size="small" 
                      icon={<DeleteOutlined />} 
                      disabled={!canEdit}
                      danger
                      className="delete-btn"
                    >
                      删除
                    </Button>
                  </Tooltip>
                </Popconfirm>
              </Space>
            </div>
          </Space>
        </div>
      </div>

      {/* 标记到第X集的模态框 */}
      <Modal
        title="标记到第几集？"
        open={markModalVisible}
        onCancel={() => {
          setMarkModalVisible(false);
          setSelectedEpisode(null);
        }}
        onOk={handleMarkToEpisode}
        confirmLoading={markingLoading}
        okText="确认标记"
        cancelText="取消"
        okButtonProps={{
          disabled: !selectedEpisode
        }}
        width={400}
      >
        <div style={{ padding: '20px 0' }}>
          <div style={{ marginBottom: '16px', color: '#666' }}>
            选择要标记到的集数，该集及之前的所有集数都会被标记为完成状态。
          </div>
          <Select
            style={{ width: '100%' }}
            placeholder="请选择集数"
            value={selectedEpisode}
            onChange={setSelectedEpisode}
            options={episodeOptions}
            size="large"
          />
          {selectedEpisode && (
            <div style={{ marginTop: '12px', color: '#52c41a', fontSize: '14px' }}>
              将标记第1集到第{selectedEpisode}集为完成状态
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default BatchOperationsBar;
