import React from 'react';
import { 
  Button, 
  Space, 
  Select, 
  Typography, 
  Tooltip, 
  Dropdown,
  Badge
} from 'antd';
import { 
  BorderOutlined, 
  CheckSquareOutlined,
  SortAscendingOutlined, 
  SortDescendingOutlined,
  FilterOutlined,
  MoreOutlined,
  BarChartOutlined
} from '@ant-design/icons';

const { Text } = Typography;
const { Option } = Select;

/**
 * 视频解析模块主操作栏组件
 * 包含全选、筛选、排序、统计信息等功能
 */
const VideoOperationsHeader = ({
  // 全选相关
  selectedCount = 0,
  totalCount = 0,
  allFilesSelected = false,
  onSelectAll,
  
  // 筛选相关
  analysisStatusFilter = 'all',
  onAnalysisStatusFilterChange,
  characterGraphFilter = 'all', 
  onCharacterGraphFilterChange,
  
  // 排序相关
  sortOrder = 'asc',
  onSortChange,
  
  // 统计信息
  statusStatistics = {
    total: 0,
    analysis: { completed: 0, failed: 0, pending: 0 },
    characterGraph: { completed: 0, failed: 0, pending: 0 }
  },
  
  // 高级功能
  onShowStatistics,
  moreActions = []
}) => {

  // 构建更多操作菜单
  const moreMenuItems = moreActions.map((action, index) => ({
    key: index,
    label: action.label,
    icon: action.icon,
    onClick: action.onClick,
    disabled: action.disabled
  }));

  return (
    <div className="video-operations-header">
      <div className="video-operations-header-content">
        {/* 左侧：主要控制区域 */}
        <div className="primary-controls">
          <Space size="middle">
            {/* 全选按钮 */}
            <div className="select-all-group">
              <Tooltip 
                title={allFilesSelected 
                  ? `取消全选（已选择${selectedCount}个视频）` 
                  : `选择全部视频（共${totalCount}个）`
                }
              >
                <Button 
                  size="small"
                  icon={allFilesSelected ? <CheckSquareOutlined /> : <BorderOutlined />} 
                  onClick={onSelectAll}
                  type={allFilesSelected ? 'primary' : 'default'}
                  className={`select-all-btn ${allFilesSelected ? 'selected' : ''}`}
                >
                  {allFilesSelected ? `全选(${selectedCount})` : '全选'}
                </Button>
              </Tooltip>
            </div>

            {/* 快速筛选组 */}
            <div className="filter-group">
              <Space size="small">
                <Text type="secondary" style={{ fontSize: '12px' }}>筛选:</Text>
                <Select
                  size="small"
                  value={analysisStatusFilter}
                  onChange={onAnalysisStatusFilterChange}
                  className="filter-select"
                  suffixIcon={<FilterOutlined style={{ fontSize: '12px' }} />}
                >
                  <Option value="all">全部解析</Option>
                  <Option value="completed">已完成</Option>
                  <Option value="pending">待解析</Option>
                  <Option value="failed">失败</Option>
                </Select>
                
                <Select
                  size="small"
                  value={characterGraphFilter}
                  onChange={onCharacterGraphFilterChange}
                  className="filter-select"
                  suffixIcon={<FilterOutlined style={{ fontSize: '12px' }} />}
                >
                  <Option value="all">全部图谱</Option>
                  <Option value="completed">已生成</Option>
                  <Option value="pending">待生成</Option>
                  <Option value="failed">失败</Option>
                </Select>
              </Space>
            </div>

            {/* 排序控制 */}
            <div className="sort-group">
              <Button
                size="small"
                icon={sortOrder === 'desc' ? <SortDescendingOutlined /> : <SortAscendingOutlined />}
                onClick={onSortChange}
                className="sort-btn"
              >
                名称{sortOrder === 'asc' ? '升序' : '降序'}
              </Button>
            </div>
          </Space>
        </div>

        {/* 中间：统计信息 */}
        <div className="statistics-area">
          <Space size="small">
            <Text type="secondary" className="stat-text">
              共 <Text strong>{statusStatistics.total}</Text> 个
            </Text>
            <Text type="secondary" className="stat-separator">|</Text>
            <Tooltip title="点击查看详细统计" placement="top">
              <Button 
                type="link" 
                size="small" 
                icon={<BarChartOutlined />}
                onClick={onShowStatistics}
                className="statistics-btn"
              >
                <Space size={4}>
                  <Text className="stat-label">解析:</Text>
                  <Badge count={statusStatistics.analysis.completed} 
                         style={{ backgroundColor: '#52c41a' }} 
                         size="small" />
                  <Badge count={statusStatistics.analysis.failed} 
                         style={{ backgroundColor: '#ff4d4f' }} 
                         size="small" />
                  <Badge count={statusStatistics.analysis.pending} 
                         style={{ backgroundColor: '#d9d9d9' }} 
                         size="small" />
                </Space>
              </Button>
            </Tooltip>
            <Text type="secondary" className="stat-separator">|</Text>
            <Space size={4}>
              <Text className="stat-label">图谱:</Text>
              <Badge count={statusStatistics.characterGraph.completed} 
                     style={{ backgroundColor: '#52c41a' }} 
                     size="small" />
              <Badge count={statusStatistics.characterGraph.failed} 
                     style={{ backgroundColor: '#ff4d4f' }} 
                     size="small" />
              <Badge count={statusStatistics.characterGraph.pending} 
                     style={{ backgroundColor: '#d9d9d9' }} 
                     size="small" />
            </Space>
          </Space>
        </div>

        {/* 右侧：高级功能 */}
        <div className="advanced-controls">
          {/* 移除更多按钮 */}
        </div>
      </div>
    </div>
  );
};

export default VideoOperationsHeader;
