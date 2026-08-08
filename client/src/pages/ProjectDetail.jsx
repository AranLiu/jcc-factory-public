import React, { useState, useEffect, useMemo, useRef } from 'react'
import { 
  Layout, 
  Row, 
  Col, 
  Card, 
  Button, 
  Upload, 
  List, 
  Form,
  Input,
  Slider,
  Select,
  message,
  Space,
  Tag,
  Spin,
  Typography,
  Divider,
  Checkbox,
  Radio,
  Pagination,
  Modal,
  Popconfirm,
  Tooltip,
  Tabs,
  InputNumber,
  Steps,
  Dropdown,
  Menu,
  AutoComplete,
  Badge,
  Collapse
} from 'antd'
  import { 
    ArrowLeftOutlined,
    UploadOutlined,
  FileTextOutlined,
  RobotOutlined,
  DownloadOutlined,
  EditOutlined,
  DownOutlined,
  SaveOutlined,
  BookOutlined,
  ExpandOutlined,
  DeleteOutlined,
  SelectOutlined,
  PicCenterOutlined,
  FunctionOutlined,
  BorderOutlined,
  InfoCircleOutlined,
  NodeIndexOutlined,
  ClusterOutlined,
  PartitionOutlined,
  EyeOutlined,
  LoadingOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  StopOutlined,
  BellOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  FileOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  CloudOutlined,
  BarsOutlined,
  CheckSquareOutlined,
  BarChartOutlined,
  MoreOutlined,
  FilterOutlined,
  CloseOutlined,
  PlusOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LeftOutlined,
  RightOutlined
} from '@ant-design/icons'
import { useParams, useNavigate } from '../services/router'
import { canDownloadProject, canEditProject, isProjectReadOnly } from '../utils/projectPermissions'
import { useAuth } from '../contexts/AuthContext'
import { projectAPI, fileAPI, aiAPI, knowledgeBaseAPI, systemConfigAPI, scriptUnitsAPI, fullScriptsAPI, authAPI, queueAPI } from '../services/api'
import { secureFetch } from '../services/httpSecurity'
import VideoPlayer from '../components/VideoPlayer'
import LoadingDots from '../components/LoadingDots'

import QueueManagementModal from '../components/QueueManagementModal'

import dayjs from 'dayjs'
import './ProjectDetail.css'
import '../styles/VideoOperations.css'
import VideoOperationsHeader from '../components/VideoOperationsHeader'
import BatchOperationsBar from '../components/BatchOperationsBar'
import { resolveCharacterEpisodeSegments } from './characterGraphSelection'

const { Header, Content } = Layout
const { Option } = Select
const { TextArea } = Input
const { Text, Title, Paragraph } = Typography
const { Dragger } = Upload;

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8080' : '');

// 完成标记按钮（圆形，可切换，默认空心，点击变绿色实心）
const MarkDoneButton = ({ file, canEdit }) => {
  const [updating, setUpdating] = useState(false);
  const isDone = !!file.mark_done;

  const handleToggle = async () => {
    if (!canEdit || updating) return;
    try {
      setUpdating(true);
      await fileAPI.markDone(file.id, !isDone);
      // 乐观更新：直接修改内存对象，父级列表刷新时会覆盖
      file.mark_done = !isDone;
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(false);
    }
  };

  const tooltipTitle = !isDone ? '标记为处理完成' : '取消处理完成';

  return (
    <Tooltip title={canEdit ? tooltipTitle : '只读权限，无法修改标记'}>
       <Button
         aria-label={tooltipTitle}
         size="small"
        shape="circle"
        onClick={handleToggle}
        disabled={!canEdit || updating}
        style={{
          width: 18,
          height: 18,
          minWidth: 18,
          padding: 0,
          borderRadius: '50%',
          border: `2px solid ${isDone ? '#52c41a' : '#d9d9d9'}`,
          backgroundColor: isDone ? '#52c41a' : 'transparent',
        }}
      />
    </Tooltip>
  );
};

// 修改密码模态框组件
const ChangePasswordModal = ({ visible, onCancel, onFinish }) => {
  const [form] = Form.useForm();

  const handleFinish = (values) => {
    onFinish(values);
    form.resetFields();
  };

  return (
    <Modal
      title="修改密码"
      open={visible}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      footer={null}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
      >
        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password placeholder="请输入当前密码" />
        </Form.Item>
        
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, max: 128, message: '密码长度需为 8-128 位' }
          ]}
        >
          <Input.Password placeholder="请输入新密码（8-128 位）" />
        </Form.Item>
        
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="请再次输入新密码" />
        </Form.Item>

        <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
          <Space>
            <Button onClick={() => {
              form.resetFields();
              onCancel();
            }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit">
              确认修改
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// 可编辑、可放大的文本域组件
const EditableTextArea = ({ value, onChange, onSave, onLoadDefault, placeholder, title = "编辑内容", rows = 5, disabled = false, readOnly = false, autoSize = false }) => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [modalContent, setModalContent] = useState(value);

  useEffect(() => {
    setModalContent(value);
  }, [value])

  const handleModalOk = () => {
    if (!readOnly) {
      onChange(modalContent);
      if(onSave) onSave(modalContent);
    }
    setIsModalVisible(false);
  }
  
  const handleModalCancel = () => {
    setModalContent(value);
    setIsModalVisible(false);
  }

  const handleLoadDefault = async () => {
    if (onLoadDefault) {
      try {
        await onLoadDefault();
        message.success('已加载系统默认Prompt');
      } catch (error) {
        message.error('加载默认Prompt失败');
      }
    }
  }

  return (
    <div style={{ position: 'relative', flex: autoSize ? 1 : 'none', display: autoSize ? 'flex' : 'block', flexDirection: 'column' }}>
      <TextArea
        value={value}
        readOnly={true} // 始终只读，不允许直接编辑
        rows={autoSize ? undefined : rows}
        autoSize={autoSize ? { minRows: 6 } : false}
        placeholder={disabled ? "只读权限，无法编辑" : placeholder}
        style={{ backgroundColor: '#f5f5f5', flex: autoSize ? 1 : 'none' }}
        disabled={disabled}
      />
      {!disabled && (
        <div style={{ position: 'absolute', top: 5, right: 5, zIndex: 10, display: 'flex', gap: '4px' }}>
          {onLoadDefault && (
            <Tooltip title="加载系统默认">
               <Button aria-label="加载系统默认 Prompt" icon={<PicCenterOutlined />} onClick={handleLoadDefault} />
            </Tooltip>
          )}
          <Tooltip title={readOnly ? "放大查看" : "放大编辑"}>
             <Button
               aria-label={readOnly ? '放大查看' : '放大编辑'}
               icon={<ExpandOutlined />}
              onClick={() => setIsModalVisible(true)}
            />
          </Tooltip>
        </div>
      )}
      <Modal
        title={title}
        open={isModalVisible}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        width="60vw"
        destroyOnClose
        footer={(disabled || readOnly) ? [
          <Button key="close" onClick={handleModalCancel}>关闭</Button>
        ] : undefined}
      >
        <TextArea
          value={modalContent}
          onChange={(disabled || readOnly) ? undefined : (e) => setModalContent(e.target.value)}
          autoSize={{ minRows: 15, maxRows: 25 }}
          readOnly={disabled || readOnly}
          showCount
          style={{ marginBottom: '14px' }}
        />
      </Modal>
    </div>
  )
}

const VideoCard = ({ file, onRename, onAnalyze, onPlay, onDelete, onEdit, onDownload, selected, onSelect, isProcessing, canEdit = true, canDownload = true, onCharacterGraph, onViewCharacterGraph, processingFileIds = new Set(), characterGraphProcessingIds = new Set(), hasCharacterGraph = false, characterGraphStatus = 'pending' }) => {
  const getStatusTag = (status) => {
    switch (status) {
      case 'completed':
        return <Tag color="success">已解析</Tag>;
      case 'processing':
        return <Tag color="processing">解析中...</Tag>;
      case 'failed':
        return <Tag color="error">失败</Tag>;
      default:
        return <Tag color="default">待处理</Tag>;
    }
  };

  const handleRename = (newName) => {
    if (newName && newName !== file.original_name) {
      onRename(file.id, newName);
    }
  }
  
  const formatDuration = (seconds) => {
    if (!seconds || seconds < 0) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  };

  // 拆分文件名和扩展名
  const getFileNameParts = (filename) => {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return { name: filename, extension: '' };
    }
    return {
      name: filename.substring(0, lastDotIndex),
      extension: filename.substring(lastDotIndex)
    };
  };

  const fileNameParts = getFileNameParts(file.original_name);
  const fileSize = file.file_size ? `${(file.file_size / 1024 / 1024).toFixed(2)} MB` : 'N/A';
  const duration = formatDuration(file.duration);

  return (
    <div className="video-card-wrapper-list">
      <Card bordered={false} bodyStyle={{ padding: 0, position: 'relative' }}>
        <Checkbox checked={selected} onChange={(e) => onSelect(file.id, e.target.checked)} style={{position: 'absolute', top: '8px', left: '8px', zIndex: 10}}/>
        <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 10 }}>
          {getStatusTag(file.task_status)}
        </div>
        
        <div style={{ padding: '12px' }}>
          <div style={{ display: 'flex', gap: '24px' }}>
            {/* Left Side: Thumbnail */}
            <div style={{ flex: '0 0 120px', textAlign: 'center' }}>
              <div className="video-thumbnail-list" onClick={() => onPlay(file)}>
                {file.thumbnail_path ? (
                  <img 
                    alt={`${file.original_name} 缩略图`} 
                    src={`/api/files/${file.id}/thumbnail`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      console.error('缩略图加载失败:', file.thumbnail_path);
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                    onLoad={() => {
                      console.log('缩略图加载成功:', `/api/files/${file.id}/thumbnail`);
                    }}
                  />
                ) : null}
                <div 
                  className="thumbnail-placeholder-list" 
                  style={{ display: file.thumbnail_path ? 'none' : 'flex' }}
                >
                  <FileTextOutlined />
                </div>
                <div className="thumbnail-overlay-list">
                  <PlayCircleOutlined />
                </div>
              </div>
              <div className="video-meta-list">
                <span><PlayCircleOutlined /> {duration}</span>
                <span><FileTextOutlined /> {fileSize}</span>
              </div>
            </div>

            {/* Right Side: Details */}
            <div style={{
              flex: '1 1 auto',
              minWidth: 0, // Crucial for flex shrinking
              height: '200px',
              display: 'flex',
              flexDirection: 'column'
            }}>
               <div style={{ flexShrink: 0, margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                 <Typography.Title 
                   level={5} 
                   ellipsis={{ rows: 1, tooltip: file.original_name }}
                   editable={canEdit ? { 
                     onChange: (newName) => {
                       // 合并新的主名称和原有扩展名
                       const fullName = newName + fileNameParts.extension;
                       onRename(file.id, fullName);
                     }
                   } : false}
                   style={{ display: 'inline', margin: 0 }}
                 >
                   {fileNameParts.name}
                 </Typography.Title>
                 <span style={{ color: '#999', fontSize: '14px', fontWeight: 'normal' }}>
                   {fileNameParts.extension}
                 </span>
                 {/* 完成标记按钮 */}
                 <MarkDoneButton file={file} canEdit={canEdit} />
               </div>
              <div className="analysis-result-wrapper" style={{ 
                position: 'relative',
                flex: 1, // Grow to fill available space
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid #f0f0f0',
                borderRadius: '4px',
                padding: '8px',
                backgroundColor: '#fafafa'
              }}>
                  {isProcessing ? (
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'center', 
                      alignItems: 'center', 
                      height: '100%',
                      width: '100%',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      backgroundColor: 'rgba(250, 250, 250, 0.8)',
                      borderRadius: '6px'
                    }}>
                      <LoadingDots size="large" color="#1890ff" />
                    </div>
                  ) : (
                    <div style={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                      position: 'relative'
                    }}>
                      <div style={{ flex: 1, overflowY: 'auto' }}>
                        <Paragraph
                          className="analysis-result-list"
                          style={{ 
                            margin: 0,
                            whiteSpace: 'pre-wrap', // Preserve line breaks and wrap text
                            overflowWrap: 'break-word' // Break long words to prevent overflow
                          }}
                        >
                          {file.task_result || '待解析处理...'}
                        </Paragraph>
                      </div>

                    </div>
                  )}
              </div>

              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginTop: '8px',
                marginBottom: '6px'
              }}>
                <Button
                  type="default"
                  icon={characterGraphProcessingIds.has(file.id) ? <LoadingDots size="small" color="#1677ff" /> : <EyeOutlined />}
                  onClick={() => onViewCharacterGraph && onViewCharacterGraph(file)}
                  disabled={characterGraphProcessingIds.has(file.id) || !hasCharacterGraph}
                  style={{
                    backgroundColor: characterGraphStatus === 'success' ? '#f8f9fa' : 
                                   characterGraphStatus === 'failed' ? '#fff2f0' : '#f5f5f5',
                    borderColor: characterGraphStatus === 'success' ? '#dee2e6' : 
                                characterGraphStatus === 'failed' ? '#ff4d4f' : '#d9d9d9',
                    color: characterGraphStatus === 'success' ? '#495057' : 
                          characterGraphStatus === 'failed' ? '#ff4d4f' : '#bfbfbf',
                    fontSize: '12px'
                  }}
                  size="small"
                >
                  分集角色图谱
                </Button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    共 {file.task_result?.length || 0} 字符
                  </Text>
                  {canEdit && (
                    <Tooltip title="编辑解析结果">
                      <Button 
                        className="edit-result-btn" 
                        icon={<EditOutlined />} 
                        onClick={() => onEdit(file)}
                        size="small"
                      />
                    </Tooltip>
                  )}
                </div>
              </div>

              <div className="video-actions-list" style={{
                height: '40px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '8px'
              }}>
                <Tooltip title={canEdit ? "剧本内容解析" : "只读权限，无法解析"}>
                  <Button 
                    icon={<FunctionOutlined />} 
                    onClick={() => onAnalyze([file.id])} 
                    disabled={!canEdit}
                  />
                </Tooltip>
                <Tooltip title={file.task_status === 'completed' ? "角色图谱生成" : "需要先完成剧本内容解析"}>
                  <Button 
                    icon={<NodeIndexOutlined />} 
                    onClick={() => onCharacterGraph && onCharacterGraph(file)}
                    disabled={file.task_status !== 'completed'}
                    style={{
                      backgroundColor: file.task_status === 'completed' ? undefined : '#f5f5f5',
                      borderColor: file.task_status === 'completed' ? undefined : '#d9d9d9',
                      color: file.task_status === 'completed' ? undefined : '#bfbfbf'
                    }}
                  />
                </Tooltip>
                <Tooltip title={canDownload ? "下载" : "无下载权限"}>
                  <Button 
                    icon={<DownloadOutlined />} 
                    onClick={() => onDownload([file.id])} 
                    disabled={!canDownload}
                  />
                </Tooltip>
                {canEdit && (
                  <Popconfirm
                      title="确定要删除这个文件吗？"
                      onConfirm={() => onDelete([file.id])}
                      okText="确定"
                      cancelText="取消"
                    >
                    <Tooltip title="删除">
                      <Button danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

const ProjectDetail = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const draftStorageKey = (name) => `jcc:${user?.id || 'anonymous'}:project:${id}:${name}`
  
  const [project, setProject] = useState(null)
  const [files, setFiles] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [integrating, setIntegrating] = useState(false);
  const [isTaskPanelVisible, setIsTaskPanelVisible] = useState(false);
  
  // 权限检查 - 根据project状态动态计算
  const userPermission = user?.permission || 'personal';
  

  
  const canEdit = useMemo(() => canEditProject(user, project), [user, project]);
  
  // 判断是否对当前项目只读（非所有者的readonly_global用户）
  const isReadOnly = useMemo(() => isProjectReadOnly(user, project), [user, project]);
  
  // 判断是否可以下载文件
  const canDownload = useMemo(() => canDownloadProject(user, project), [user, project]);
  
  // 使用函数为状态提供初始值，从localStorage加载
  const [integrationResult, setIntegrationResult] = useState('');
  const [draftContent, setDraftContent] = useState(() => {
    return sessionStorage.getItem(draftStorageKey('draftContent')) || '';
  });

  const [archiveTitle, setArchiveTitle] = useState('');
  const [isArchiveModalVisible, setIsArchiveModalVisible] = useState(false);
  const [isResultModalVisible, setIsResultModalVisible] = useState(false);
  const [isSelectionModalVisible, setIsSelectionModalVisible] = useState(false);
  const [modalSelectedFileIds, setModalSelectedFileIds] = useState(new Set());
  const [playingFile, setPlayingFile] = useState(null);
  const [editingFile, setEditingFile] = useState(null);
  const [editContent, setEditContent] = useState('');
  // 人物名称确认（仅在编辑解析结果弹框内使用）
  const [bracketTerms, setBracketTerms] = useState([]); // [{ raw: string, count: number }]
  const [nameInputs, setNameInputs] = useState({}); // { [raw]: standardName }
  const [nameHistory, setNameHistory] = useState([]); // [standardName]
  // 批量替换
  const [batchFindText, setBatchFindText] = useState('');
  const [batchReplaceText, setBatchReplaceText] = useState('');
  const [batchMatchCount, setBatchMatchCount] = useState(null);
  const [batchWarnedEmptyReplace, setBatchWarnedEmptyReplace] = useState(false);
  // 移除了一键拼接的模态框状态，现在直接拼接
  const [selectedFileIds, setSelectedFileIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  
  // 新增状态管理
  const [processingFileIds, setProcessingFileIds] = useState(new Set())
  const [characterGraphProcessingIds, setCharacterGraphProcessingIds] = useState(new Set())
  const [characterGraphStatusMap, setCharacterGraphStatusMap] = useState(new Map()) // 新增：角色知识图谱状态映射
  // 排序状态管理（只支持名称排序）
  const [sortOrder, setSortOrder] = useState('asc') // 排序方向：'asc', 'desc'，默认名称升序
  
  // 新增：筛选状态管理
  const [analysisStatusFilter, setAnalysisStatusFilter] = useState('all') // 视频解析状态筛选：'all', 'pending', 'processing', 'completed', 'failed'
  const [characterGraphFilter, setCharacterGraphFilter] = useState('all') // 角色图谱生成状态筛选：'all', 'pending', 'processing', 'completed', 'failed'
  
  const [modelConfig, setModelConfig] = useState({ 
    defaultModel: 'gemini-3.6-flash',
    availableModels: ['gemini-3.6-flash']
  });
  const [usingSystemDefaults, setUsingSystemDefaults] = useState({
    analysis: false,
    integration: false,
    characterKnowledgeGraph: false,
    characterIntegration: false,
    character: false
  });
  
  // 角色知识图谱相关状态
  const [isCharacterModalVisible, setIsCharacterModalVisible] = useState(false);
  const [currentCharacterFile, setCurrentCharacterFile] = useState(null);
  const [characterContent, setCharacterContent] = useState('');
  
  // 图谱整合工作台相关状态
  const [characterIntegrating, setCharacterIntegrating] = useState(false);
  const [characterIntegrationTimer, setCharacterIntegrationTimer] = useState(0);
  const [characterIntegrationStartTime, setCharacterIntegrationStartTime] = useState(null);
  const [characterIntegrationFinalTime, setCharacterIntegrationFinalTime] = useState(0); // 保存最终用时
  const [isCharacterWorkflowReset, setIsCharacterWorkflowReset] = useState(false); // 跟踪重置状态
  

  const [characterDraftContent, setCharacterDraftContent] = useState(() => {
    return sessionStorage.getItem(draftStorageKey('characterDraftContent')) || '';
  });
  const [globalCharacterContent, setGlobalCharacterContent] = useState(() => {
    return sessionStorage.getItem(draftStorageKey('globalCharacterContent')) || '';
  });
  const [characterIntegrationResult, setCharacterIntegrationResult] = useState('');
  const [isCharacterIntegrationResultModalVisible, setIsCharacterIntegrationResultModalVisible] = useState(false);
  const [isCharacterSelectionModalVisible, setIsCharacterSelectionModalVisible] = useState(false);
  const [characterModalSelectedFileIds, setCharacterModalSelectedFileIds] = useState(new Set());
  const [isGlobalCharacterModalVisible, setIsGlobalCharacterModalVisible] = useState(false);
  const [isCharacterDraftPreviewVisible, setIsCharacterDraftPreviewVisible] = useState(false); // 预览模态框
  const [previewCharacterContent, setPreviewCharacterContent] = useState(''); // 预览内容
  const [isCharacterResultPreviewVisible, setIsCharacterResultPreviewVisible] = useState(false); // 角色结果预览模态框
  const [isCharacterResultEditing, setIsCharacterResultEditing] = useState(false); // 角色结果编辑状态
  const [characterResultEditContent, setCharacterResultEditContent] = useState(''); // 角色结果编辑内容
  
  // 角色图谱整合失败处理相关状态
  const [characterIntegrationFailed, setCharacterIntegrationFailed] = useState(false); // 角色图谱整合是否失败
  const [isManualInputModalVisible, setIsManualInputModalVisible] = useState(false); // 手动输入模态框
  const [manualInputContent, setManualInputContent] = useState(''); // 手动输入内容
  
  // 单元剧本相关状态
  const [scriptUnits, setScriptUnits] = useState([]);
  const [activeUnitId, setActiveUnitId] = useState(null);
  const [isUnitSelectionModalVisible, setIsUnitSelectionModalVisible] = useState(false);
  const [unitModalSelectedFileIds, setUnitModalSelectedFileIds] = useState(new Set());
  const [isUnitCharacterModalVisible, setIsUnitCharacterModalVisible] = useState(false); // 选择角色图谱模态框
  const [isUnitMaterialModalVisible, setIsUnitMaterialModalVisible] = useState(false); // 选择素材模态框
  const [unitMaterialSelectedFileIds, setUnitMaterialSelectedFileIds] = useState(new Set()); // 素材模态框中选择的文件
  const [unitIntegrating, setUnitIntegrating] = useState(false);
  
  // 新增：三步工作流状态（按单元ID区分）
  const [unitWorkflowProcessing, setUnitWorkflowProcessing] = useState({});
  
  // 单元标签页滑动状态
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const tabsRef = useRef(null);
  const [isStep1ModalVisible, setIsStep1ModalVisible] = useState(false); // 步骤1选择素材模态框
  const [isStep2ModalVisible, setIsStep2ModalVisible] = useState(false); // 步骤2内容整合模态框
  const [isStep3ModalVisible, setIsStep3ModalVisible] = useState(false); // 步骤3添加角色图谱模态框
  const [isStep4ModalVisible, setIsStep4ModalVisible] = useState(false); // 步骤4角色整合模态框
  const [step1PreviewContent, setStep1PreviewContent] = useState(''); // 步骤1预览内容
  const [step2PreviewContent, setStep2PreviewContent] = useState(''); // 步骤2预览内容
  const [step3PreviewContent, setStep3PreviewContent] = useState(''); // 步骤3预览内容
  const [step4PreviewContent, setStep4PreviewContent] = useState(''); // 步骤4预览内容
  const [isStep1PreviewVisible, setIsStep1PreviewVisible] = useState(false); // 步骤1内容预览模态框
  const [isStep3PreviewVisible, setIsStep3PreviewVisible] = useState(false); // 步骤3内容预览模态框
  const [step1EditContent, setStep1EditContent] = useState(''); // 步骤1编辑内容
  const [step2EditContent, setStep2EditContent] = useState(''); // 步骤2编辑内容
  const [step3EditContent, setStep3EditContent] = useState(''); // 步骤3编辑内容
  const [step4EditContent, setStep4EditContent] = useState(''); // 步骤4编辑内容
  const [unitMaterialIncludeCharacterGraph, setUnitMaterialIncludeCharacterGraph] = useState(false); // 是否包含角色图谱
  const [availableCharacterIntegrations, setAvailableCharacterIntegrations] = useState([]); // 可用的角色整合结果
  const [selectedCharacterIntegrations, setSelectedCharacterIntegrations] = useState([]); // 选择的角色整合结果
  const [characterEpisodeSegments, setCharacterEpisodeSegments] = useState([]); // 按集数拆解的角色图谱片段
  const [selectedEpisodeSegments, setSelectedEpisodeSegments] = useState(new Set()); // 选择的集数片段
  
  // 完整剧本相关状态
  const [fullScript, setFullScript] = useState(null);
  const [fullScriptCurrentStep, setFullScriptCurrentStep] = useState(1);
  const [fullScriptSelectedUnitIds, setFullScriptSelectedUnitIds] = useState([]);
  const [fullScriptConcatenatedContent, setFullScriptConcatenatedContent] = useState('');
  // 使用 null 表示“尚未编辑/无审核内容”，空字符串表示“已清空为无内容”
  const [fullScriptReviewedContent, setFullScriptReviewedContent] = useState(null);
  const [fullScriptReviewNotes, setFullScriptReviewNotes] = useState('');
  const [fullScriptArchiveTitle, setFullScriptArchiveTitle] = useState(''); // 存档文档名称
  const [fullScriptProcessing, setFullScriptProcessing] = useState({
    step1: false,
    step2: false,
    step3: false
  });
  
  // 完整剧本编辑模式状态
  const [fullScriptEditMode, setFullScriptEditMode] = useState(false);
  const [fullScriptNotesEditMode, setFullScriptNotesEditMode] = useState(false);
  // 顶部Tab控制（用于跳转到完整剧本）
  const [activeTabKey, setActiveTabKey] = useState('1');
  useEffect(() => {
    // 如果完整剧本创建/更新到某一步，允许外部跳转
  }, [fullScript]);
  
  // 修改密码模态框状态
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  
  // 队列管理模态框状态
  const [queueModalVisible, setQueueModalVisible] = useState(false);
  
  // 后台解析状态
  const [addingToQueue, setAddingToQueue] = useState(false);
  const [queuePolling, setQueuePolling] = useState(null); // 队列轮询状态
  const [queueCount, setQueueCount] = useState(0); // 队列任务计数
  
  // 添加选中文件到后台解析队列
  const handleAddSelectedToQueue = async () => {
    if (selectedFileIds.size === 0) {
      message.warning('请先选择要解析的视频文件');
      return;
    }

    // 过滤出视频文件
    const selectedFiles = files.filter(file => 
      selectedFileIds.has(file.id) && 
      file.mime_type && 
      file.mime_type.startsWith('video/')
    );

    if (selectedFiles.length === 0) {
      message.warning('选中的文件中没有视频文件');
      return;
    }

    setAddingToQueue(true);
    try {
      // 使用系统配置的默认模型，如果没有配置则使用fallback
      const defaultModel = modelConfig.defaultModel || 'gemini-3.6-flash';
      // 从表单获取温度设置，如果没有则使用默认值1（与表单默认值一致）
      const formValues = form.getFieldsValue();
      const defaultTemperature = formValues.temperature || 1;
      
      // 使用项目配置的prompt，如果没有则使用默认值
      let projectPrompt = project?.analysis_prompt;
      if (!projectPrompt) {
        // 如果项目没有配置prompt，尝试获取系统默认prompt
        try {
          const configResponse = await systemConfigAPI.getPublicPrompts();
          if (configResponse.success && configResponse.data?.video_analysis_prompt?.value) {
            projectPrompt = configResponse.data.video_analysis_prompt.value;
          } else {
            projectPrompt = '批量视频内容分析'; // 最后的fallback
          }
        } catch (error) {
          console.warn('获取系统默认prompt失败:', error);
          projectPrompt = '批量视频内容分析'; // 最后的fallback
        }
      }
      
      const response = await queueAPI.addBatch({
        projectId: parseInt(id),
        fileIds: selectedFiles.map(file => file.id),
        prompt: projectPrompt,
        modelConfig: {
          model: defaultModel,
          temperature: defaultTemperature
        }
      });

      if (response.success) {
        message.success(`成功将 ${selectedFiles.length} 个视频文件加入后台解析队列`);
        setSelectedFileIds(new Set()); // 清空选择
        // 启动队列状态监控，实现自动刷新
        startQueuePolling();
      } else {
        message.error(response.message || '添加到队列失败');
      }
    } catch (error) {
      console.error('添加到队列失败:', error);
      message.error('添加到队列失败，请稍后重试');
    } finally {
      setAddingToQueue(false);
    }
  };
  
  const [form] = Form.useForm()

  // 简单标签页样式
  const simpleTabsStyle = `
    .simple-tabs .ant-tabs-nav {
      margin: 0 !important;
      height: 40px;
      display: flex;
      align-items: center;
    }
    .simple-tabs .ant-tabs-nav-wrap {
      padding: 0 12px;
    }
    .simple-tabs .ant-tabs-nav-list {
      height: 40px;
      display: flex;
      align-items: center;
    }
    .simple-tabs .ant-tabs-tab {
      border: none !important;
      background: transparent !important;
      height: 32px;
      display: flex;
      align-items: center;
    }
    .simple-tabs .ant-tabs-tab-active {
      color: #1890ff !important;
    }
    .simple-tabs .ant-tabs-content-holder {
      display: none;
    }
  `;

  // 修改密码处理函数
  const handleChangePassword = async (values) => {
    try {
      await authAPI.changePassword(values);
      message.success('密码修改成功');
      setPasswordModalVisible(false);
    } catch (error) {
      message.error(error.response?.data?.message || '密码修改失败');
    }
  };

  // 用户菜单点击处理函数
  const handleMenuClick = ({ key }) => {
    if (key === 'logout') {
      logout();
    } else if (key === 'changePassword') {
      setPasswordModalVisible(true);
    } else if (key === 'userManagement') {
      navigate('/user-management');
    } else if (key === 'systemConfig') {
      navigate('/system-config');
    }
  };

  useEffect(() => {
    if (id) {
      loadProjectDetail()
      loadModelConfig()
      loadIntegrationResult()
      loadCharacterIntegrationResult()
      loadGlobalCharacterContent()
      loadScriptUnits()
      loadFullScript()
    }
  }, [id])

  // 当项目数据加载完成后，设置默认存档标题
  useEffect(() => {
    if (project && project.name) {
      // 如果没有标题，或者标题是默认的通用标题，则更新为项目名称
      if (!fullScriptArchiveTitle || 
          fullScriptArchiveTitle === '完整剧本' || 
          fullScriptArchiveTitle === '未命名项目-完整剧本') {
        setFullScriptArchiveTitle(`${project.name}-完整剧本`);
      }
      // 如果当前标题不包含项目名，也更新（但不覆盖用户自定义的标题）
      else if (!fullScriptArchiveTitle.includes(project.name) && 
               (fullScriptArchiveTitle.endsWith('-完整剧本') || fullScriptArchiveTitle === '完整剧本')) {
        setFullScriptArchiveTitle(`${project.name}-完整剧本`);
      }
    }
  }, [project, fullScriptArchiveTitle])

  // 当files加载完成后，加载角色知识图谱状态
  useEffect(() => {
    if (files && files.length > 0) {
      loadCharacterGraphStatus();
    }
  }, [files]);

  // 当模型配置加载完成后，设置Form的初始值（仅在字段为空时设置）
  useEffect(() => {
    if (modelConfig.defaultModel) {
      const currentValues = form.getFieldsValue();
      const fieldsToUpdate = {};
      
      // 只在字段为空或未定义时设置默认值
      if (!currentValues.model) {
        fieldsToUpdate.model = modelConfig.defaultModel;
      }
      if (!currentValues.integration_model) {
        fieldsToUpdate.integration_model = modelConfig.defaultModel;
      }
      if (!currentValues.character_integration_model) {
        fieldsToUpdate.character_integration_model = modelConfig.defaultModel;
      }
      if (!currentValues.character_model) {
        fieldsToUpdate.character_model = modelConfig.defaultModel;
      }
      if (currentValues.temperature === undefined || currentValues.temperature === null) {
        fieldsToUpdate.temperature = 1;
      }
      if (currentValues.integration_temperature === undefined || currentValues.integration_temperature === null) {
        fieldsToUpdate.integration_temperature = 1;
      }
      if (currentValues.character_integration_temperature === undefined || currentValues.character_integration_temperature === null) {
        fieldsToUpdate.character_integration_temperature = 1;
      }
      if (currentValues.character_temperature === undefined || currentValues.character_temperature === null) {
        fieldsToUpdate.character_temperature = 1;
      }
      
      // 只有需要更新的字段才设置
      if (Object.keys(fieldsToUpdate).length > 0) {
        form.setFieldsValue(fieldsToUpdate);
      }
    }
  }, [modelConfig, form])

  // 加载模型配置
  const loadModelConfig = async () => {
    setLoading(true); 
    try {
      console.log("🔍 开始获取系统配置...");
      const response = await systemConfigAPI.getPublicConfigs();
      console.log("✅ 系统配置API响应:", response);
      
      const configData = response.data || {};
      console.log("📋 解析的配置数据:", configData);
      
      const models = configData.gemini_available_models?.value || [];
      const defaultModel = configData.gemini_default_model?.value || (models.length > 0 ? models[0] : '');
      
      console.log("🎯 提取的模型配置:", {
        models,
        defaultModel,
        rawAvailableModels: configData.gemini_available_models,
        rawDefaultModel: configData.gemini_default_model
      });
      
      setModelConfig({
        defaultModel: defaultModel,
        availableModels: models
      });

      // 将表单中的模型选择框，也设置为系统默认模型
      if (defaultModel) {
        form.setFieldsValue({
          model: defaultModel,
          integration_model: defaultModel,
          character_integration_model: defaultModel,
          character_model: defaultModel
        });
        console.log("📝 表单字段已设置为默认模型:", defaultModel);
      }

    } catch (error) {
      console.error('❌ 加载模型配置失败:', error);
      console.error('错误详情:', error.response?.data || error.message);
      
      // 使用默认配置
      const fallbackConfig = {
        defaultModel: 'gemini-3.6-flash',
        availableModels: ['gemini-3.6-flash']
      };
      
      setModelConfig(fallbackConfig);
      form.setFieldsValue({
        model: fallbackConfig.defaultModel,
        integration_model: fallbackConfig.defaultModel,
        character_integration_model: fallbackConfig.defaultModel,
        character_model: fallbackConfig.defaultModel
      });
      
      console.log("🔄 已使用默认配置:", fallbackConfig);
    } finally {
      setLoading(false)
    }
  };

  // 当draftContent变化时，保存到localStorage
  useEffect(() => {
    if (id) {
      sessionStorage.setItem(draftStorageKey('draftContent'), draftContent);
    }
  }, [draftContent, id]);

  // 当图谱整合相关内容变化时，保存到localStorage
  useEffect(() => {
    if (id) {
      sessionStorage.setItem(draftStorageKey('characterDraftContent'), characterDraftContent);
    }
  }, [characterDraftContent, id]);

  useEffect(() => {
    if (id) {
      sessionStorage.setItem(draftStorageKey('globalCharacterContent'), globalCharacterContent);
    }
  }, [globalCharacterContent, id]);

  // 从数据库加载剧本整合结果
  const loadIntegrationResult = async () => {
    if (!id) return;
    try {
      const response = await aiAPI.getTasksByType(id, 'script_integration');
      if (response.success && response.tasks.length > 0) {
        // 获取最新的剧本整合结果
        const latestTask = response.tasks[0];
        if (latestTask.status === 'completed' && latestTask.result) {
          setIntegrationResult(latestTask.result);
        }
      }
    } catch (error) {
      console.warn('加载剧本整合结果失败:', error);
    }
  };

  // 从数据库加载角色知识图谱整合结果
  const loadCharacterIntegrationResult = async () => {
    if (!id) return;
    try {
      const response = await aiAPI.getTasksByType(id, 'character_integration');
      if (response.success && response.tasks.length > 0) {
        // 获取最新的图谱整合结果
        const latestTask = response.tasks[0];
        if (latestTask.status === 'completed' && latestTask.result) {
          setCharacterIntegrationResult(latestTask.result);
          setCharacterIntegrationFailed(false);
        } else if (latestTask.status === 'failed') {
          setCharacterIntegrationResult('');
          setCharacterIntegrationFailed(true);
        }
      }
    } catch (error) {
      console.warn('加载角色知识图谱整合结果失败:', error);
    }
  };

  // 从数据库加载全局角色图谱
  const loadGlobalCharacterContent = async () => {
    if (!id) return;
    try {
      const response = await aiAPI.getGlobalCharacterContent(id);
      if (response.success && response.content) {
        setGlobalCharacterContent(response.content);
      }
    } catch (error) {
      console.warn('加载全局角色图谱失败:', error);
    }
  };

  // 在项目数据加载完成后加载Prompt
  useEffect(() => {
    if (project) {
      loadSavedPrompts()
    }
  }, [project])

  // 移除自动刷新，改为任务完成时的状态更新

  // 监听窗口大小变化，重新检测滚动状态
  useEffect(() => {
    const handleResize = () => {
      setTimeout(checkTabsScrollStatus, 100);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 监听窗口大小变化，重新检测滚动状态
  useEffect(() => {
    const handleResize = () => {
      // 延迟检测，等待布局稳定
      setTimeout(checkTabsScrollStatus, 100);
      setTimeout(checkTabsScrollStatus, 300);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 监听单元数量变化，更新滚动状态和事件监听
  useEffect(() => {
    // 如果没有单元，直接禁用按钮
    if (scriptUnits.length === 0) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    
    // 多重延迟检测，确保DOM完全渲染
    const timers = [
      setTimeout(() => {
        checkTabsScrollStatus();
      }, 100),
      
      setTimeout(() => {
        checkTabsScrollStatus();
        addScrollListener();
      }, 300),
      
      setTimeout(() => {
        checkTabsScrollStatus();
      }, 500),
      
      // 添加更长的延迟检测，确保Ant Design Tabs完全渲染
      setTimeout(() => {
        checkTabsScrollStatus();
      }, 800),
      
      setTimeout(() => {
        checkTabsScrollStatus();
      }, 1200)
    ];

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [scriptUnits.length]);

  // 监听activeUnitId变化，重新检测滚动状态并自动滚动到指定单元
  useEffect(() => {
    if (activeUnitId && scriptUnits.length > 0) {
      // 多重延迟检测，确保标签页切换完成后再检测状态
      const timers = [
        setTimeout(() => {
          checkTabsScrollStatus();
        }, 50),
        
        setTimeout(() => {
          checkTabsScrollStatus();
          scrollToUnit(activeUnitId);
        }, 200),
        
        setTimeout(() => {
          checkTabsScrollStatus();
        }, 500)
      ];

      return () => {
        timers.forEach(timer => clearTimeout(timer));
      };
    }
  }, [activeUnitId]);

  // 从数据库加载Prompt
  const loadSavedPrompts = async () => {
    try {
      // 先获取系统默认Prompt
      let defaultPrompts = {}
      try {
        const response = await systemConfigAPI.getPublicPrompts()
        if (response.success && response.data) {
          defaultPrompts = {
            analysis_prompt: response.data.video_analysis_prompt?.value || '',
            integrationPrompt: response.data.script_integration_prompt?.value || '',
            characterKnowledgeGraphPrompt: response.data.character_knowledge_graph_prompt?.value || '',
            characterIntegrationPrompt: response.data.character_integration_prompt?.value || '',
            characterPrompt: response.data.character_prompt?.value || ''
          }
        }
      } catch (error) {
        console.warn('加载系统默认Prompt失败:', error)
      }

      // 从项目数据中加载已保存的Prompt（优先使用项目自定义的）
      const formData = { ...defaultPrompts }
      const usingDefaults = { analysis: false, integration: false, characterKnowledgeGraph: false, characterIntegration: false, character: false }
      
      if (project) {
        if (project.analysis_prompt) {
          formData.analysis_prompt = project.analysis_prompt
        } else if (defaultPrompts.analysis_prompt) {
          formData.analysis_prompt = defaultPrompts.analysis_prompt
          usingDefaults.analysis = true
        }
        
        if (project.integration_prompt) {
          formData.integrationPrompt = project.integration_prompt
        } else if (defaultPrompts.integrationPrompt) {
          formData.integrationPrompt = defaultPrompts.integrationPrompt
          usingDefaults.integration = true
        }
        
        if (project.character_knowledge_graph_prompt) {
          formData.characterKnowledgeGraphPrompt = project.character_knowledge_graph_prompt
        } else if (defaultPrompts.characterKnowledgeGraphPrompt) {
          formData.characterKnowledgeGraphPrompt = defaultPrompts.characterKnowledgeGraphPrompt
          usingDefaults.characterKnowledgeGraph = true
        }

        if (project.character_integration_prompt) {
          formData.characterIntegrationPrompt = project.character_integration_prompt
        } else if (defaultPrompts.characterIntegrationPrompt) {
          formData.characterIntegrationPrompt = defaultPrompts.characterIntegrationPrompt
          usingDefaults.characterIntegration = true
        }

        if (project.character_prompt) {
          formData.characterPrompt = project.character_prompt
        } else if (defaultPrompts.characterPrompt) {
          formData.characterPrompt = defaultPrompts.characterPrompt
          usingDefaults.character = true
        }
      } else {
        // 如果没有项目数据，且有默认值，则设置默认值并标记为使用系统默认
        if (defaultPrompts.analysis_prompt) {
          formData.analysis_prompt = defaultPrompts.analysis_prompt
          usingDefaults.analysis = true
        }
        if (defaultPrompts.integrationPrompt) {
          formData.integrationPrompt = defaultPrompts.integrationPrompt
          usingDefaults.integration = true
        }
        if (defaultPrompts.characterKnowledgeGraphPrompt) {
          formData.characterKnowledgeGraphPrompt = defaultPrompts.characterKnowledgeGraphPrompt
          usingDefaults.characterKnowledgeGraph = true
        }
        if (defaultPrompts.characterIntegrationPrompt) {
          formData.characterIntegrationPrompt = defaultPrompts.characterIntegrationPrompt
          usingDefaults.characterIntegration = true
        }
        if (defaultPrompts.characterPrompt) {
          formData.characterPrompt = defaultPrompts.characterPrompt
          usingDefaults.character = true
        }
      }
      
      setUsingSystemDefaults(usingDefaults)
      
      // 设置表单值
      if (Object.keys(formData).length > 0) {
        form.setFieldsValue(formData)
      }
    } catch (error) {
      console.warn('加载保存的Prompt失败:', error)
    }
  }

  const loadProjectDetail = async () => {
    setLoading(true); 
    try {
      const response = await projectAPI.getDetail(id)
      setProject(response.project)
      setFiles(response.files || [])
      setTasks(response.tasks || [])
    } catch (error) {
      message.error('加载项目详情失败')
      navigate('/workspace')
    } finally {
      setLoading(false)
    }
  }

  // 加载角色知识图谱状态
  const loadCharacterGraphStatus = async () => {
    if (!files || files.length === 0) return;
    
    try {
      // 并行检查所有文件的角色知识图谱状态
      const promises = files.map(async (file) => {
        // 保留已有的失败状态，不覆盖
        const currentStatus = characterGraphStatusMap.get(file.id);
        if (currentStatus === 'failed') {
          return { fileId: file.id, status: 'failed' };
        }
        
        try {
          const response = await aiAPI.getFileResult(file.id, 'character_graph');
          if (response.success && response.result && response.result.trim() !== '') {
            return { fileId: file.id, status: 'success' };
          } else {
            return { fileId: file.id, status: 'pending' };
          }
        } catch (error) {
          // 文件没有角色知识图谱数据时设置为pending
          return { fileId: file.id, status: 'pending' };
        }
      });
      
      const results = await Promise.all(promises);
      
      // 更新状态映射，保留失败状态
      setCharacterGraphStatusMap(prev => {
        const newMap = new Map(prev);
        results.forEach(({ fileId, status }) => {
          newMap.set(fileId, status);
        });
        return newMap;
      });
    } catch (error) {
      console.error('加载角色知识图谱状态失败:', error);
    }
  };

  // 轻量级刷新项目数据，不触发全局loading
  const refreshProjectData = async () => {
    try {
      const response = await projectAPI.getDetail(id)
      setProject(response.project)
      setFiles(response.files || [])
      setTasks(response.tasks || [])
    } catch (error) {
      console.error('刷新项目数据失败:', error)
      // 不显示错误消息，避免干扰用户体验
    }
  }

  // 检查文件名是否已存在
  const checkFileNameExists = (fileName) => {
    return files.some(existingFile => existingFile.original_name === fileName);
  };

  const handleFileUpload = async (file) => {
    // 检查文件名是否已存在
    if (checkFileNameExists(file.name)) {
      message.warning(`${file.name}已存在，请检查后重新上传`);
      return false;
    }

    setUploading(true);
    try {
      const response = await fileAPI.upload(id, file, project.type);
      message.success(response.message);
      // 使用轻量级刷新，避免触发全局loading
      await refreshProjectData();
    } catch (error) {
      message.error(error.response?.data?.message || '文件上传失败');
    } finally {
      setUploading(false);
    }
    return false; // 阻止默认上传行为
  };

  const handleAIAnalysis = async (values) => {
    setAnalyzing(true)
    try {
      const response = await aiAPI.analyze({
        projectId: id,
        fileId: values.fileId,
        prompt: values.prompt,
        modelConfig: {
          temperature: values.temperature || 1,
          model: values.model || modelConfig.defaultModel
        }
      })
      message.success('AI分析任务已创建')
      form.resetFields()
      // 定期检查任务状态
      checkTaskStatus(response.taskId)
    } catch (error) {
      console.error(error);
      
      // 检查是否是API配置或连接问题
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
          errorMessage.includes('代理') || errorMessage.includes('连接') ||
          errorMessage.includes('proxy') || errorMessage.includes('timeout')) {
        message.warning('模型调用失败，请联系管理员检查系统配置', 6);
      } else {
        message.error('创建AI分析任务失败');
      }
    } finally {
      setAnalyzing(false)
    }
  }

  const checkTaskStatus = async (taskId) => {
    const interval = setInterval(async () => {
      try {
        const response = await aiAPI.getTaskStatus(taskId)
        if (response.task.status === 'completed' || response.task.status === 'failed') {
          clearInterval(interval)
          loadProjectDetail()
          if (response.task.status === 'completed') {
            message.success('AI分析完成')
          } else {
            message.error('AI分析失败')
          }
        }
      } catch (error) {
        clearInterval(interval)
        // 新增：403权限错误友好提示
        if (error.response?.status === 403) {
          message.error('无权访问该AI任务，请确认登录账号与项目归属一致')
          // 可选：自动刷新用户信息或跳转登录
          // window.location.reload()
        }
      }
    }, 3000)
  }

  // 队列状态监控函数
  const startQueuePolling = () => {
    // 如果已经在轮询，先清除
    if (queuePolling) {
      clearInterval(queuePolling);
    }

    const interval = setInterval(async () => {
      try {
        // 获取队列状态
        const response = await secureFetch('/api/queue/status');

        if (!response.ok) {
          throw new Error('获取队列状态失败');
        }

        const queueData = await response.json();
        
        // 检查是否有任务在处理或等待处理
        const hasPendingTasks = ((queueData.counts?.pending ?? queueData.statistics?.pending) ?? 0) > 0;
        const hasProcessingTasks = ((queueData.counts?.processing ?? queueData.statistics?.processing) ?? 0) > 0;
        const hasPausedTasks = ((queueData.counts?.paused ?? queueData.statistics?.paused) ?? 0) > 0;
        const totalQueueTasks = (queueData.statistics?.pending || 0) + (queueData.statistics?.processing || 0) + (queueData.statistics?.paused || 0);
        const totalActive = (queueData.totalActive ?? ((queueData.counts?.pending || 0) + (queueData.counts?.processing || 0) + (queueData.counts?.paused || 0))) || totalQueueTasks;
        
        // 更新队列计数（优先使用列表长度以保证与弹窗一致，其次使用后端精确计数）
        const arrayCount = ((queueData.processingTasks?.length || 0) + (queueData.pausedTasks?.length || 0) + (queueData.pendingTasks?.length || 0));
        setQueueCount(arrayCount > 0 ? arrayCount : totalActive);
        
        if (!hasPendingTasks && !hasProcessingTasks) {
          // 没有任务在处理，停止轮询并刷新项目数据
          clearInterval(interval);
          setQueuePolling(null);
          console.log('🔄 队列处理完成，自动刷新项目数据');
          await loadProjectDetail();
          message.success('队列任务已完成，数据已自动更新');
        } else {
          console.log(`📊 队列状态: 待处理 ${queueData.statistics?.pending || 0}, 处理中 ${queueData.statistics?.processing || 0}, 已暂停 ${queueData.statistics?.paused || 0}`);
        }
      } catch (error) {
        console.error('队列状态检查失败:', error);
        // 发生错误时也停止轮询，避免无限请求
        clearInterval(interval);
        setQueuePolling(null);
      }
    }, 10000); // 每10秒检查一次

    setQueuePolling(interval);
    console.log('🚀 开始队列状态监控');
  }

  // 停止队列轮询
  const stopQueuePolling = () => {
    if (queuePolling) {
      clearInterval(queuePolling);
      setQueuePolling(null);
      console.log('⏹️ 停止队列状态监控');
    }
  }

  // 获取队列任务数量
  const fetchQueueCount = async () => {
    try {
      const response = await secureFetch('/api/queue/status');

      if (response.ok) {
        const data = await response.json();
        const arrayCount = ((data.processingTasks?.length || 0) + (data.pausedTasks?.length || 0) + (data.pendingTasks?.length || 0));
        const statCount = (data.statistics?.pending || 0) + (data.statistics?.processing || 0) + (data.statistics?.paused || 0);
        const count = arrayCount > 0 
          ? arrayCount 
          : ((data.totalActive ?? ((data.counts?.pending || 0) + (data.counts?.processing || 0) + (data.counts?.paused || 0))) || statCount);
        setQueueCount(count);
      }
    } catch (error) {
      console.error('获取队列数量失败:', error);
    }
  }

  // 单文件结果刷新：在任务完成事件后，拉取该文件的最新视频解析结果并更新本地状态
  const refreshFileAnalysisResult = async (fileId) => {
    try {
      const resp = await aiAPI.getFileResult(fileId, 'video_analysis');
      if (resp.success && resp.result !== undefined && resp.result !== null) {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, task_result: resp.result } : f)));
      }
    } catch (e) {
      // 忽略瞬时错误，避免打扰用户
    }
  };

  // 订阅后端事件：单个任务完成后自动刷新对应文件的解析结果
  useEffect(() => {
    // 仅在详情页可见时订阅，否则立即退出
    const es = new EventSource('/api/events');
    const onCompleted = (e) => {
      try {
        const payload = JSON.parse(e.data || '{}');
        if (!payload) return;
        if (String(payload.projectId) === String(id) && payload.fileId) {
          refreshFileAnalysisResult(payload.fileId);
        }
      } catch (_) {}
    };
    es.addEventListener('task-completed', onCompleted);
    // 可选：失败时刷新队列或提示
    const onFailed = () => {
      // 失败不更新文本，但可以触发队列刷新
      // loadQueueStatus?.(); // 若需要可启用
    };
    es.addEventListener('task-failed', onFailed);

    return () => {
      try { es.close(); } catch (_) {}
    };
  }, [id]);

  // 组件卸载时清理轮询
  useEffect(() => {
    return () => {
      stopQueuePolling();
    };
  }, [])

  // 组件加载时获取队列数量，并定期更新
  useEffect(() => {
    fetchQueueCount(); // 初始加载
    
    const interval = setInterval(fetchQueueCount, 30000); // 每30秒更新一次
    
    return () => clearInterval(interval);
  }, [])

  // 计算处理后的文件列表，包含数据合并、筛选和排序
  const processedFiles = useMemo(() => {
    // 首先合并文件和任务数据
    const processedData = files.map(file => {
      const relatedTasks = tasks.filter(t => t.file_id === file.id);
      
      // 分别获取不同类型的任务
      const videoAnalysisTasks = relatedTasks
        .filter(t => t.task_type === 'video_analysis' || !t.task_type) // 兼容旧数据没有task_type
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      const latestVideoAnalysisTask = videoAnalysisTasks[0];
      
      return {
        ...file,
        // 视频解析任务的状态和结果
        task_status: latestVideoAnalysisTask?.status || 'pending',
        task_result: latestVideoAnalysisTask?.result,
        task_prompt: latestVideoAnalysisTask?.prompt,
        task_error: latestVideoAnalysisTask?.error_message,
      };
    });

    // 然后应用筛选
    let filtered = processedData;
    
    // 按视频解析状态筛选 - 简化为三种状态
    if (analysisStatusFilter !== 'all') {
      if (analysisStatusFilter === 'pending') {
        // 待解析状态包括pending和processing
        filtered = filtered.filter(f => f.task_status === 'pending' || f.task_status === 'processing');
      } else {
        // 已完成和失败状态保持不变
        filtered = filtered.filter(f => f.task_status === analysisStatusFilter);
      }
    }
    
    // 按角色图谱生成状态筛选 - 简化为四种状态
    if (characterGraphFilter !== 'all') {
      if (characterGraphFilter === 'completed') {
        filtered = filtered.filter(f => characterGraphStatusMap.get(f.id) === 'success');
      } else if (characterGraphFilter === 'pending') {
        // 待生成状态包括pending和processing
        filtered = filtered.filter(f => {
          const status = characterGraphStatusMap.get(f.id);
          return !status || status === 'pending' || characterGraphProcessingIds.has(f.id);
        });
      } else if (characterGraphFilter === 'failed') {
        filtered = filtered.filter(f => characterGraphStatusMap.get(f.id) === 'failed');
      }
    }
    
    // 最后应用排序
    return filtered.sort((a, b) => {
      const getNumericValue = (filename) => {
        const match = filename.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };
      
      const aValue = getNumericValue(a.original_name);
      const bValue = getNumericValue(b.original_name);
      
      if (sortOrder === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });
  }, [files, tasks, analysisStatusFilter, characterGraphFilter, sortOrder, characterGraphStatusMap, characterGraphProcessingIds]);

  // 计算状态统计（需要先生成基本的processedData用于统计）
  const statusStatistics = useMemo(() => {
    // 先生成基本的处理数据
    const basicProcessedData = files.map(file => {
      const relatedTasks = tasks.filter(t => t.file_id === file.id);
      const videoAnalysisTasks = relatedTasks
        .filter(t => t.task_type === 'video_analysis' || !t.task_type)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const latestVideoAnalysisTask = videoAnalysisTasks[0];
      
      return {
        ...file,
        task_status: latestVideoAnalysisTask?.status || 'pending',
      };
    });

    const stats = {
      total: basicProcessedData.length,
      analysis: {
        pending: 0,  // 待解析（包括pending和processing）
        completed: 0, // 已完成
        failed: 0     // 失败
      },
      characterGraph: {
        pending: 0,   // 待解析（包括pending和processing）
        completed: 0, // 已完成
        failed: 0     // 失败
      }
    };
    
    basicProcessedData.forEach(file => {
      // 统计视频解析状态 - 简化为三种状态
      const status = file.task_status;
      if (status === 'completed') {
        stats.analysis.completed++;
      } else if (status === 'failed') {
        stats.analysis.failed++;
      } else {
        // pending, processing 或其他状态都归类为待解析
        stats.analysis.pending++;
      }
      
      // 统计角色图谱生成状态 - 简化为三种状态
      if (characterGraphProcessingIds.has(file.id)) {
        stats.characterGraph.pending++; // 正在处理归类为待解析
      } else {
        const graphStatus = characterGraphStatusMap.get(file.id);
        if (graphStatus === 'success') {
          stats.characterGraph.completed++;
        } else if (graphStatus === 'failed') {
          stats.characterGraph.failed++;
        } else {
          stats.characterGraph.pending++;
        }
      }
    });
    
    return stats;
  }, [files, tasks, characterGraphStatusMap, characterGraphProcessingIds]);

  // 计算分页显示的文件
  const paginatedFiles = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedFiles.slice(startIndex, startIndex + pageSize);
  }, [processedFiles, currentPage, pageSize]);

  const handleSavePrompts = async (values) => {
    try {
      await projectAPI.update(id, { ...values })
      message.success('配置保存成功')
      loadProjectDetail()
    } catch (error) {
      message.error('配置保存失败')
    }
  }

  // 从文件名中提取集数
  const extractEpisodeNumber = (filename) => {
    const match = filename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  const handleConfirmSelectionAndAddToDraft = () => {
    const selectedFiles = processedFiles.filter(f => modalSelectedFileIds.has(f.id));
    const contentToDraft = selectedFiles
      .map(f => {
        const episodeNum = extractEpisodeNumber(f.original_name);
        const episodeTitle = episodeNum ? `第${episodeNum}集` : f.original_name;
        return `${episodeTitle}\n\n${f.task_result || '无内容'}`;
      })
      .join('\n\n---\n\n');
    
    // 无论之前是否有内容，都直接覆盖
    setDraftContent(contentToDraft);
    setIsSelectionModalVisible(false);
    setModalSelectedFileIds(new Set());
    message.success(`${selectedFiles.length}个文件内容已更新到草稿区`);
  };

  const handleIntegrate = async (values) => {
    if (!draftContent.trim()) {
      message.warning('整合草稿区内容不能为空');
      return;
    }
    
    setIntegrating(true)
    try {
      console.log('Integration values:', values); // 调试日志
      const response = await aiAPI.integrate({ 
        projectId: id,
        integrationPrompt: values.integrationPrompt,
        draftContent: draftContent,
        modelConfig: {
          model: values.integration_model || modelConfig.defaultModel,
          temperature: values.integration_temperature || 1
        }
      })
      setIntegrationResult(response.integratedScript)
      message.success('整合成功')
    } catch (error) {
      console.error(error)
      
      // 检查是否是API配置或连接问题
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
          errorMessage.includes('代理') || errorMessage.includes('连接') ||
          errorMessage.includes('proxy') || errorMessage.includes('timeout')) {
        message.warning('模型调用失败，请联系管理员检查系统配置', 6);
      } else {
        message.error(`整合失败: ${errorMessage}`);
      }
      
      setIntegrationResult(`整合失败: ${errorMessage}`);
    } finally {
      setIntegrating(false)
    }
  }

  const handleArchive = async () => {
    if (!integrationResult) {
      message.warn('没有可存档的内容');
      return;
    }
    setArchiveTitle(project?.name || '未命名存档');
    setIsArchiveModalVisible(true);
  };

  const handleConfirmArchive = async () => {
    if (!archiveTitle) {
      message.warn('请输入存档标题');
      return;
    }
    try {
      await knowledgeBaseAPI.archive({
        title: archiveTitle,
        content: integrationResult,
        projectId: id
      });
      message.success('已成功存档到知识库');
      setIsArchiveModalVisible(false);
      setArchiveTitle('');
    } catch (error) {
      message.error('存档失败');
    }
  };

  const handleRenameFile = async (fileId, newName) => {
    try {
      await fileAPI.renameFile(fileId, newName);
      message.success("文件名修改成功");
      setFiles(files.map(f => f.id === fileId ? {...f, original_name: newName} : f));
    } catch (error) {
       message.error(error.response?.data?.message || "文件名修改失败");
    }
  }

  const handleDeleteFile = async (fileId) => {
    try {
      await fileAPI.delete(fileId);
      message.success("文件删除成功");
      setFiles(files.filter(f => f.id !== fileId));
    } catch(error) {
      message.error(error.response?.data?.message || "文件删除失败");
    }
  }

  const handleAnalyseOne = async (fileId) => {
    message.info(`开始解析文件 (ID: ${fileId})...`);
    // Here you would call the AI analysis API for a single file
    // For now, it's a placeholder
  }

  const handleEditAnalysisResult = (fileId, newResult, isTemporary = false) => {
    const newFiles = files.map(f => {
      if (f.id === fileId) {
        return { ...f, task_result: newResult };
      }
      return f;
    });
    setFiles(newFiles);

    if(!isTemporary) {
      // Here you would call an API to save the result permanently
      // e.g., fileAPI.updateResult(fileId, newResult)
      message.success("解析结果已更新（前端）");
    }
  }

  const handleFileSelect = (fileId, checked) => {
    setSelectedFileIds(prev => {
      const newSet = new Set(prev);
      if(checked) newSet.add(fileId);
      else newSet.delete(fileId);
      return newSet;
    })
  }

  const handleSelectAll = () => {
    const allFileIds = processedFiles.map(f => f.id);
    const newSelectedFileIds = new Set(selectedFileIds);
    if (allFilesSelected) {
      // 取消全选
      allFileIds.forEach(id => newSelectedFileIds.delete(id));
    } else {
      // 全选所有视频
      allFileIds.forEach(id => newSelectedFileIds.add(id));
    }
    setSelectedFileIds(newSelectedFileIds);
  }

  // 处理名称排序变化
  const handleSortChange = () => {
    // 切换名称排序方向
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    // 排序后回到第一页
    setCurrentPage(1);
  }

  // 清除选择的处理函数
  const handleClearSelection = () => {
    setSelectedFileIds(new Set());
  }

  // 显示统计信息的处理函数
  const handleShowStatistics = () => {
    Modal.info({
      title: '视频解析统计',
      content: (
        <div>
          <p><strong>总计:</strong> {statusStatistics.total} 个视频</p>
          <p><strong>解析状态:</strong></p>
          <ul>
            <li>已完成: {statusStatistics.analysis.completed} 个</li>
            <li>解析失败: {statusStatistics.analysis.failed} 个</li>
            <li>等待解析: {statusStatistics.analysis.pending} 个</li>
          </ul>
          <p><strong>角色图谱:</strong></p>
          <ul>
            <li>已生成: {statusStatistics.characterGraph.completed} 个</li>
            <li>生成失败: {statusStatistics.characterGraph.failed} 个</li>
            <li>等待生成: {statusStatistics.characterGraph.pending} 个</li>
          </ul>
        </div>
      ),
      width: 400,
    });
  }



  const handleAnalyseFiles = async (fileIds) => {
    if (analyzing) return;
    setAnalyzing(true);
    
    // 限制批量解析最多10个文件
    const maxFiles = 10;
    let filesToProcess = fileIds;
    
    if (fileIds.length > maxFiles) {
      message.warning(`批量解析一次最多处理${maxFiles}个文件，已自动选择前${maxFiles}个文件进行解析`);
      filesToProcess = fileIds.slice(0, maxFiles);
    }
    
    message.info(`开始为 ${filesToProcess.length} 个文件创建解析任务...`);
    
    const { analysis_prompt, temperature, model, top_k, top_p, max_output_tokens } = form.getFieldsValue();
    
    if (!analysis_prompt) {
      message.error('请输入内容解析的Prompt');
      setAnalyzing(false);
      return;
    }

    // 保存最新的Prompt到数据库
    await savePromptToDatabase('analysis', analysis_prompt);

    try {
      const taskPromises = [];
      
      // 标记文件为处理中状态
      setProcessingFileIds(prev => new Set([...prev, ...filesToProcess]));
      
      for (const fileId of filesToProcess) {
        const file = files.find(f => f.id === fileId);
        const data = {
          projectId: id,
          fileId: fileId,
          prompt: analysis_prompt,
          modelConfig: {
            model: model || modelConfig.defaultModel,
            temperature: temperature || 1,
            topK: top_k,
            topP: top_p,
            maxOutputTokens: max_output_tokens
          },
          // 单击解析优先调度：当且仅当是单个文件调用时设置优先级
          priority: filesToProcess.length === 1
        };
        
        // 创建任务并立即开始轮询
        const taskPromise = (async () => {
          try {
            const response = await aiAPI.analyze(data);
            if (response.taskId) {
              message.success(`${file?.original_name} 开始解析`);
              
              // 轮询任务状态
              const pollTaskStatus = async () => {
                let completed = false;
                while (!completed) {
                  await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒
                  
                  try {
                    const statusResponse = await aiAPI.getTaskStatus(response.taskId);
                    const task = statusResponse.task;
                    
                    if (task.status === 'completed') {
                      // 任务完成，更新任务状态和结果
                      setTasks(prevTasks => {
                        // 检查是否已经存在该任务，避免重复添加
                        const existingTaskIndex = prevTasks.findIndex(t => t.id === task.id);
                        if (existingTaskIndex >= 0) {
                          // 更新现有任务
                          const newTasks = [...prevTasks];
                          newTasks[existingTaskIndex] = task;
                          return newTasks;
                        } else {
                          // 添加新任务
                          return [...prevTasks, task];
                        }
                      });
                      setProcessingFileIds(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(fileId);
                        return newSet;
                      });
                      
                      // 延迟一小段时间确保状态更新完成，强制重新渲染
                      setTimeout(() => {
                        // 触发一次状态更新以确保界面刷新
                        setTasks(prevTasks => [...prevTasks]);
                      }, 100);
                      
                      message.success(`${file?.original_name} 解析完成`);
                      completed = true;
                    } else if (task.status === 'failed') {
                      // 任务失败，更新任务状态
                      setTasks(prevTasks => {
                        // 检查是否已经存在该任务，避免重复添加
                        const existingTaskIndex = prevTasks.findIndex(t => t.id === task.id);
                        if (existingTaskIndex >= 0) {
                          // 更新现有任务
                          const newTasks = [...prevTasks];
                          newTasks[existingTaskIndex] = task;
                          return newTasks;
                        } else {
                          // 添加新任务
                          return [...prevTasks, task];
                        }
                      });
                      setProcessingFileIds(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(fileId);
                        return newSet;
                      });
                      
                      // 延迟一小段时间确保状态更新完成，强制重新渲染
                      setTimeout(() => {
                        // 触发一次状态更新以确保界面刷新
                        setTasks(prevTasks => [...prevTasks]);
                      }, 100);
                      
                      // 检查是否是API配置或连接问题
                      const errorMessage = task.error_message || '未知错误';
                      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
                          errorMessage.includes('代理') || errorMessage.includes('连接') ||
                          errorMessage.includes('proxy') || errorMessage.includes('timeout')) {
                        message.warning(`${file?.original_name} 模型调用失败，请联系管理员检查系统配置`, 6);
                      } else {
                        message.error(`${file?.original_name} 解析失败: ${errorMessage}`);
                      }
                      completed = true;
                    }
                    // 如果还是 processing 或 pending，继续轮询
                  } catch (error) {
                    console.error('轮询任务状态失败:', error);
                    // 继续轮询，不中断
                  }
                }
              };
              
              pollTaskStatus();
            } else {
              // 创建失败的任务记录以便UI能正确显示失败状态
              const failedTask = {
                id: `failed_create_${fileId}_${Date.now()}`, // 生成临时ID
                file_id: fileId,
                project_id: parseInt(id),
                status: 'failed',
                error_message: '解析任务创建失败',
                task_type: 'video_analysis',
                created_at: new Date().toISOString(),
                completed_at: new Date().toISOString()
              };
              
              // 添加失败任务到任务列表
              setTasks(prevTasks => [...prevTasks, failedTask]);
              
              message.warning(`${file?.original_name} 解析任务创建失败`);
              setProcessingFileIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(fileId);
                return newSet;
              });
            }
          } catch (error) {
            // 检查是否是API配置或连接问题
            const errorMessage = error.response?.data?.message || error.message || '未知错误';
            
            // 创建失败的任务记录以便UI能正确显示失败状态
            const failedTask = {
              id: `failed_${fileId}_${Date.now()}`, // 生成临时ID
              file_id: fileId,
              project_id: parseInt(id),
              status: 'failed',
              error_message: errorMessage,
              task_type: 'video_analysis',
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString()
            };
            
            // 添加失败任务到任务列表
            setTasks(prevTasks => [...prevTasks, failedTask]);
            
            if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
                errorMessage.includes('代理') || errorMessage.includes('连接') ||
                errorMessage.includes('proxy') || errorMessage.includes('timeout') ||
                errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
              message.warning(`${file?.original_name} 模型调用失败，请联系管理员检查系统配置`, 6);
            } else {
              message.error(`${file?.original_name} 解析失败: ${errorMessage}`);
            }
            
            setProcessingFileIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(fileId);
              return newSet;
            });
          }
        })();
        
        taskPromises.push(taskPromise);
      }
      
      // 等待所有任务创建完成
      await Promise.all(taskPromises);
      
      // 启动批量解析完成监控
      const batchStartTime = Date.now();
      const startedFileIds = [...filesToProcess]; // 保存实际处理的文件列表
      
      const monitorBatchCompletion = () => {
        const monitorInterval = setInterval(() => {
          // 检查还有多少文件在处理中
          const currentProcessingIds = Array.from(processingFileIds);
          const stillProcessingBatchFiles = startedFileIds.filter(id => currentProcessingIds.includes(id));
          
          console.log('🔍 监控批量解析进度:', {
            total: startedFileIds.length,
            stillProcessing: stillProcessingBatchFiles.length,
            completed: startedFileIds.length - stillProcessingBatchFiles.length
          });
          
          // 如果所有批量文件都处理完成了
          if (stillProcessingBatchFiles.length === 0) {
            clearInterval(monitorInterval);
            
            // 最终数据刷新
            setTimeout(async () => {
              try {
                console.log('🎉 批量解析全部完成！最终刷新数据...');
                const tasksResponse = await aiAPI.getProjectTasks(id);
                if (tasksResponse && tasksResponse.tasks) {
                  setTasks(tasksResponse.tasks);
                  const processingTime = Math.round((Date.now() - batchStartTime) / 1000);
                  // 取消批量解析完成的通知
                  // message.success(`🎉 批量解析完成！成功处理 ${startedFileIds.length} 个文件，耗时 ${processingTime} 秒`, 4);
                  console.log('✅ 批量解析最终数据同步完成');
                }
              } catch (error) {
                console.error('❌ 批量解析完成后最终数据刷新失败:', error);
                message.warning('批量解析完成，但数据刷新失败，请手动刷新页面');
              }
            }, 2000); // 延迟2秒确保数据完全同步
          }
        }, 6000); // 每6秒检查一次进度
        
        // 防止无限轮询，最多监控20分钟
        setTimeout(() => {
          clearInterval(monitorInterval);
          console.log('⏰ 批量解析监控超时结束');
        }, 20 * 60 * 1000);
      };
      
      // 延迟启动监控，给任务创建一些时间
      setTimeout(monitorBatchCompletion, 8000);
      
      // 批量解析启动后，先刷新一次数据
      setTimeout(async () => {
        try {
          console.log('🔄 批量解析启动完成，初始数据刷新...');
          const tasksResponse = await aiAPI.getProjectTasks(id);
          if (tasksResponse && tasksResponse.tasks) {
            setTasks(tasksResponse.tasks);
            console.log('✅ 批量解析启动后初始数据已刷新');
          }
        } catch (error) {
          console.error('❌ 批量解析启动后初始数据刷新失败:', error);
        }
      }, 5000); // 5秒后先刷新一次数据
      
    } catch (error) {
      console.error('AI分析任务创建失败:', error);
      
      // 检查是否是API配置或连接问题
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      
      // 为每个尝试处理但失败的文件创建失败记录
      const failedTasks = filesToProcess.map(fileId => {
        const file = files.find(f => f.id === fileId);
        return {
          id: `failed_batch_${fileId}_${Date.now()}`, // 生成临时ID
          file_id: fileId,
          project_id: parseInt(id),
          status: 'failed',
          error_message: `批量解析失败: ${errorMessage}`,
          task_type: 'video_analysis',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString()
        };
      });
      
      // 添加所有失败任务到任务列表
      setTasks(prevTasks => [...prevTasks, ...failedTasks]);
      
      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
          errorMessage.includes('代理') || errorMessage.includes('连接') ||
          errorMessage.includes('proxy') || errorMessage.includes('timeout') ||
          errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
        message.warning('模型调用失败，请联系管理员检查系统配置', 6);
      } else {
        message.error(errorMessage || 'AI分析任务创建失败');
      }
      
      // 清除处理状态
      setProcessingFileIds(prev => {
        const newSet = new Set(prev);
        filesToProcess.forEach(id => newSet.delete(id));
        return newSet;
      });
    } finally {
      setAnalyzing(false);
    }
  };

  // 任务自动刷新（默认开启）
  useEffect(() => {
    let timer;
    const fetchTasks = async () => {
      try {
        const tasksResponse = await aiAPI.getProjectTasks(id);
        if (tasksResponse && tasksResponse.tasks) {
          setTasks(tasksResponse.tasks);
        }
      } catch (e) {
        // 静默失败
      }
    };
    fetchTasks();
    timer = setInterval(fetchTasks, 3000);
    return () => clearInterval(timer);
  }, [id]);

  // 任务面板操作
  const pauseTask = async (taskId) => {
    try {
      await aiAPI.pauseTask(taskId);
      const res = await aiAPI.getProjectTasks(id);
      if (res?.tasks) setTasks(res.tasks);
    } catch {}
  };
  const resumeTask = async (taskId) => {
    try {
      await aiAPI.resumeTask(taskId);
      const res = await aiAPI.getProjectTasks(id);
      if (res?.tasks) setTasks(res.tasks);
    } catch {}
  };
  const cancelTask = async (taskId) => {
    try {
      await aiAPI.cancelTask(taskId);
      const res = await aiAPI.getProjectTasks(id);
      if (res?.tasks) setTasks(res.tasks);
    } catch {}
  };

  const runningTasks = useMemo(() => tasks.filter(t => t.status === 'processing'), [tasks]);
  const queuedTasks = useMemo(() => tasks.filter(t => t.status === 'pending' || t.status === 'paused'), [tasks]);
  const badgeCount = runningTasks.length + queuedTasks.length;


  const handleEditResultModal = (file) => {
    setEditingFile(file);
    setEditContent(file.task_result || '');
    // 初始化名称确认面板
    setNameInputs({});
  }
  
  const handleSaveAnalysisResult = async () => {
    if (!editingFile) return;
    
    try {
      console.log('📝 开始保存解析结果:', {
        fileId: editingFile.id,
        fileName: editingFile.original_name,
        contentLength: editContent.length
      });
      
      // 先更新后端
      const response = await fileAPI.updateAnalysisResult(editingFile.id, editContent);
      console.log('✅ 后端保存成功:', response);
      
      // 重新加载项目任务数据，确保前后端数据一致
      const tasksResponse = await aiAPI.getProjectTasks(id);
      if (tasksResponse && tasksResponse.tasks) {
        setTasks(tasksResponse.tasks);
        console.log('🔄 任务数据已刷新:', tasksResponse.tasks.length);
      }
      
      // 关闭编辑模态框
      setEditingFile(null);
      setEditContent('');
      
      message.success(`${editingFile.original_name} 的解析结果已保存！`);
      
      console.log('✅ 解析结果保存完成');
    } catch (error) {
      console.error('❌ 保存解析结果失败:', {
        fileId: editingFile.id,
        fileName: editingFile.original_name,
        error: error.message,
        response: error.response?.data
      });
      
      const errorMessage = error.response?.data?.message || error.message || '保存失败，请重试';
      message.error(`保存失败: ${errorMessage}`);
    }
  }

  // ===== 人物名称确认：工具与逻辑 =====
  // 项目级名称历史存储键
  const getNameHistoryKey = () => draftStorageKey('characterStandardNameHistory');

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const loadNameHistory = () => {
    try {
      const raw = sessionStorage.getItem(getNameHistoryKey());
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) setNameHistory(list);
    } catch {}
  };

  const saveNameHistory = (list) => {
    try {
      sessionStorage.setItem(getNameHistoryKey(), JSON.stringify(list));
    } catch {}
  };

  const addToHistory = (name) => {
    const v = (name || '').trim();
    if (!v) return;
    
    // 如果输入的是纯数字，不计入记忆
    if (/^\d+$/.test(v)) {
      return;
    }
    
    setNameHistory((prev) => {
      const exists = prev.includes(v);
      const next = exists ? prev : [v, ...prev].slice(0, 50);
      saveNameHistory(next);
      return next;
    });
  };

  const extractBracketTerms = (text) => {
    const re = /\[([^\[\]]+)\]/g; // 仅 ASCII []
    const counter = new Map();
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = (m[1] || '').trim();
      if (!raw) continue;
      counter.set(raw, (counter.get(raw) || 0) + 1);
    }
    const list = Array.from(counter.entries()).map(([raw, count]) => ({ raw, count }));
    return list;
  };

  const refreshExtraction = () => {
    setBracketTerms(extractBracketTerms(editContent || ''));
  };

  const handleNameInputChange = (raw, value) => {
    setNameInputs((prev) => ({ ...prev, [raw]: value }));
  };

  const replaceOne = (sourceRaw, targetName) => {
    const t = (targetName || '').trim();
    if (!t) return;
    const pattern = new RegExp('\\[' + escapeRegExp(sourceRaw) + '\\]', 'g');
    const newContent = (editContent || '').replace(pattern, t);
    setEditContent(newContent);
    addToHistory(t);
    // 同步刷新提取列表，避免需要点击两次
    setBracketTerms(extractBracketTerms(newContent));
  };

  const handleReplaceOne = (raw) => {
    const target = nameInputs[raw] || '';
    if (!target.trim()) return;
    replaceOne(raw, target);
  };

  // 去括号：仅移除 []，保留原称谓（区分大小写）
  const handleStripBrackets = (raw) => {
    const pattern = new RegExp('\\[' + escapeRegExp(raw) + '\\]', 'g');
    const newContent = (editContent || '').replace(pattern, raw);
    setEditContent(newContent);
    setBracketTerms(extractBracketTerms(newContent));
    message.success('已去括号');
  };

  const handleReplaceAll = () => {
    let content = editContent || '';
    const usedNames = [];
    bracketTerms.forEach(({ raw }) => {
      const target = (nameInputs[raw] || '').trim();
      if (!target) return;
      const pattern = new RegExp('\\[' + escapeRegExp(raw) + '\\]', 'g');
      content = content.replace(pattern, target);
      usedNames.push(target);
    });
    setEditContent(content);
    Array.from(new Set(usedNames)).forEach(addToHistory);
    // 同步刷新提取列表
    setBracketTerms(extractBracketTerms(content));
  };

  const handleRefreshExtraction = () => {
    // 清空批量替换输入并刷新提取
    setBatchFindText('');
    setBatchReplaceText('');
    setBatchMatchCount(null);
    refreshExtraction();
  };

  // ===== 批量替换：自动计数与替换 =====
  useEffect(() => {
    const find = (batchFindText || '').trim();
    if (!find) {
      setBatchMatchCount(null);
      return;
    }
    try {
      const re = new RegExp(escapeRegExp(find), 'gi');
      const matches = (editContent || '').match(re);
      setBatchMatchCount(matches ? matches.length : 0);
    } catch (e) {
      setBatchMatchCount(null);
    }
  }, [batchFindText, editContent]);

  const handleBatchReplaceAll = () => {
    const find = (batchFindText || '').trim();
    if (!find) {
      message.warning('请输入查找文本');
      return;
    }
    const re = new RegExp(escapeRegExp(find), 'gi');
    const matches = (editContent || '').match(re);
    const count = matches ? matches.length : 0;
    if (count === 0) {
      message.info('未找到匹配项');
      setBatchMatchCount(0);
      return;
    }
    const replacement = batchReplaceText ?? '';
    if (!replacement.trim() && !batchWarnedEmptyReplace) {
      message.warning('将把所有匹配替换为空');
      setBatchWarnedEmptyReplace(true);
    }
    const newContent = (editContent || '').replace(re, replacement);
    setEditContent(newContent);
    setBatchMatchCount(count);
    if (replacement.trim()) addToHistory(replacement);
    setTimeout(refreshExtraction, 0);
    message.success(`已替换 ${count} 处`);
  };

  // ===== 直接拼接选中文件的剧本并进入完整剧本流程 =====
  const handleDirectConcatenate = async () => {
    // 获取要拼接的文件：选中的已完成解析的文件
    const candidates = selectedFileIds.size > 0 
      ? processedFiles.filter(f => selectedFileIds.has(f.id) && f.task_status === 'completed')
      : processedFiles.filter(f => f.task_status === 'completed');
    
    if (candidates.length === 0) {
      message.warning('没有可拼接的文件，请先选择已完成解析的视频');
      return;
    }

    // 按文件名排序（数字升序）
    const sortedFiles = candidates.sort((a, b) => {
      const aNum = extractEpisodeNumber(a.original_name || '') || 0;
      const bNum = extractEpisodeNumber(b.original_name || '') || 0;
      return aNum - bNum;
    });

    // 拼接内容
    const concatenatedContent = sortedFiles
      .map(f => f.task_result || '')
      .filter(content => content.trim())
      .join('\n\n---\n\n');

    if (!concatenatedContent.trim()) {
      message.warning('选中的文件没有解析内容可以拼接');
      return;
    }

    try {
      // 确保有完整剧本记录
      let currentScript = fullScript;
      if (!currentScript) {
        const newScript = await fullScriptsAPI.createFullScript(id, { scriptName: '完整剧本' });
        setFullScript(newScript);
        currentScript = newScript;
      }

      // 调用后端接口持久化拼接内容并推进到步骤2
      const updated = await fullScriptsAPI.quickConcat(currentScript.id, concatenatedContent);
      setFullScript(updated);
      setFullScriptConcatenatedContent(updated?.concatenated_content || concatenatedContent);
      setFullScriptCurrentStep(updated?.current_step || 2);
      
      // 切换到完整剧本标签页
      setActiveTabKey('4');
      
      message.success(`已拼接 ${sortedFiles.length} 集内容，已进入完整剧本审核流程`);
    } catch (error) {
      console.error('拼接失败:', error);
      message.error('拼接失败，请重试');
    }
  };

  // 更多操作菜单项
  const moreActions = useMemo(() => [
    {
      label: '拼接剧本',
      icon: <PicCenterOutlined />,
      onClick: handleDirectConcatenate,
      disabled: processedFiles.filter(f => 
        selectedFileIds.size === 0 
          ? f.task_status === 'completed' 
          : (selectedFileIds.has(f.id) && f.task_status === 'completed')
      ).length === 0
    }
  ], [processedFiles, selectedFileIds]);

  // 移除了不再需要的集数选择相关函数

  // 原 handleQuickConcatConfirm 函数已移除，现在直接拼接

  // 当打开编辑弹框或内容变化时，刷新提取
  useEffect(() => {
    if (editingFile) {
      loadNameHistory();
      refreshExtraction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFile]);

  useEffect(() => {
    if (editingFile) refreshExtraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent]);

  const handleDeleteFiles = async (fileIds) => {
     if (fileIds.length === 0) return;
    try {
      // In a real scenario, you'd likely have a bulk delete endpoint
      for (const fileId of fileIds) {
        await fileAPI.delete(fileId);
      }
      message.success(`成功删除了 ${fileIds.length} 个文件`);
      setFiles(files.filter(f => !fileIds.includes(f.id)));
      setSelectedFileIds(new Set());
    } catch(error) {
      message.error(error.response?.data?.message || "文件删除失败");
    }
  }

  const handleDownloadFiles = (fileIds) => {
    if (fileIds.length === 0) return;
    
    fileIds.forEach(fileId => {
      const file = files.find(f => f.id === fileId);
      if (file) {
        const downloadUrl = fileAPI.getDownloadUrl(fileId);
        // 创建一个隐藏的下载链接
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = file.original_name;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    });
    
    message.success(`开始下载 ${fileIds.length} 个文件`);
    
    // 如果是批量下载，清除选择
    if (fileIds.length > 1) {
      setSelectedFileIds(new Set());
    }
  }

  const allFilesSelected = useMemo(() => 
    processedFiles.length > 0 && processedFiles.every(f => selectedFileIds.has(f.id)),
    [processedFiles, selectedFileIds]
  );

  const handleSaveAnalysisPrompt = async (prompt, showSuccessMessage = true) => {
    try {
        await projectAPI.update(id, { analysis_prompt: prompt });
        // 更新本地项目数据
        setProject(prev => ({ ...prev, analysis_prompt: prompt }))
        if (showSuccessMessage) {
          message.success('内容解析Prompt已保存');
        }
        form.setFieldsValue({ analysis_prompt: prompt });
    } catch (error) {
        message.error('保存失败');
    }
  }

  const handleSaveIntegrationPrompt = async (prompt, showSuccessMessage = true) => {
    try {
        await projectAPI.update(id, { integration_prompt: prompt });
        // 更新本地项目数据
        setProject(prev => ({ ...prev, integration_prompt: prompt }))
        if (showSuccessMessage) {
          message.success('剧本整合Prompt已保存');
        }
        form.setFieldsValue({ integrationPrompt: prompt });
    } catch (error) {
        message.error('保存失败');
    }
  }

  // 保存Prompt到数据库
  const savePromptToDatabase = async (type, prompt) => {
    try {
      const updateData = {}
      updateData[`${type}_prompt`] = prompt
      
      await projectAPI.update(id, updateData)
      
      // 更新本地项目数据
      setProject(prev => ({ ...prev, [`${type}_prompt`]: prompt }))
      
    } catch (error) {
      console.warn('保存Prompt到数据库失败:', error)
      throw error
    }
  }

  const handleSelectAllInModal = () => {
    const completedFiles = processedFiles.filter(f => f.task_status === 'completed');
    const allCompletedFileIds = completedFiles.map(f => f.id);
    
    // Check if all completed files are currently selected in the modal
    const allCurrentlySelected = allCompletedFileIds.length > 0 && allCompletedFileIds.every(id => modalSelectedFileIds.has(id));

    if (allCurrentlySelected) {
      setModalSelectedFileIds(new Set()); // Deselect all
    } else {
      setModalSelectedFileIds(new Set(allCompletedFileIds)); // Select all
    }
  };

  // 加载系统默认的视频解析Prompt
  const handleLoadDefaultAnalysisPrompt = async () => {
    try {
      const response = await systemConfigAPI.getPublicPrompts();
      if (response.success && response.data && response.data.video_analysis_prompt?.value) {
        const defaultPrompt = response.data.video_analysis_prompt.value;
        form.setFieldsValue({ analysis_prompt: defaultPrompt });
        setUsingSystemDefaults(prev => ({ ...prev, analysis: true }));
        
        // 自动保存到项目配置
        await handleSaveAnalysisPrompt(defaultPrompt, false);
        message.success('已加载并保存系统默认的视频解析Prompt');
      } else {
        message.warning('系统未配置默认的视频解析Prompt');
      }
    } catch (error) {
      console.error('加载默认视频解析Prompt失败:', error);
      message.error('加载默认视频解析Prompt失败');
      throw error;
    }
  };

  // 加载系统默认的剧本整合Prompt
  const handleLoadDefaultIntegrationPrompt = async () => {
    try {
      const response = await systemConfigAPI.getPublicPrompts();
      if (response.success && response.data && response.data.script_integration_prompt?.value) {
        const defaultPrompt = response.data.script_integration_prompt.value;
        form.setFieldsValue({ integrationPrompt: defaultPrompt });
        setUsingSystemDefaults(prev => ({ ...prev, integration: true }));
        
        // 自动保存到项目配置
        await handleSaveIntegrationPrompt(defaultPrompt, false);
        message.success('已加载并保存系统默认的剧本整合Prompt');
      } else {
        message.warning('系统未配置默认的剧本整合Prompt');
      }
    } catch (error) {
      console.error('加载默认剧本整合Prompt失败:', error);
      message.error('加载默认剧本整合Prompt失败');
      throw error;
    }
  };

  // 保存角色知识图谱Prompt
  const handleSaveCharacterKnowledgeGraphPrompt = async (prompt, showSuccessMessage = true) => {
    try {
      await savePromptToDatabase('character_knowledge_graph', prompt);
      setUsingSystemDefaults(prev => ({ ...prev, characterKnowledgeGraph: false }));
      if (showSuccessMessage) {
        message.success('角色知识图谱Prompt保存成功');
      }
    } catch (error) {
      console.error('保存角色知识图谱Prompt失败:', error);
      throw error;
    }
  };

  // 加载系统默认的角色知识图谱Prompt
  const handleLoadDefaultCharacterKnowledgeGraphPrompt = async () => {
    try {
      const response = await systemConfigAPI.getPublicPrompts();
      if (response.success && response.data && response.data.character_knowledge_graph_prompt?.value) {
        const defaultPrompt = response.data.character_knowledge_graph_prompt.value;
        form.setFieldsValue({ characterKnowledgeGraphPrompt: defaultPrompt });
        setUsingSystemDefaults(prev => ({ ...prev, characterKnowledgeGraph: true }));
        
        // 自动保存到项目配置
        await handleSaveCharacterKnowledgeGraphPrompt(defaultPrompt, false);
        message.success('已加载并保存系统默认的角色知识图谱Prompt');
      } else {
        message.warning('系统未配置默认的角色知识图谱Prompt');
      }
    } catch (error) {
      console.error('加载默认角色知识图谱Prompt失败:', error);
      message.error('加载默认角色知识图谱Prompt失败');
      throw error;
    }
  };

  // 处理角色知识图谱
  const handleCharacterKnowledgeGraph = async (file) => {
    setCurrentCharacterFile(file);
    
    try {
      // 设置角色知识图谱加载状态
      setCharacterGraphProcessingIds(prev => new Set([...prev, file.id]));
      
      // 从 ai_tasks 表获取角色知识图谱结果
      const response = await aiAPI.getFileResult(file.id, 'character_graph');
      if (response.success && response.result) {
        setCharacterContent(response.result);
      } else {
        setCharacterContent('');
      }
    } catch (error) {
      console.warn('加载角色知识图谱失败:', error);
      setCharacterContent('');
    } finally {
      // 移除角色知识图谱加载状态
      setCharacterGraphProcessingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.id);
        return newSet;
      });
    }
    
    setIsCharacterModalVisible(true);
  };

  // 处理单个文件的角色图谱生成
  const handleSingleCharacterGraph = async (file) => {
    // 检查是否有角色知识图谱Prompt
    const characterPrompt = form.getFieldValue('characterKnowledgeGraphPrompt');
    if (!characterPrompt || !characterPrompt.trim()) {
      message.warning('请先配置角色知识图谱Prompt');
      return;
    }

    try {
      // 设置角色知识图谱处理状态
      setCharacterGraphProcessingIds(prev => new Set([...prev, file.id]));
      
      const response = await aiAPI.generateCharacterGraph({
        projectId: id,
        fileId: file.id,
        prompt: characterPrompt,
        modelConfig: {
          temperature: form.getFieldValue('temperature') || 1,
          model: form.getFieldValue('model') || modelConfig.defaultModel
        }
      });

      if (response.success) {
        // 角色知识图谱现在存储在 ai_tasks 表中，不需要更新 files 状态
        message.success(`${file.original_name} 的角色知识图谱生成完成`);
        // 更新角色知识图谱状态映射
        setCharacterGraphStatusMap(prev => new Map(prev.set(file.id, 'success')));
        // 重新加载角色图谱状态以确保同步
        loadCharacterGraphStatus();
      } else {
        message.error(`${file.original_name} 的角色知识图谱生成失败`);
        // 设置失败状态
        setCharacterGraphStatusMap(prev => new Map(prev.set(file.id, 'failed')));
      }
    } catch (error) {
      console.error('角色图谱生成失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
          errorMessage.includes('代理') || errorMessage.includes('连接')) {
        message.warning(`${file.original_name} 角色图谱生成失败，请联系管理员检查系统配置`, 6);
      } else {
        message.error(`${file.original_name} 角色图谱生成失败: ${errorMessage}`);
      }
      // 设置失败状态
      setCharacterGraphStatusMap(prev => new Map(prev.set(file.id, 'failed')));
    } finally {
      // 移除角色知识图谱处理状态
      setCharacterGraphProcessingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.id);
        return newSet;
      });
    }
  };

  const handleSaveCharacterGraph = async () => {
    if (!currentCharacterFile) return;
    
    try {
      // 调用API更新角色知识图谱结果
      const response = await aiAPI.updateFileResult(currentCharacterFile.id, 'character_graph', characterContent);
      
      if (response.success) {
        message.success(`${currentCharacterFile.original_name} 的角色知识图谱已保存`);
        // 重新加载角色图谱状态以确保同步
        loadCharacterGraphStatus();
        setIsCharacterModalVisible(false);
        setCurrentCharacterFile(null);
        setCharacterContent('');
      } else {
        message.error('保存失败：' + (response.message || '未知错误'));
      }
    } catch (error) {
      console.error('保存角色知识图谱失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      message.error('保存失败：' + errorMessage);
    }
  };

  const handleCancelCharacterGraph = () => {
    setIsCharacterModalVisible(false);
    setCurrentCharacterFile(null);
    setCharacterContent('');
  };

  // 处理角色图谱生成
  const handleGenerateCharacterGraph = async () => {
    const selectedFiles = processedFiles.filter(f => selectedFileIds.has(f.id) && f.task_status === 'completed');
    
    if (selectedFiles.length === 0) {
      const totalSelected = processedFiles.filter(f => selectedFileIds.has(f.id)).length;
      if (totalSelected > 0) {
        message.warning('选中的文件中没有完成剧本解析的视频，请先完成剧本内容解析');
      } else {
        message.warning('请先选择要生成角色图谱的视频文件');
      }
      return;
    }

    // 限制批量生成最多20个文件
    const maxFiles = 20;
    let filesToProcess = selectedFiles;
    
    if (selectedFiles.length > maxFiles) {
      message.warning(`批量图谱生成一次最多处理${maxFiles}个文件，已自动选择前${maxFiles}个文件进行生成`);
      filesToProcess = selectedFiles.slice(0, maxFiles);
    }

    // 检查是否有角色知识图谱Prompt
    const characterPrompt = form.getFieldValue('characterKnowledgeGraphPrompt');
    if (!characterPrompt || !characterPrompt.trim()) {
      message.warning('请先配置角色知识图谱Prompt');
      return;
    }

    // 开始生成时的提示
    message.loading(`开始为${filesToProcess.length}个视频生成角色图谱...`, 2);

    try {
      // 为每个选中的文件启动角色图谱生成任务
      const promises = filesToProcess.map(async (file) => {
        // 设置角色知识图谱处理状态
        setCharacterGraphProcessingIds(prev => new Set([...prev, file.id]));
        
        try {
          const response = await aiAPI.generateCharacterGraph({
            projectId: id,
            fileId: file.id,
            prompt: characterPrompt,
            modelConfig: {
              temperature: form.getFieldValue('temperature') || 1,
              model: form.getFieldValue('model') || modelConfig.defaultModel
            }
          });

          if (response.success) {
            // 角色知识图谱现在存储在 ai_tasks 表中，不需要更新 files 状态
            message.success(`${file.original_name} 的角色知识图谱生成完成`);
            // 更新角色知识图谱状态映射
            setCharacterGraphStatusMap(prev => new Map(prev.set(file.id, 'success')));
          } else {
            message.error(`${file.original_name} 的角色知识图谱生成失败`);
            // 设置失败状态
            setCharacterGraphStatusMap(prev => new Map(prev.set(file.id, 'failed')));
          }
        } catch (error) {
          console.error('角色图谱生成失败:', error);
          const errorMessage = error.response?.data?.message || error.message || '未知错误';
          if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
              errorMessage.includes('代理') || errorMessage.includes('连接')) {
            message.warning(`${file.original_name} 角色图谱生成失败，请联系管理员检查系统配置`, 6);
          } else {
            message.error(`${file.original_name} 角色图谱生成失败: ${errorMessage}`);
          }
          // 设置失败状态
          setCharacterGraphStatusMap(prev => new Map(prev.set(file.id, 'failed')));
        } finally {
          // 移除角色知识图谱处理状态
          setCharacterGraphProcessingIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(file.id);
            return newSet;
          });
        }
      });

      // 等待所有任务完成
      await Promise.all(promises);
      
      // 重新加载角色图谱状态以确保同步
      loadCharacterGraphStatus();
      
      // 清除选择
      setSelectedFileIds(new Set());
      
    } catch (error) {
      console.error('批量角色图谱生成失败:', error);
      message.error('批量角色图谱生成失败');
    }
  };

  // 角色知识图谱整合相关函数
  const handleSaveCharacterIntegrationPrompt = async (prompt, showSuccessMessage = true) => {
    try {
      await savePromptToDatabase('character_integration', prompt);
      setUsingSystemDefaults(prev => ({ ...prev, characterIntegration: false }));
      if (showSuccessMessage) {
        message.success('角色知识图谱整合Prompt保存成功');
      }
    } catch (error) {
      console.error('保存角色知识图谱整合Prompt失败:', error);
      throw error;
    }
  };

  const handleLoadDefaultCharacterIntegrationPrompt = async () => {
    try {
      const response = await systemConfigAPI.getPublicPrompts();
      if (response.success && response.data && response.data.character_integration_prompt?.value) {
        const defaultPrompt = response.data.character_integration_prompt.value;
        form.setFieldsValue({ characterIntegrationPrompt: defaultPrompt });
        setUsingSystemDefaults(prev => ({ ...prev, characterIntegration: true }));
        
        // 自动保存到项目配置
        await handleSaveCharacterIntegrationPrompt(defaultPrompt, false);
        message.success('已加载并保存系统默认的图谱整合Prompt');
      } else {
        message.warning('系统未配置默认的角色知识图谱整合Prompt');
      }
    } catch (error) {
      console.error('加载默认角色知识图谱整合Prompt失败:', error);
      message.error('加载默认角色知识图谱整合Prompt失败');
      throw error;
    }
  };

  // 角色整合相关函数
  const handleSaveCharacterPrompt = async (prompt, showSuccessMessage = true) => {
    try {
      await savePromptToDatabase('character', prompt);
      setUsingSystemDefaults(prev => ({ ...prev, character: false }));
      if (showSuccessMessage) {
        message.success('角色整合Prompt保存成功');
      }
    } catch (error) {
      console.error('保存角色整合Prompt失败:', error);
      throw error;
    }
  };

  const handleLoadDefaultCharacterPrompt = async () => {
    try {
      const response = await systemConfigAPI.getPublicPrompts();
      if (response.success && response.data && response.data.character_prompt?.value) {
        const defaultPrompt = response.data.character_prompt.value;
        form.setFieldsValue({ characterPrompt: defaultPrompt });
        setUsingSystemDefaults(prev => ({ ...prev, character: true }));
        
        // 自动保存到项目配置
        await handleSaveCharacterPrompt(defaultPrompt, false);
        message.success('已加载并保存系统默认的角色整合Prompt');
      } else {
        message.warning('系统未配置默认的角色整合Prompt');
      }
    } catch (error) {
      console.error('加载默认角色整合Prompt失败:', error);
      message.error('加载默认角色整合Prompt失败');
      throw error;
    }
  };

  // 选择分集角色图谱
  const handleConfirmCharacterSelectionAndAddToDraft = () => {
    const selectedFiles = processedFiles.filter(f => characterModalSelectedFileIds.has(f.id));
    const promises = selectedFiles.map(async (file) => {
      try {
        const response = await aiAPI.getFileResult(file.id, 'character_graph');
        if (response.success && response.result) {
          const episodeNum = extractEpisodeNumber(file.original_name);
          const episodeTitle = episodeNum ? `第${episodeNum}集` : file.original_name;
          return `${episodeTitle}\n\n${response.result}`;
        }
        return null;
      } catch (error) {
        console.warn(`获取文件${file.id}的角色图谱失败:`, error);
        return null;
      }
    });

    Promise.all(promises).then(results => {
      const validResults = results.filter(Boolean);
      const contentToDraft = validResults.join('\n\n---\n\n');
      setCharacterDraftContent(contentToDraft);
      setIsCharacterSelectionModalVisible(false);
      setCharacterModalSelectedFileIds(new Set());
      message.success(`${validResults.length}个分集角色图谱已更新到素材区`);
    });
  };

  // 角色图谱整合 - 非流式响应版本
  const handleCharacterIntegrate = async (values) => {
    console.log('🎯 [前端组件] 开始角色图谱整合');
    console.log('📊 [前端组件] 输入参数:', {
      characterDraftContentLength: characterDraftContent ? characterDraftContent.length : 0,
      globalCharacterContentLength: globalCharacterContent ? globalCharacterContent.length : 0,
      prompt: values.characterIntegrationPrompt ? values.characterIntegrationPrompt.substring(0, 100) + '...' : 'null',
      modelConfig: {
        model: values.character_integration_model || modelConfig.defaultModel,
        temperature: values.character_integration_temperature || 1
      }
    });

    if (!characterDraftContent.trim() && !globalCharacterContent.trim()) {
      message.warning('角色图谱素材不能为空');
      return;
    }
    
    // 组合素材内容 - 正确拆分分集图谱
    const characterGraphs = [];
    
    if (characterDraftContent.trim()) {
      // 将分集内容按分隔符拆分成独立的图谱
      const sections = characterDraftContent.split('\n\n---\n\n').filter(section => section.trim());
      characterGraphs.push(...sections); // 使用spread操作符将多个分集分别添加
    }
    
    if (globalCharacterContent.trim()) {
      characterGraphs.push(globalCharacterContent);
    }

    console.log('📋 [前端组件] 组合后的角色图谱数据:', {
      count: characterGraphs.length,
      totalLength: characterGraphs.reduce((sum, graph) => sum + graph.length, 0)
    });

    setCharacterIntegrating(true);

    // 启动计时器
    const startTime = Date.now();
    setCharacterIntegrationStartTime(startTime);
    setCharacterIntegrationTimer(0);

    const timerInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setCharacterIntegrationTimer(elapsed);
    }, 100);

    try {
      console.log('🚀 [前端组件] 调用 aiAPI.integrateCharacterGraph');
      
      // 使用非流式API
      const response = await aiAPI.integrateCharacterGraph({
        projectId: id,
        prompt: values.characterIntegrationPrompt,
        characterGraphs: characterGraphs,
        modelConfig: {
          model: values.character_integration_model || modelConfig.defaultModel,
          temperature: values.character_integration_temperature || 1
        }
      });

      if (response.success) {
        clearInterval(timerInterval);
        setCharacterIntegrationFinalTime(characterIntegrationTimer);
        
        // 设置结果
        const finalText = response.result;
        setCharacterIntegrationResult(finalText);
        setGlobalCharacterContent(finalText);
        
        console.log('💾 [前端组件] 开始保存结果到数据库');
        
        // 保存到global_character_content以便于工作台使用
        try {
          await aiAPI.saveGlobalCharacterContent(id, finalText);
          console.log('✅ [前端组件] 全局角色图谱保存成功');
        } catch (saveError) {
          console.warn('❌ [前端组件] 保存全局角色图谱到数据库失败:', saveError);
        }
        
        // 清除重置标志
        setIsCharacterWorkflowReset(false);
        
        message.success(`角色图谱整合完成！处理了${characterGraphs.length}个分集图谱`);
        console.log('🎉 [前端组件] 角色图谱整合完成');
      } else {
        // 整合失败，设置失败状态
        setCharacterIntegrationFailed(true);
        throw new Error(response.message || '角色图谱整合失败');
      }

    } catch (error) {
      console.error('❌ [前端组件] 调用API失败:', error);
      
      clearInterval(timerInterval);
      
      console.error('角色图谱整合失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      
      setCharacterIntegrationStartTime(null);
      setCharacterIntegrationTimer(0);
      
      // 简化错误处理
      if (errorMessage.includes('524') || errorMessage.includes('timeout') || errorMessage.includes('超时')) {
        message.error('角色图谱整合超时，请稍后重试', 5);
      } else if (errorMessage.includes('E2BIG') || errorMessage.includes('参数太长') || errorMessage.includes('数据过大')) {
        message.error('数据量过大，请减少分集数量', 5);
      } else {
        message.error('角色图谱整合失败: ' + errorMessage, 5);
      }
    } finally {
      console.log('🔚 [前端组件] handleCharacterIntegrate 函数完成');
      setCharacterIntegrating(false);
    }
  };

  const handleSelectAllCharacterInModal = () => {
    // 获取有角色图谱的文件
    const filesWithCharacterGraph = processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success');
    const allCharacterFileIds = filesWithCharacterGraph.map(f => f.id);
    
    // 检查是否所有有角色图谱的文件都已选中
    const allCurrentlySelected = allCharacterFileIds.length > 0 && allCharacterFileIds.every(id => characterModalSelectedFileIds.has(id));

    if (allCurrentlySelected) {
      setCharacterModalSelectedFileIds(new Set()); // 取消全选
    } else {
      setCharacterModalSelectedFileIds(new Set(allCharacterFileIds)); // 全选
    }
  };

  // 保存全局角色图谱
  const handleSaveGlobalCharacterContent = async () => {
    try {
      // 保存到数据库
      await aiAPI.saveGlobalCharacterContent(id, globalCharacterContent);
      // globalCharacterContent已通过useEffect自动保存到localStorage
      setIsGlobalCharacterModalVisible(false);
      message.success('全局角色图谱保存成功');
    } catch (error) {
      console.error('保存全局角色图谱失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      message.error('保存失败：' + errorMessage);
    }
  };

  // 处理预览内容的保存
  const handleSavePreviewCharacterContent = async () => {
    try {
      setCharacterDraftContent(previewCharacterContent);
      sessionStorage.setItem(draftStorageKey('characterDraftContent'), previewCharacterContent);
      setIsCharacterDraftPreviewVisible(false);
      message.success('预览内容保存成功');
    } catch (error) {
      console.error('保存预览内容失败:', error);
      message.error('保存失败');
    }
  };

  // 处理角色结果的保存
  const handleSaveCharacterResult = async () => {
    try {
      // 保存到全局角色图谱
      await aiAPI.saveGlobalCharacterContent(id, characterResultEditContent);
      
      // 更新全局角色图谱状态
      setGlobalCharacterContent(characterResultEditContent);
      sessionStorage.setItem(draftStorageKey('globalCharacterContent'), characterResultEditContent);
      
      // 更新角色整合结果
      setCharacterIntegrationResult(characterResultEditContent);
      
      // 更新预览内容
      setPreviewCharacterContent(characterResultEditContent);
      
      // 退出编辑状态
      setIsCharacterResultEditing(false);
      
      message.success('角色结果保存成功');
    } catch (error) {
      console.error('保存角色结果失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      message.error('保存失败：' + errorMessage);
    }
  };

  // 处理手动输入的保存
  const handleSaveManualInput = async () => {
    if (!manualInputContent.trim()) {
      message.warning('请输入角色图谱内容');
      return;
    }
    
    console.log('🚀 [手动保存] 开始保存手动录入内容');
    console.log('📊 [手动保存] 项目ID:', id);
    console.log('📝 [手动保存] 内容长度:', manualInputContent.length);
    console.log('📝 [手动保存] 内容预览:', manualInputContent.substring(0, 200));
    
    try {
      // 保存到全局角色图谱
      console.log('🔄 [手动保存] 调用API保存...');
      const response = await aiAPI.saveGlobalCharacterContent(id, manualInputContent);
      console.log('✅ [手动保存] API响应:', response);
      
      // 更新全局角色图谱状态
      setGlobalCharacterContent(manualInputContent);
      sessionStorage.setItem(draftStorageKey('globalCharacterContent'), manualInputContent);
      
      // 关闭模态框并清空内容
      setIsManualInputModalVisible(false);
      setManualInputContent('');
      
      // 清除失败状态（但保持整合卡片状态不变）
      setCharacterIntegrationFailed(false);
      
      console.log('🎉 [手动保存] 保存完成');
      message.success('角色图谱内容保存成功');
    } catch (error) {
      console.error('💥 [手动保存] 保存失败:', error);
      console.error('📋 [手动保存] 错误详情:', error.response?.data);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      message.error('保存失败：' + errorMessage);
    }
  };

  // 测试解析函数的辅助方法
  const testParseFunction = (testContent) => {
    console.log('🧪 [测试] 测试解析函数，输入内容:', testContent);
    const result = parseEpisodesFromCharacterContent(testContent);
    console.log('🧪 [测试] 解析结果:', result);
    return result;
  };

  // 处理手动输入模态框的打开
  const handleOpenManualInput = () => {
    setManualInputContent('');
    setIsManualInputModalVisible(true);
  };

  // ===================== 单元标签页滑动相关函数 =====================
  
  // 获取滚动容器元素
  const getScrollContainer = () => {
    if (!tabsRef.current) return null;
    
    // 按优先级尝试不同的选择器
    const selectors = [
      '.ant-tabs-nav-list',
      '.ant-tabs-nav-wrap', 
      '.ant-tabs-nav',
      '.ant-tabs'
    ];
    
    for (const selector of selectors) {
      const element = tabsRef.current.querySelector(selector);
      if (element && element.scrollLeft !== undefined) {
        return element;
      }
    }
    
    // 如果找不到，尝试直接查看所有具有scrollLeft属性的子元素
    const allElements = tabsRef.current.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (el.scrollLeft !== undefined && el.scrollWidth > el.clientWidth) {
        return el;
      }
    }
    
    return null;
  };

  // 检测滚动状态
  const checkTabsScrollStatus = () => {
    const container = getScrollContainer();
    if (!container) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const maxScrollLeft = scrollWidth - clientWidth;
    
    // 考虑到浮点数精度问题，添加小的容错值
    const tolerance = 1;
    
    // 如果内容不需要滚动，禁用按钮
    if (maxScrollLeft <= 0) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    
    const canLeft = scrollLeft > tolerance;
    const canRight = scrollLeft < maxScrollLeft - tolerance;
    
    setCanScrollLeft(canLeft);
    setCanScrollRight(canRight);
  };

  // 向左滑动
  const scrollTabsLeft = () => {
    const container = getScrollContainer();
    if (!container) return;
    
    const currentScrollLeft = container.scrollLeft;
    if (currentScrollLeft > 0) {
      container.scrollTo({
        left: Math.max(0, currentScrollLeft - 120),
        behavior: 'smooth'
      });
      // 多次检测确保状态正确更新
      setTimeout(checkTabsScrollStatus, 100);
      setTimeout(checkTabsScrollStatus, 300);
      setTimeout(checkTabsScrollStatus, 500);
    }
  };

  // 向右滑动
  const scrollTabsRight = () => {
    const container = getScrollContainer();
    if (!container) return;
    
    const { scrollLeft, scrollWidth, clientWidth } = container;
    const maxScrollLeft = scrollWidth - clientWidth;
    
    if (scrollLeft < maxScrollLeft) {
      container.scrollTo({
        left: Math.min(maxScrollLeft, scrollLeft + 120),
        behavior: 'smooth'
      });
      // 多次检测确保状态正确更新
      setTimeout(checkTabsScrollStatus, 100);
      setTimeout(checkTabsScrollStatus, 300);
      setTimeout(checkTabsScrollStatus, 500);
    }
  };

  // 添加滚动事件监听
  const addScrollListener = () => {
    const container = getScrollContainer();
    if (container) {
      container.addEventListener('scroll', checkTabsScrollStatus);
      return () => container.removeEventListener('scroll', checkTabsScrollStatus);
    }
    return null;
  };

  // 滚动到指定单元（让新创建的单元可见）
  const scrollToUnit = (unitId) => {
    if (!tabsRef.current || !unitId) return;
    
    setTimeout(() => {
      try {
        // 查找目标单元的标签页元素
        const tabElement = tabsRef.current.querySelector(`[data-node-key="${unitId}"]`);
        if (tabElement) {
          const container = getScrollContainer();
          if (container) {
            // 获取标签页相对于容器的位置
            const tabRect = tabElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // 计算需要滚动的距离
            const scrollLeft = container.scrollLeft;
            const tabLeftRelative = tabRect.left - containerRect.left + scrollLeft;
            const tabRightRelative = tabLeftRelative + tabRect.width;
            
            // 如果标签页不在可视区域，则滚动让它可见
            if (tabLeftRelative < scrollLeft) {
              // 标签页在左侧不可见区域，向左滚动
              container.scrollTo({
                left: Math.max(0, tabLeftRelative - 20),
                behavior: 'smooth'
              });
            } else if (tabRightRelative > scrollLeft + container.clientWidth) {
              // 标签页在右侧不可见区域，向右滚动
              container.scrollTo({
                left: tabRightRelative - container.clientWidth + 20,
                behavior: 'smooth'
              });
            }
            
            // 滚动后更新按钮状态
            setTimeout(checkTabsScrollStatus, 500);
          }
        }
      } catch (error) {
        console.warn('自动滚动到单元失败:', error);
      }
    }, 200);
  };

  // ===================== 单元剧本相关处理函数 =====================
  
  // 加载单元剧本列表
  const loadScriptUnits = async () => {
    if (!id) return;
    try {
      const response = await scriptUnitsAPI.getUnits(id);
      if (response.success) {
        setScriptUnits(response.units || []);
        // 如果有单元但没有激活的单元，激活第一个
        if (response.units.length > 0 && !activeUnitId) {
          setActiveUnitId(response.units[0].id);
        }
        // 延迟检测滚动状态，等待DOM更新，并添加滚动监听
        const checkTimers = [
          setTimeout(() => {
            checkTabsScrollStatus();
            addScrollListener();
          }, 200),
          
          setTimeout(() => {
            checkTabsScrollStatus();
          }, 500),
          
          setTimeout(() => {
            checkTabsScrollStatus();
          }, 1000)
        ];
      }
    } catch (error) {
      console.warn('加载单元剧本列表失败:', error);
    }
  };

  // 创建新单元
  const createUnit = async () => {
    if (!canEdit) return;
    
    try {
      // 生成单元名称
      const unitNumber = scriptUnits.length + 1;
      const unitName = getUnitName(unitNumber, []);
      
      const response = await scriptUnitsAPI.createUnit(id, {
        unitName,
        selectedEpisodes: [],
        selectedFileIds: [],
        draftContent: '',
        integrationPrompt: form.getFieldValue('integrationPrompt') || ''
      });
      
      if (response.success) {
        await loadScriptUnits();
        setActiveUnitId(response.unit.id);
        // 自动滚动到新创建的单元
        scrollToUnit(response.unit.id);
        message.success('新单元创建成功');
      }
    } catch (error) {
      console.error('创建单元失败:', error);
      message.error('创建单元失败');
    }
  };

  // 删除单元
  const deleteUnit = async (unitId) => {
    if (!canEdit) return;
    
    try {
      const response = await scriptUnitsAPI.deleteUnit(unitId);
      if (response.success) {
        await loadScriptUnits();
        // 如果删除的是当前激活的单元，切换到第一个单元
        if (activeUnitId === unitId) {
          const remainingUnits = scriptUnits.filter(u => u.id !== unitId);
          setActiveUnitId(remainingUnits.length > 0 ? remainingUnits[0].id : null);
        }
        message.success('单元删除成功');
      }
    } catch (error) {
      console.error('删除单元失败:', error);
      message.error('删除单元失败');
    }
  };



  // 更新单元内容
  const updateUnitContent = async (unitId, updates) => {
    if (!canEdit) return;
    
    try {
      await scriptUnitsAPI.updateUnit(unitId, updates);
    } catch (error) {
      console.error('更新单元内容失败:', error);
    }
  };

  // 格式化计时器时间显示
  const formatTimer = (seconds) => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
    }
  };

  // 数字转中文函数
  const numberToChinese = (num) => {
    if (num <= 0) return '';
    
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = ['', '十', '百', '千'];
    
    if (num < 10) {
      return digits[num];
    } else if (num < 20) {
      return '十' + (num === 10 ? '' : digits[num - 10]);
    } else if (num < 100) {
      const tens = Math.floor(num / 10);
      const ones = num % 10;
      return digits[tens] + '十' + (ones === 0 ? '' : digits[ones]);
    } else if (num < 1000) {
      const hundreds = Math.floor(num / 100);
      const remainder = num % 100;
      let result = digits[hundreds] + '百';
      
      if (remainder === 0) {
        return result;
      } else if (remainder < 10) {
        return result + '零' + digits[remainder];
      } else {
        return result + numberToChinese(remainder);
      }
    } else {
      // 处理千位及以上（一般不会用到，但保持完整性）
      const thousands = Math.floor(num / 1000);
      const remainder = num % 1000;
      let result = digits[thousands] + '千';
      
      if (remainder === 0) {
        return result;
      } else if (remainder < 100) {
        return result + '零' + numberToChinese(remainder);
      } else {
        return result + numberToChinese(remainder);
      }
    }
  };

  // 获取单元名称（根据选择的集数）
  const getUnitName = (unitNumber, selectedEpisodes) => {
    const unitName = numberToChinese(unitNumber);
    
    if (selectedEpisodes.length === 0) {
      return `${unitName}单元`;
    } else if (selectedEpisodes.length === 1) {
      return `${unitName}单元（${selectedEpisodes[0]}集）`;
    } else {
      const minEpisode = Math.min(...selectedEpisodes);
      const maxEpisode = Math.max(...selectedEpisodes);
      return `${unitName}单元（${minEpisode}-${maxEpisode}集）`;
    }
  };

  // 根据单元对象获取显示名称（用于卡片显示）
  const getUnitDisplayName = (unit) => {
    if (!unit) return '';
    
    // 直接使用数据库中存储的单元名称
    if (unit.unit_name && unit.unit_name !== '未命名单元') {
      return unit.unit_name;
    }
    
    // 如果数据库中没有有效的单元名称，则根据选择的集数生成名称
    let selectedEpisodes = [];
    if (unit.selected_materials && unit.selected_materials.selectedEpisodes) {
      selectedEpisodes = unit.selected_materials.selectedEpisodes;
    } else if (unit.selected_episodes && unit.selected_episodes.length > 0) {
      selectedEpisodes = unit.selected_episodes;
    }
    
    if (selectedEpisodes.length > 0) {
      const unitIndex = scriptUnits.findIndex(u => u.id === unit.id);
      const unitNumber = unitIndex + 1;
      return getUnitName(unitNumber, selectedEpisodes);
    }
    
    // 最后使用存储的名称或默认名称
    return unit.unit_name || '未命名单元';
  };

  // 处理单元选择分集剧本
  const handleUnitSelectScripts = () => {
    if (!canEdit || !activeUnitId) return;
    setUnitModalSelectedFileIds(new Set());
    setIsUnitSelectionModalVisible(true);
  };

  // 处理单元选择素材（整合版）
  const handleUnitSelectMaterial = () => {
    if (!canEdit || !activeUnitId) return;
    // 重置选择状态
    setUnitMaterialSelectedFileIds(new Set());
    // 默认选择全局角色图谱（如果存在的话）
    setUnitMaterialIncludeCharacterGraph(!!globalCharacterContent);
    setIsUnitMaterialModalVisible(true);
  };

  // 确认选择素材并添加到单元（整合版）
  const handleConfirmUnitMaterialSelection = async () => {
    const selectedFiles = processedFiles.filter(f => unitMaterialSelectedFileIds.has(f.id));
    const includeCharacter = unitMaterialIncludeCharacterGraph && globalCharacterContent && globalCharacterContent.trim();
    
    if (selectedFiles.length === 0 && !includeCharacter) {
      message.warning('请至少选择一种素材');
      return;
    }
    
    if (selectedFiles.length > 10) {
      message.warning('最多只能选择10集分集剧本');
      return;
    }

    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!activeUnit) return;

    // 构建内容
    let contentParts = [];
    
    // 1. 分集剧本部分
    if (selectedFiles.length > 0) {
      const episodeContent = selectedFiles
        .map(f => {
          const episodeNum = extractEpisodeNumber(f.original_name);
          const episodeTitle = episodeNum ? `第${episodeNum}集` : f.original_name;
          return `${episodeTitle}\n\n${f.task_result || '无内容'}`;
        })
        .join('\n\n---\n\n');
      
      contentParts.push('【分集剧本】\n\n' + episodeContent);
    }
    
    // 2. 角色图谱部分
    if (includeCharacter) {
      contentParts.push('【角色图谱】\n\n' + globalCharacterContent);
    }
    
    const contentToDraft = contentParts.join('\n\n---\n\n');

    // 提取集数（用于更新单元名称）
    const selectedEpisodes = selectedFiles.map(f => extractEpisodeNumber(f.original_name)).filter(Boolean);
    
    // 更新单元名称
    const unitNumber = scriptUnits.findIndex(u => u.id === activeUnitId) + 1;
    const newUnitName = getUnitName(unitNumber, selectedEpisodes);

    try {
      await updateUnitContent(activeUnitId, {
        unitName: newUnitName,
        selectedEpisodes,
        selectedFileIds: [...unitMaterialSelectedFileIds],
        draftContent: contentToDraft
      });
      
      await loadScriptUnits();
      setIsUnitMaterialModalVisible(false);
      setUnitMaterialSelectedFileIds(new Set());
      setUnitMaterialIncludeCharacterGraph(false);
      
      const materialCount = selectedFiles.length + (includeCharacter ? 1 : 0);
      message.success(`${materialCount}项素材已添加到单元`);
    } catch (error) {
      message.error('添加素材失败');
    }
  };

  // 处理单元选择角色图谱（保留原有函数以兼容）
  const handleUnitSelectCharacterGraph = () => {
    if (!canEdit || !activeUnitId) return;
    setIsUnitCharacterModalVisible(true);
  };

  // 确认选择角色图谱并添加到单元（保留原有函数以兼容）
  const handleConfirmUnitCharacterSelection = async () => {
    if (!globalCharacterContent || !globalCharacterContent.trim()) {
      message.warning('全局角色图谱内容为空');
      return;
    }

    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!activeUnit) return;

    // 将角色图谱内容添加到现有素材区内容后面
    const currentContent = activeUnit.draft_content || '';
    const separator = currentContent.trim() ? '\n\n---\n\n' : '';
    const newContent = currentContent + separator + '【角色图谱】\n\n' + globalCharacterContent;

    try {
      await updateUnitContent(activeUnitId, {
        draftContent: newContent
      });
      
      await loadScriptUnits();
      setIsUnitCharacterModalVisible(false);
      message.success('角色图谱已添加到素材区');
    } catch (error) {
      message.error('添加角色图谱失败');
    }
  };

  // 确认选择分集剧本并添加到单元
  const handleConfirmUnitSelection = async () => {
    const selectedFiles = processedFiles.filter(f => unitModalSelectedFileIds.has(f.id));
    
    if (selectedFiles.length > 10) {
      message.warning('最多只能选择10集分集剧本');
      return;
    }
    
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!activeUnit) return;
    
    // 提取集数
    const selectedEpisodes = selectedFiles.map(f => extractEpisodeNumber(f.original_name)).filter(Boolean);
    
    // 生成素材区内容
    const episodeContent = selectedFiles
      .map(f => {
        const episodeNum = extractEpisodeNumber(f.original_name);
        const episodeTitle = episodeNum ? `第${episodeNum}集` : f.original_name;
        return `${episodeTitle}\n\n${f.task_result || '无内容'}`;
      })
      .join('\n\n---\n\n');
    
    // 在内容最前面添加【分集剧本】标题
    const contentToDraft = '【分集剧本】\n\n' + episodeContent;
    
    // 更新单元名称
    const unitNumber = scriptUnits.findIndex(u => u.id === activeUnitId) + 1;
    const newUnitName = getUnitName(unitNumber, selectedEpisodes);
    
    try {
      await updateUnitContent(activeUnitId, {
        unitName: newUnitName,
        selectedEpisodes,
        selectedFileIds: [...unitModalSelectedFileIds],
        draftContent: contentToDraft
      });
      
      await loadScriptUnits();
      setIsUnitSelectionModalVisible(false);
      setUnitModalSelectedFileIds(new Set());
      message.success(`${selectedFiles.length}个文件内容已更新到单元`);
    } catch (error) {
      message.error('更新单元内容失败');
    }
  };

  // 单元剧本整合
  const handleUnitIntegrate = async () => {
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!activeUnit || !activeUnit.draft_content?.trim()) {
      message.warning('单元草稿区内容不能为空');
      return;
    }
    
    setUnitIntegrating(true);
    try {
      const response = await scriptUnitsAPI.integrateUnit(activeUnitId, {
        integrationPrompt: form.getFieldValue('integrationPrompt'),
        draftContent: activeUnit.draft_content,
        modelConfig: {
          model: form.getFieldValue('integration_model') || modelConfig.defaultModel,
          temperature: form.getFieldValue('integration_temperature') || 1
        }
      });
      
      if (response.success) {
        await loadScriptUnits();
        message.success('剧本整合成功');
      }
    } catch (error) {
      console.error(error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
          errorMessage.includes('代理') || errorMessage.includes('连接') ||
          errorMessage.includes('proxy') || errorMessage.includes('timeout')) {
        message.warning('模型调用失败，请联系管理员检查系统配置', 6);
      } else {
        message.error(`整合失败: ${errorMessage}`);
      }
    } finally {
      setUnitIntegrating(false);
    }
  };

  // 更新单元草稿内容
  const handleUpdateUnitDraft = async (content) => {
    if (!activeUnitId) return;
    
    try {
      await updateUnitContent(activeUnitId, { draftContent: content });
      await loadScriptUnits();
    } catch (error) {
      console.error('更新草稿内容失败:', error);
    }
  };

  // 更新单元整合结果
  const handleUpdateUnitResult = async (content) => {
    if (!activeUnitId) return;
    
    try {
      await updateUnitContent(activeUnitId, { integrationResult: content });
      await loadScriptUnits();
    } catch (error) {
      console.error('更新整合结果失败:', error);
    }
  };

  // 完整剧本相关函数
  const loadFullScript = async () => {
    try {
      const fullScripts = await fullScriptsAPI.getFullScript(id);
      
      if (fullScripts.length > 0) {
        const script = fullScripts[0]; // 每个项目只有一个完整剧本
        setFullScript(script);
        setFullScriptCurrentStep(script.current_step);
        setFullScriptSelectedUnitIds(script.selected_unit_ids || []);
        setFullScriptConcatenatedContent(script.concatenated_content || '');
        setFullScriptReviewedContent(script.reviewed_content !== null && script.reviewed_content !== undefined ? script.reviewed_content : null);
        setFullScriptReviewNotes(script.review_notes || '');
        
        // 设置存档标题：优先使用项目名称，如果没有项目名则使用已保存的标题
        const defaultTitle = project?.name ? `${project.name}-完整剧本` : (script.archive_title || '完整剧本');
        setFullScriptArchiveTitle(defaultTitle);
      } else {
        // 没有完整剧本时自动创建工作流
        await createFullScriptAutomatically();
      }
    } catch (error) {
      console.error('加载完整剧本失败:', error);
    }
  };

  // 自动创建完整剧本工作流（内部使用，不显示成功消息）
  const createFullScriptAutomatically = async () => {
    try {
      const newScript = await fullScriptsAPI.createFullScript(id, {
        scriptName: '完整剧本'
      });
      setFullScript(newScript);
      setFullScriptCurrentStep(1);
      
      // 设置默认存档标题
      const archiveTitle = project?.name ? `${project.name}-完整剧本` : '完整剧本';
      setFullScriptArchiveTitle(archiveTitle);
      // 不显示成功消息，让用户感觉是自然进入步骤1
    } catch (error) {
      console.error('自动创建完整剧本失败:', error);
      // 如果自动创建失败，仍然显示步骤1界面，但功能将受限
      setFullScript(null);
      setFullScriptCurrentStep(1);
      setFullScriptSelectedUnitIds([]);
      setFullScriptConcatenatedContent('');
      setFullScriptReviewedContent(null);
      setFullScriptReviewNotes('');
      setFullScriptArchiveTitle(project?.name ? `${project.name}-完整剧本` : '完整剧本');
    }
  };

  // 创建新的完整剧本工作流
  const createFullScript = async () => {
    try {
      const newScript = await fullScriptsAPI.createFullScript(id, {
        scriptName: '完整剧本'
      });
      setFullScript(newScript);
      setFullScriptCurrentStep(1);
      
      // 设置默认存档标题
      const archiveTitle = project?.name ? `${project.name}-完整剧本` : '完整剧本';
      setFullScriptArchiveTitle(archiveTitle);
      
      message.success('完整剧本工作流创建成功');
    } catch (error) {
      console.error('创建完整剧本失败:', error);
      message.error(error.response?.data?.error || '创建完整剧本失败');
    }
  };

  // 步骤1：单元剧本拼接
  const handleFullScriptStep1 = async () => {
    if (fullScriptSelectedUnitIds.length === 0) {
      message.warning('请先选择要拼接的单元剧本');
      return;
    }

    setFullScriptProcessing(prev => ({ ...prev, step1: true }));
    try {
      // 如果还没有完整剧本记录，先创建一个
      let currentScript = fullScript;
      if (!currentScript) {
        const newScript = await fullScriptsAPI.createFullScript(id, {
          scriptName: '完整剧本'
        });
        setFullScript(newScript);
        currentScript = newScript;
      }

      const updatedScript = await fullScriptsAPI.executeStep1(currentScript.id, {
        selectedUnitIds: fullScriptSelectedUnitIds
      });
      
      setFullScript(updatedScript);
      setFullScriptCurrentStep(updatedScript.current_step);
      setFullScriptConcatenatedContent(updatedScript.concatenated_content || '');
      
      // 重新拼接时清空之前的审核内容，让用户基于新的拼接内容重新审核
      setFullScriptReviewedContent(null);
      setFullScriptReviewNotes('');
      
      message.success('单元剧本拼接成功');
    } catch (error) {
      console.error('单元剧本拼接失败:', error);
      message.error(error.response?.data?.error || '单元剧本拼接失败');
    } finally {
      setFullScriptProcessing(prev => ({ ...prev, step1: false }));
    }
  };

  // 步骤2：全剧本审核
  const handleFullScriptStep2 = async () => {
    if (!fullScript) return;

    const contentToSubmit = fullScriptReviewedContent || fullScriptConcatenatedContent;
    if (!contentToSubmit.trim()) {
      message.warning('请先完成剧本内容的审核');
      return;
    }

    setFullScriptProcessing(prev => ({ ...prev, step2: true }));
    try {
      const updatedScript = await fullScriptsAPI.executeStep2(fullScript.id, {
        reviewedContent: contentToSubmit,
        reviewNotes: fullScriptReviewNotes
      });
      
      setFullScript(updatedScript);
      setFullScriptCurrentStep(updatedScript.current_step);
      
      message.success('全剧本审核完成');
    } catch (error) {
      console.error('全剧本审核失败:', error);
      message.error(error.response?.data?.error || '全剧本审核失败');
    } finally {
      setFullScriptProcessing(prev => ({ ...prev, step2: false }));
    }
  };

  // 步骤3：知识库存档
  const handleFullScriptStep3 = async () => {
    if (!fullScript) return;

    if (!fullScriptArchiveTitle.trim()) {
      message.warning('请输入存档文档名称');
      return;
    }

    setFullScriptProcessing(prev => ({ ...prev, step3: true }));
    try {
      const updatedScript = await fullScriptsAPI.executeStep3(fullScript.id, {
        archiveTitle: fullScriptArchiveTitle.trim()
      });
      
      setFullScript(updatedScript);
      setFullScriptCurrentStep(updatedScript.current_step);
      message.success('完整剧本已成功存档到知识库');
    } catch (error) {
      console.error('知识库存档失败:', error);
      message.error(error.response?.data?.error || '知识库存档失败');
    } finally {
      setFullScriptProcessing(prev => ({ ...prev, step3: false }));
    }
  };

  // 开启编辑模式
  const handleFullScriptStartEdit = () => {
    // 若当前审核内容为空，则以拼接内容作为初始可编辑内容，避免进入编辑后为空白
    setFullScriptReviewedContent(prev => (prev !== null && prev !== undefined) ? prev : (fullScriptConcatenatedContent || ''));
    setFullScriptEditMode(true);
  };

  // 保存编辑内容
  const handleFullScriptSaveEdit = async () => {
    try {
      // 持久化保存步骤2的审核内容草稿（允许为空）
      if (fullScript && fullScript.id) {
        await fullScriptsAPI.saveStep2Draft(fullScript.id, fullScriptReviewedContent ?? '');
      }
      setFullScriptEditMode(false);
      message.success('剧本内容已保存');
    } catch (error) {
      console.error('保存失败:', error);
      message.error('保存失败');
    }
  };

  // 取消编辑
  const handleFullScriptCancelEdit = () => {
    setFullScriptEditMode(false);
  };

  // 开启审核备注编辑模式
  const handleFullScriptNotesStartEdit = () => {
    setFullScriptNotesEditMode(true);
  };

  // 保存审核备注编辑内容
  const handleFullScriptNotesSaveEdit = async () => {
    try {
      setFullScriptNotesEditMode(false);
      message.success('审核备注已保存');
    } catch (error) {
      console.error('保存失败:', error);
      message.error('保存失败');
    }
  };

  // 取消审核备注编辑
  const handleFullScriptNotesCancelEdit = () => {
    setFullScriptNotesEditMode(false);
  };

  // 标记到第X集
  const handleMarkToEpisode = async (episodeNumber) => {
    try {
      // 获取要标记的文件（前episodeNumber个文件）
      const sortedFiles = [...processedFiles].sort((a, b) => {
        return a.original_name.localeCompare(b.original_name, 'zh-CN', { numeric: true });
      });
      
      const filesToMark = sortedFiles.slice(0, episodeNumber);
      
      // 批量标记文件
      const markPromises = filesToMark.map(file => 
        fileAPI.markDone(file.id, true)
      );
      
      await Promise.all(markPromises);
      
      // 直接更新本地状态，乐观更新
      filesToMark.forEach(file => {
        file.mark_done = true;
      });
      
      console.log(`✅ 已标记前${episodeNumber}集为完成状态`);
    } catch (error) {
      console.error('标记失败:', error);
      throw error;
    }
  };



  // 重置完整剧本的某个步骤
  const resetFullScriptStep = async (stepNumber) => {
    if (!fullScript) return;

    try {
      const updatedScript = await fullScriptsAPI.resetStep(fullScript.id, stepNumber);
      setFullScript(updatedScript);
      
      // 根据重置的步骤更新相应的状态
      if (stepNumber === 1) {
        setFullScriptConcatenatedContent('');
        setFullScriptReviewedContent(null);
        setFullScriptReviewNotes('');
        setFullScriptCurrentStep(1);
      } else if (stepNumber === 2) {
        setFullScriptReviewedContent('');
        setFullScriptReviewNotes('');
        setFullScriptCurrentStep(2);
      }
      
      message.success(`步骤${stepNumber}已重置`);
    } catch (error) {
      console.error('重置步骤失败:', error);
      message.error(error.response?.data?.error || '重置步骤失败');
    }
  };

  // 处理单元选择变化
  const handleFullScriptUnitSelection = (unitIds) => {
    setFullScriptSelectedUnitIds(unitIds);
  };

  // 全选/取消全选单元剧本
  const handleFullScriptSelectAll = () => {
    const availableUnits = scriptUnits.filter(unit => {
      // 只选择有内容且可选择的单元
      const hasCharacterIntegration = !!unit.character_integration_result;
      const hasOldIntegration = !!unit.integration_result;
      return hasCharacterIntegration || hasOldIntegration;
    });
    
    const availableUnitIds = availableUnits.map(unit => unit.id);
    const allSelected = availableUnitIds.length > 0 && availableUnitIds.every(id => fullScriptSelectedUnitIds.includes(id));
    
    if (allSelected) {
      // 当前全选，改为全不选
      setFullScriptSelectedUnitIds([]);
    } else {
      // 当前未全选，改为全选
      setFullScriptSelectedUnitIds(availableUnitIds);
    }
  };

  // 重置图谱整合工作流
  const handleResetWorkflow = () => {
    Modal.confirm({
      title: '确认重置工作流',
      content: '此操作将清空所有图谱整合工作台的数据，包括已选择的分集图谱、整合结果和全局角色图谱。此操作不可恢复，是否确认？',
      okText: '确认重置',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          // 清空所有相关状态
          setCharacterDraftContent('');
          setCharacterIntegrationResult('');
          setGlobalCharacterContent('');
          setCharacterIntegrationFinalTime(0); // 清除最终用时
          setIsCharacterWorkflowReset(true); // 设置重置标志
          
          // 清空角色整合结果相关状态
          setAvailableCharacterIntegrations([]); // 清空可用的角色整合结果列表
          setSelectedCharacterIntegrations([]); // 清空选择的角色整合结果
          setCharacterEpisodeSegments([]); // 清空按集数拆解的片段
          setSelectedEpisodeSegments(new Set()); // 清空选择的集数片段
          setIsCharacterIntegrationResultModalVisible(false); // 关闭角色整合结果模态框
          
          // 清空角色相关模态框和预览状态
          setCharacterModalSelectedFileIds(new Set()); // 清空选择的分集角色图谱文件ID
          setPreviewCharacterContent(''); // 清空预览内容
          setIsCharacterResultPreviewVisible(false); // 关闭角色结果预览模态框
          setIsCharacterResultEditing(false); // 重置角色结果编辑状态
          setCharacterResultEditContent(''); // 清空角色结果编辑内容
          setIsCharacterModalVisible(false); // 关闭角色知识图谱模态框
          setIsGlobalCharacterModalVisible(false); // 关闭全局角色图谱编辑模态框
          setIsCharacterSelectionModalVisible(false); // 关闭选择分集角色图谱模态框
          setIsCharacterDraftPreviewVisible(false); // 关闭角色图谱预览模态框
          
          // 清空localStorage中的数据
          if (id) {
            sessionStorage.removeItem(draftStorageKey('characterDraftContent'));
            sessionStorage.removeItem(draftStorageKey('globalCharacterContent'));
          }
          
          // 清除数据库中的相关数据
          try {
            console.log('开始清除数据库中的角色整合数据...');
            
            // 尝试删除角色整合任务（如果API不存在则跳过）
            try {
              await aiAPI.deleteTasksByType(id, 'character_integration');
              console.log('角色整合任务删除完成');
            } catch (deleteError) {
              console.warn('删除角色整合任务失败（可能API不存在）:', deleteError);
              // 这里不抛出错误，继续执行后续清理
            }
            
            // 清空全局角色图谱内容（这个API应该存在）
            await aiAPI.saveGlobalCharacterContent(id, '');
            console.log('全局角色图谱内容清除完成');
            
          } catch (error) {
            console.error('清除数据库数据失败:', error);
            // 即使数据库清除失败，也要继续清空前端状态
          }
          
          // 确保localStorage被正确清空
          if (id) {
            sessionStorage.setItem(draftStorageKey('characterDraftContent'), '');
            sessionStorage.setItem(draftStorageKey('globalCharacterContent'), '');
            console.log('localStorage已清空');
          }
          
          // 等待一定时间后重新加载数据，确保数据库操作完成
          setTimeout(async () => {
            try {
              console.log('重新加载角色整合相关数据...');
              
              // 先验证数据库是否真的清空了
              const verifyResponse = await aiAPI.getGlobalCharacterContent(id);
              if (verifyResponse.success && verifyResponse.content && verifyResponse.content.trim()) {
                console.warn('数据库清除不完整，重新尝试清除...');
                await aiAPI.saveGlobalCharacterContent(id, '');
                // 再次验证
                const secondVerify = await aiAPI.getGlobalCharacterContent(id);
                if (secondVerify.success && secondVerify.content && secondVerify.content.trim()) {
                  console.error('数据库清除失败，请联系管理员');
                  message.error('重置失败：数据库清除不完整，请联系管理员');
                  return;
                }
              }
              
              await loadGlobalCharacterContent();
              await loadCharacterIntegrationResult();
              console.log('数据重新加载完成');
              
              // 最终验证状态是否正确清空
              if (globalCharacterContent) {
                console.warn('前端状态未正确清空，强制清空...');
                setGlobalCharacterContent('');
              }
              
            } catch (error) {
              console.warn('重新加载数据时出现警告:', error);
            }
            
            // 重置重置标志
            setIsCharacterWorkflowReset(false);
          }, 800); // 增加等待时间确保数据库操作完成
          
          message.success('图谱整合工作流已重置');
        } catch (error) {
          console.error('重置工作流失败:', error);
          message.error('重置工作流失败，请重试');
        }
      }
    });
  };

  // 判断工作流是否已完成
  const isWorkflowCompleted = !!globalCharacterContent && !isCharacterWorkflowReset;

  // ===================== 新增：三步工作流处理函数 =====================
  
  // 重置单元工作流
  const handleResetUnitWorkflow = (unitId) => {
    Modal.confirm({
      title: '确认重置单元工作流',
      content: '此操作将清空该单元的所有工作流数据，包括选择的素材、整合结果等。此操作不可恢复，是否确认？',
      okText: '确认重置',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await scriptUnitsAPI.resetWorkflow(unitId);
          await loadScriptUnits();
          
          // 清空前端状态
          setAvailableCharacterIntegrations([]);
          setSelectedCharacterIntegrations([]);
          setCharacterEpisodeSegments([]);
          setSelectedEpisodeSegments(new Set());
          
          message.success('单元工作流重置成功');
        } catch (error) {
          console.error('重置单元工作流失败:', error);
          message.error('重置单元工作流失败');
        }
      }
    });
  };

  // 获取单元的步骤状态
  const getUnitStepStatus = (unit, step) => {
    if (!unit) return 'wait';
    
    switch (step) {
      case 1:
        return unit.step1_completed ? 'finish' : 'process';
      case 2:
        if (!unit.step1_completed) return 'wait';
        return unit.step2_completed ? 'finish' : 'process';
      case 3:
        if (!unit.step2_completed) return 'wait';
        return unit.step3_character_graph_completed ? 'finish' : 'process';
      case 4:
        if (!unit.step2_completed) return 'wait';
        return unit.step4_completed ? 'finish' : 'process';
      default:
        return 'wait';
    }
  };

  // 检查步骤是否可以执行
  const canExecuteStep = (unit, step) => {
    if (!unit || !canEdit) return false;
    
    switch (step) {
      case 1:
        return !unit.step1_completed;
      case 2:
        return unit.step1_completed && !unit.step2_completed;
      case 3:
        return unit.step2_completed && !unit.step3_character_graph_completed;
      case 4:
        return unit.step2_completed && !unit.step4_completed;
      default:
        return false;
    }
  };

  // 步骤1：选择素材
  const handleStep1 = () => {
    if (!activeUnitId) return;
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!canExecuteStep(activeUnit, 1)) return;
    
    // 重置选择状态
    setUnitMaterialSelectedFileIds(new Set());
    setIsStep1ModalVisible(true);
  };

  // 步骤1：预览选择的内容（从模态框中）
  const handleStep1Preview = () => {
    const selectedFiles = processedFiles.filter(f => unitMaterialSelectedFileIds.has(f.id));
    
    if (selectedFiles.length === 0) {
      message.warning('请先选择要预览的内容');
      return;
    }
    
    // 构建预览内容
    const episodeContent = selectedFiles
      .map(f => {
        const episodeNum = extractEpisodeNumber(f.original_name);
        const episodeTitle = episodeNum ? `第${episodeNum}集` : f.original_name;
        return `${episodeTitle}\n\n${f.task_result || '无内容'}`;
      })
      .join('\n\n---\n\n');
    
    const previewContent = '【分集剧本】\n\n' + episodeContent;
    setStep1EditContent(previewContent); // 设置到正确的状态变量
    setIsStep1PreviewVisible(true);
  };

  // 步骤1：预览已选择的内容（从卡片中）
  const handleStep1CardPreview = () => {
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!activeUnit || !activeUnit.draft_content) {
      message.warning('该单元暂无内容可预览');
      return;
    }
    
    setStep2PreviewContent(activeUnit.draft_content);
    setStep1EditContent(activeUnit.draft_content);
    setIsStep1PreviewVisible(true);
  };

  // 步骤1：保存编辑内容
  const handleStep1Save = async () => {
    if (!activeUnitId) return;
    
    try {
      await updateUnitContent(activeUnitId, { draftContent: step1EditContent });
      await loadScriptUnits();
      setIsStep1PreviewVisible(false);
      message.success('步骤1内容保存成功');
    } catch (error) {
      console.error('保存步骤1内容失败:', error);
      message.error('保存失败');
    }
  };

  // 步骤2：保存编辑内容
  const handleStep2Save = async () => {
    if (!activeUnitId) return;
    
    try {
      await updateUnitContent(activeUnitId, { contentIntegrationResult: step2EditContent });
      await loadScriptUnits();
      setIsStep2ModalVisible(false);
      message.success('步骤2内容保存成功');
    } catch (error) {
      console.error('保存步骤2内容失败:', error);
      message.error('保存失败');
    }
  };

  // 步骤3：预览功能
  const handleStep3Preview = () => {
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!activeUnit || !activeUnit.enhanced_content_integration_result) {
      message.warning('该单元暂无步骤3结果可预览');
      return;
    }
    
    setStep3PreviewContent(activeUnit.enhanced_content_integration_result);
    setStep3EditContent(activeUnit.enhanced_content_integration_result);
    setIsStep3PreviewVisible(true);
  };

  // 步骤3：保存编辑内容
  const handleStep3Save = async () => {
    if (!activeUnitId) return;
    
    try {
      await updateUnitContent(activeUnitId, { enhancedContentIntegrationResult: step3EditContent });
      await loadScriptUnits();
      setIsStep3PreviewVisible(false);
      message.success('步骤3内容保存成功');
    } catch (error) {
      console.error('保存步骤3内容失败:', error);
      message.error('保存失败');
    }
  };

  // 判断是否可以重新选择步骤1（只有步骤2未完成时才可以）
  const canReselectStep1 = (unit) => {
    return unit && unit.step1_completed && !unit.step2_completed;
  };

  // 判断是否可以重新选择步骤3（只有步骤4未完成时才可以）
  const canReselectStep3 = (unit) => {
    return unit && unit.step3_character_graph_completed && !unit.step4_completed;
  };

  // 步骤1：重新选择素材
  const handleStep1Reselect = () => {
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!canReselectStep1(activeUnit)) {
      message.warning('步骤2已完成，无法重新选择步骤1的素材');
      return;
    }
    
    // 重置步骤1相关状态
    setUnitMaterialSelectedFileIds(new Set());
    setStep1PreviewContent('');
    setStep1EditContent('');
    
    // 直接打开步骤1模态框，绕过canExecuteStep限制
    setIsStep1ModalVisible(true);
  };

  // 步骤3：重新选择角色图谱
  const handleStep3Reselect = () => {
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!canReselectStep3(activeUnit)) {
      message.warning('步骤4已完成，无法重新选择步骤3的角色图谱');
      return;
    }
    
    // 重置步骤3相关状态
    setSelectedEpisodeSegments(new Set());
    setCharacterEpisodeSegments([]);
    setStep3PreviewContent('');
    setStep3EditContent('');
    
    // 加载角色图谱数据并直接打开模态框，绕过canExecuteStep限制
    loadCharacterIntegrations(activeUnitId).then(() => {
      setIsStep3ModalVisible(true);
    });
  };

  // 步骤4：保存编辑内容
  const handleStep4Save = async () => {
    if (!activeUnitId) return;
    
    try {
      await updateUnitContent(activeUnitId, { characterIntegrationResult: step4EditContent });
      await loadScriptUnits();
      setIsStep4ModalVisible(false);
      message.success('步骤4内容保存成功');
    } catch (error) {
      console.error('保存步骤4内容失败:', error);
      message.error('保存失败');
    }
  };

  // 确认步骤1选择的素材
  const handleConfirmStep1 = async () => {
    const selectedFiles = processedFiles.filter(f => unitMaterialSelectedFileIds.has(f.id));
    
    if (selectedFiles.length === 0) {
      message.warning('请至少选择一集分集剧本');
      return;
    }
    
    if (selectedFiles.length > 10) {
      message.warning('最多只能选择10集分集剧本');
      return;
    }

    try {
      setUnitWorkflowProcessing(prev => ({ 
      ...prev, 
      [activeUnitId]: { 
        ...prev[activeUnitId], 
        step1: true 
      } 
    }));

      // 构建内容
      const episodeContent = selectedFiles
        .map(f => {
          const episodeNum = extractEpisodeNumber(f.original_name);
          const episodeTitle = episodeNum ? `第${episodeNum}集` : f.original_name;
          return `${episodeTitle}\n\n${f.task_result || '无内容'}`;
        })
        .join('\n\n---\n\n');
      
      const draftContent = '【分集剧本】\n\n' + episodeContent;

      // 提取集数（用于更新单元名称）
      const selectedEpisodes = selectedFiles.map(f => extractEpisodeNumber(f.original_name)).filter(Boolean);

      // 调用API完成步骤1
      await scriptUnitsAPI.executeStep1(activeUnitId, {
        selectedFileIds: [...unitMaterialSelectedFileIds],
        selectedEpisodes,
        draftContent
      });

      // 重新加载单元数据
      await loadScriptUnits();
      setIsStep1ModalVisible(false);
      setUnitMaterialSelectedFileIds(new Set());
      
      message.success(`第一步完成：${selectedFiles.length}项素材已添加`);

    } catch (error) {
      console.error('步骤1执行失败:', error);
      message.error('步骤1执行失败');
    } finally {
      setUnitWorkflowProcessing(prev => ({ 
        ...prev, 
        [activeUnitId]: { 
          ...prev[activeUnitId], 
          step1: false 
        } 
      }));
    }
  };

  // 步骤2：内容整合
  const handleStep2 = () => {
    if (!activeUnitId) return;
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!canExecuteStep(activeUnit, 2)) return;
    
    // 设置预览内容
    setStep2PreviewContent(activeUnit.draft_content || '');
    setStep2EditContent(activeUnit.content_integration_result || '');
    setIsStep2ModalVisible(true);
  };

  // 执行步骤2内容整合
  const handleExecuteStep2 = async () => {
    // 立即关闭模态框
    setIsStep2ModalVisible(false);
    
    try {
      setUnitWorkflowProcessing(prev => ({ 
      ...prev, 
      [activeUnitId]: { 
        ...prev[activeUnitId], 
        step2: true 
      } 
    }));

      const response = await scriptUnitsAPI.executeStep2(activeUnitId, {
        contentIntegrationPrompt: form.getFieldValue('integrationPrompt'),
        modelConfig: {
          model: form.getFieldValue('integration_model') || modelConfig.defaultModel,
          temperature: form.getFieldValue('integration_temperature') || 1
        }
      });

      await loadScriptUnits();
      message.success('第二步完成：内容整合成功');

    } catch (error) {
      console.error('步骤2执行失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
          errorMessage.includes('代理') || errorMessage.includes('连接')) {
        message.warning('模型调用失败，请联系管理员检查系统配置', 6);
      } else {
        message.error(`步骤2执行失败: ${errorMessage}`);
      }
    } finally {
      setUnitWorkflowProcessing(prev => ({ 
        ...prev, 
        [activeUnitId]: { 
          ...prev[activeUnitId], 
          step2: false 
        } 
      }));
    }
  };

  // 获取角色整合结果列表
  // 按集数拆解角色整合结果的函数
  const parseEpisodesFromCharacterContent = (content) => {
    console.log('🔍 [解析函数] 开始解析角色图谱内容:', content);
    if (!content) {
      console.log('⚠️ [解析函数] 内容为空，返回空数组');
      return [];
    }
    
    // 使用正则表达式匹配集数相关的内容
    const episodePatterns = [
      /第(\d+)集/g,
      /(\d+)\.?\s*集/g,
      /Episode\s*(\d+)/gi,
      /EP\.?\s*(\d+)/gi
    ];
    console.log('📝 [解析函数] 使用的匹配模式:', episodePatterns.map(p => p.toString()));
    
    const episodeSegments = [];
    const lines = content.split('\n');
    console.log('📄 [解析函数] 分割后的行数:', lines.length);
    let currentEpisode = null;
    let currentSegment = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      console.log(`🔍 [解析函数] 处理第${i+1}行: "${line}"`);
      
      // 检查是否是集数标题
      let episodeFound = false;
      for (const pattern of episodePatterns) {
        const matches = line.match(pattern);
        if (matches) {
          console.log(`✅ [解析函数] 找到集数匹配: ${pattern.toString()} -> ${matches[0]}`);
          // 保存当前片段
          if (currentEpisode && currentSegment.length > 0) {
            episodeSegments.push({
              episode: currentEpisode,
              content: currentSegment.join('\n'),
              title: `第${currentEpisode}集`,
              id: `episode_${currentEpisode}`
            });
          }
          
          // 开始新片段
          currentEpisode = parseInt(matches[0].match(/\d+/)[0]);
          currentSegment = [line];
          episodeFound = true;
          break;
        }
      }
      
      if (!episodeFound && currentEpisode) {
        currentSegment.push(line);
      } else if (!episodeFound && !currentEpisode) {
        // 如果没有找到明确的集数标识，将其归为通用内容
        console.log(`📝 [解析函数] 没有找到集数标识，归为通用内容: "${line}"`);
        if (!episodeSegments.find(seg => seg.id === 'general')) {
          episodeSegments.push({
            episode: 0,
            content: line,
            title: '通用内容',
            id: 'general'
          });
        } else {
          const generalSegment = episodeSegments.find(seg => seg.id === 'general');
          generalSegment.content += '\n' + line;
        }
      }
    }
    
    // 保存最后一个片段
    if (currentEpisode && currentSegment.length > 0) {
      episodeSegments.push({
        episode: currentEpisode,
        content: currentSegment.join('\n'),
        title: `第${currentEpisode}集`,
        id: `episode_${currentEpisode}`
      });
    }
    
    // 按集数排序
    const result = episodeSegments.sort((a, b) => a.episode - b.episode);
    console.log('🎬 [解析函数] 最终解析结果:', result);
    return result;
  };

  const loadCharacterIntegrations = async (unitId) => {
    try {
      console.log('🔍 开始加载角色整合结果，unitId:', unitId);
      const response = await scriptUnitsAPI.getCharacterIntegrations(unitId);
      console.log('📡 角色整合结果API响应:', response);
      
      const integrations = response.data || [];
      const episodeSegments = resolveCharacterEpisodeSegments(response, parseEpisodesFromCharacterContent);
      console.log('📊 处理后的integrations数组:', integrations);
      console.log('🎬 可选择的分集角色图谱:', episodeSegments);
      setAvailableCharacterIntegrations(integrations);
      setSelectedCharacterIntegrations(integrations.length > 0 ? [integrations[0]] : []);
      setCharacterEpisodeSegments(episodeSegments);
      
      if (episodeSegments.length === 0) {
        setSelectedEpisodeSegments(new Set());
        message.warning('尚未生成可用的分集角色图谱');
        return false;
      }

      // 自动勾选逻辑：优先还原历史选择，否则匹配步骤1已选择的集数。
      const autoSelected = new Set();
      try {
        const unit = scriptUnits.find(u => u.id === unitId);
        if (unit) {
          let historySelection = [];
          if (Array.isArray(unit.selected_character_graphs)) {
            historySelection = unit.selected_character_graphs;
          } else if (typeof unit.selected_character_graphs === 'string') {
            try {
              const parsed = JSON.parse(unit.selected_character_graphs);
              if (Array.isArray(parsed)) historySelection = parsed;
            } catch (error) {
              console.warn('解析历史selected_character_graphs失败:', error);
            }
          }

          const validIds = new Set(episodeSegments.filter(segment => segment.id !== 'general').map(segment => segment.id));
          historySelection.forEach(segmentId => {
            if (validIds.has(segmentId)) autoSelected.add(segmentId);
          });

          if (autoSelected.size === 0) {
            const step1Episodes = unit.selected_materials?.selectedEpisodes
              || (Array.isArray(unit.selected_episodes) ? unit.selected_episodes : []);
            const step1Set = new Set((Array.isArray(step1Episodes) ? step1Episodes : []).map(Number));
            episodeSegments.forEach(segment => {
              if (segment.id !== 'general' && step1Set.has(Number(segment.episode))) {
                autoSelected.add(segment.id);
              }
            });
          }
        }
      } catch (error) {
        console.warn('步骤3自动选择逻辑异常:', error);
      }

      setSelectedEpisodeSegments(autoSelected);
      return true;
    } catch (error) {
      console.error('💥 获取角色整合结果失败:', error);
      console.error('错误详情:', error.response?.data);
      setAvailableCharacterIntegrations([]);
      setSelectedCharacterIntegrations([]);
      setCharacterEpisodeSegments([]);
      setSelectedEpisodeSegments(new Set());
      message.error(error.response?.data?.message || '角色图谱列表加载失败');
      return false;
    }
  };

  // 步骤3：添加角色图谱
  const handleStep3 = async () => {
    if (!activeUnitId) return;
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!canExecuteStep(activeUnit, 3)) return;
    
    // 加载按集数拆解的角色图谱数据
    const loaded = await loadCharacterIntegrations(activeUnitId);
    if (!loaded) return;
    
    setIsStep3ModalVisible(true);
  };



  // 处理集数片段的选择
  const handleEpisodeSegmentSelect = (segmentId, checked) => {
    const newSelected = new Set(selectedEpisodeSegments);
    if (checked) {
      newSelected.add(segmentId);
    } else {
      newSelected.delete(segmentId);
    }
    setSelectedEpisodeSegments(newSelected);
  };

  // 全选/取消全选集数片段
  const handleSelectAllEpisodeSegments = () => {
    if (selectedEpisodeSegments.size === characterEpisodeSegments.length) {
      // 当前全选，改为全不选
      setSelectedEpisodeSegments(new Set());
    } else {
      // 当前未全选，改为全选
      const allSegmentIds = new Set(characterEpisodeSegments.map(seg => seg.id));
      setSelectedEpisodeSegments(allSegmentIds);
    }
  };

  // 获取选中的集数片段内容
  const getSelectedEpisodeContent = () => {
    return characterEpisodeSegments
      .filter(segment => selectedEpisodeSegments.has(segment.id))
      .map(segment => segment.content)
      .join('\n\n');
  };



  // 执行步骤3添加角色图谱
  const handleExecuteStep3 = async () => {
    // 检查是否有可选择的集数片段
    if (characterEpisodeSegments.length === 0) {
      message.warning('暂无可选择的角色图谱集数片段');
      return;
    }

    // 检查是否至少选择了一个集数片段
    if (selectedEpisodeSegments.size === 0) {
      message.warning('请至少选择一个集数片段');
      return;
    }

    try {
      setUnitWorkflowProcessing(prev => ({ 
        ...prev, 
        [activeUnitId]: { 
          ...prev[activeUnitId], 
          step3: true 
        } 
      }));

      // 获取选中的片段内容
      const selectedContent = getSelectedEpisodeContent();
      const characterData = {
        selectedEpisodeContent: selectedContent,
        selectedSegments: Array.from(selectedEpisodeSegments)
      };

      console.log('🚀 步骤3发送数据:', {
        activeUnitId,
        selectedContentLength: selectedContent ? selectedContent.length : 0,
        selectedSegments: characterData.selectedSegments,
        characterData
      });

      await scriptUnitsAPI.executeStep3CharacterGraph(activeUnitId, characterData);

      await loadScriptUnits();
      setIsStep3ModalVisible(false);
      setSelectedEpisodeSegments(new Set()); // 清空集数片段选择
      message.success('步骤3完成：角色图谱添加成功');

    } catch (error) {
      console.error('步骤3执行失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      message.error(`步骤3执行失败: ${errorMessage}`);
    } finally {
      setUnitWorkflowProcessing(prev => ({ 
        ...prev, 
        [activeUnitId]: { 
          ...prev[activeUnitId], 
          step3: false 
        } 
      }));
    }
  };



  // 步骤4：角色整合
  const handleStep4 = () => {
    if (!activeUnitId) return;
    const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
    if (!canExecuteStep(activeUnit, 4)) return;
    
    // 优先使用增强后的内容整合结果（如果添加了角色图谱），否则使用原始的内容整合结果
    const contentForCharacterIntegration = activeUnit.enhanced_content_integration_result || activeUnit.content_integration_result || '';
    setStep4PreviewContent(contentForCharacterIntegration);
    setStep4EditContent(activeUnit.character_integration_result || '');
    setIsStep4ModalVisible(true);
  };

  // 执行步骤4角色整合
  const handleExecuteStep4 = async () => {
    // 立即关闭模态框
    setIsStep4ModalVisible(false);
    
    try {
      setUnitWorkflowProcessing(prev => ({ 
      ...prev, 
      [activeUnitId]: { 
        ...prev[activeUnitId], 
        step4: true 
      } 
    }));

      const response = await scriptUnitsAPI.executeStep4(activeUnitId, {
        characterPrompt: form.getFieldValue('characterPrompt'),
        modelConfig: {
          model: form.getFieldValue('character_model') || modelConfig.defaultModel,
          temperature: form.getFieldValue('character_temperature') || 1
        }
      });

      await loadScriptUnits();
      message.success('第四步完成：角色整合成功');

    } catch (error) {
      console.error('步骤4执行失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '未知错误';
      if (errorMessage.includes('API') || errorMessage.includes('密钥') || 
          errorMessage.includes('代理') || errorMessage.includes('连接')) {
        message.warning('模型调用失败，请联系管理员检查系统配置', 6);
      } else {
        message.error(`步骤4执行失败: ${errorMessage}`);
      }
    } finally {
      setUnitWorkflowProcessing(prev => ({ 
        ...prev, 
        [activeUnitId]: { 
          ...prev[activeUnitId], 
          step4: false 
        } 
      }));
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Layout className="workspace-layout">
      <style>{simpleTabsStyle}</style>
      <style>{`.edit-analysis-modal .ant-modal-content{overflow:hidden!important;}
.edit-analysis-modal .ant-modal-body{overflow:hidden!important;}
.edit-analysis-modal .ant-modal-wrap{overflow:hidden!important;}`}</style>
      <Header className="workspace-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button 
            type="primary" 
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/workspace')}
          >
            返回项目选择
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            {project?.name}
          </Title>
        </div>
        
        <div className="header-right">
          <Space size="middle">
            <Button
              type="default"
              icon={<TeamOutlined />}
              onClick={() => navigate(`/project/${id}/characters`)}
            >
              角色档案中心
            </Button>
            <Badge 
              count={queueCount} 
              size="small"
              showZero
              style={{ 
                backgroundColor: '#fa8c16',
                boxShadow: '0 0 0 1px #fff'
              }}
            >
              <Button 
                type="default"
                icon={<BarsOutlined />} 
                onClick={() => setQueueModalVisible(true)}
                style={{
                  color: '#fa8c16',
                  borderColor: '#fa8c16'
                }}
              >
                后台解析任务
              </Button>
            </Badge>
            <Dropdown 
              overlay={(
                <Menu onClick={handleMenuClick}>
                  {user?.role === 'admin' && (
                    <Menu.Item key="userManagement">用户管理</Menu.Item>
                  )}
                  {user?.role === 'admin' && (
                    <Menu.Item key="systemConfig">系统配置</Menu.Item>
                  )}
                  <Menu.Item key="changePassword">修改密码</Menu.Item>
                  <Menu.Item key="logout">退出</Menu.Item>
                </Menu>
              )} 
              trigger={['click']}
            >
              <Button type="link" className="user-menu-button">
                👋 {user?.username}
              </Button>
            </Dropdown>
          </Space>
        </div>
      </Header>

      <Content style={{ padding: '16px' }}>
        {/* 右上角任务入口与卡片 */}
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 1000, display: 'flex', gap: 8 }}>
          <Badge count={badgeCount} size="small">
            <Button
              icon={<BellOutlined />}
              onClick={() => setIsTaskPanelVisible(v => !v)}
              size="small"
            />
          </Badge>
        </div>
        {isTaskPanelVisible && (
          <Card
            size="small"
            title="任务中心"
            style={{ position: 'fixed', top: 44, right: 16, width: 360, zIndex: 1000, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}
            extra={<Button size="small" type="text" onClick={() => setIsTaskPanelVisible(false)}>关闭</Button>}
          >
            <div style={{ marginBottom: 8, fontWeight: 600 }}>正在执行</div>
            {runningTasks.length === 0 ? (
              <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>暂无进行中的任务</div>
            ) : (
              <List
                size="small"
                dataSource={runningTasks}
                renderItem={(t) => (
                  <List.Item
                    actions={[
                      <Tooltip title="暂停" key="p"><Button icon={<PauseOutlined />} size="small" onClick={() => pauseTask(t.id)} /></Tooltip>,
                      <Tooltip title="取消" key="c"><Button icon={<StopOutlined />} size="small" danger onClick={() => cancelTask(t.id)} /></Tooltip>
                    ]}
                  >
                    <List.Item.Meta
                      title={<span title={t.file_name || t.prompt} style={{ maxWidth: 220, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.file_name || t.prompt}</span>}
                      description={<span style={{ fontSize: 12, color: '#999' }}>{t.started_at ? dayjs(t.started_at).fromNow(true) : '—'}</span>}
                    />
                  </List.Item>
                )}
              />
            )}

            <div style={{ margin: '12px 0 8px', fontWeight: 600 }}>排队中</div>
            {queuedTasks.length === 0 ? (
              <div style={{ color: '#999', fontSize: 12 }}>暂无排队任务</div>
            ) : (
              <List
                size="small"
                dataSource={queuedTasks}
                renderItem={(t) => (
                  <List.Item
                    actions={[
                      t.status === 'paused'
                        ? <Tooltip title="继续" key="r"><Button icon={<PlayCircleOutlined />} size="small" onClick={() => resumeTask(t.id)} /></Tooltip>
                        : <Tooltip title="暂停" key="p"><Button icon={<PauseOutlined />} size="small" onClick={() => pauseTask(t.id)} /></Tooltip>,
                      <Tooltip title="取消" key="c"><Button icon={<StopOutlined />} size="small" danger onClick={() => cancelTask(t.id)} /></Tooltip>
                    ]}
                  >
                    <List.Item.Meta
                      title={<span title={t.file_name || t.prompt} style={{ maxWidth: 220, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.file_name || t.prompt}</span>}
                      description={<span style={{ fontSize: 12, color: '#999' }}>{dayjs(t.created_at).fromNow(true)}</span>}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        )}
        <Tabs 
          type="card" 
          activeKey={activeTabKey}
          onChange={setActiveTabKey}
          style={{ 
            height: '100%',
            fontSize: '18px'
          }}
          tabBarStyle={{
            fontSize: '18px',
            fontWeight: '600',
            padding: '0 12px',
            color: '#262626'
          }}
        >
          <Tabs.TabPane tab="视频解析" key="1">
            <Row gutter={[16, 16]}>
              <Col span={24}>
                  <Row gutter={24}>
                    {/* Left: Analysis Controls */}
                    <Col xs={24} lg={8}>
                      <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        minHeight: '760px',
                        position: 'sticky',
                        top: '16px',
                        backgroundColor: '#fafafa',
                        padding: '16px',
                        borderRadius: '8px'
                      }}>
                        <Form form={form} layout="vertical" onFinish={handleSavePrompts} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                          <Card title={<Title level={5} style={{margin:0}}>1. 上传短剧视频</Title>} style={{ marginBottom: 12, flexShrink: 0 }}>
                          <Space direction="vertical" style={{ width: '100%' }} size="small">
                            <div
                              style={{
                                width: '100%',
                                height: '120px',
                                border: '2px dashed #d9d9d9',
                                borderRadius: '6px',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                alignItems: 'center',
                                cursor: canEdit ? 'pointer' : 'not-allowed',
                                backgroundColor: canEdit ? '#fafafa' : '#f5f5f5',
                                transition: 'border-color 0.3s, background-color 0.3s',
                                gap: '12px',
                                opacity: canEdit ? 1 : 0.6
                              }}
                              onClick={() => {
                                if (!canEdit) return;
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.multiple = true;
                                input.accept = '.mp4,.mov,.avi,.mkv,.wmv';
                                input.onchange = (e) => {
                                  const selectedFiles = Array.from(e.target.files);
                                  const maxFiles = 10;
                                  
                                  // 限制文件数量
                                  let filesToProcess = selectedFiles;
                                  if (selectedFiles.length > maxFiles) {
                                    message.warning(`一次最多只能上传${maxFiles}个文件，已自动选择前${maxFiles}个文件进行上传`);
                                    filesToProcess = selectedFiles.slice(0, maxFiles);
                                  }
                                  
                                  // 检查重名文件
                                  const duplicateFiles = [];
                                  const validFiles = [];
                                  
                                  filesToProcess.forEach(file => {
                                    if (checkFileNameExists(file.name)) {
                                      duplicateFiles.push(file.name);
                                    } else {
                                      validFiles.push(file);
                                    }
                                  });
                                  
                                  // 显示重名文件提示
                                  if (duplicateFiles.length > 0) {
                                    duplicateFiles.forEach(fileName => {
                                      message.warning(`${fileName}已存在，请检查后重新上传`);
                                    });
                                  }
                                  
                                  // 上传有效文件
                                  if (validFiles.length > 0) {
                                    validFiles.forEach(file => {
                                      if (canEdit) handleFileUpload(file);
                                    });
                                  }
                                };
                                input.click();
                              }}
                              onMouseEnter={(e) => {
                                if (canEdit) {
                                  e.target.style.borderColor = '#1890ff';
                                  e.target.style.backgroundColor = '#f6f9ff';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (canEdit) {
                                  e.target.style.borderColor = '#d9d9d9';
                                  e.target.style.backgroundColor = '#fafafa';
                                }
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <UploadOutlined style={{ fontSize: '20px', color: canEdit ? '#1890ff' : '#999' }} />
                                <span style={{ color: canEdit ? '#666' : '#999', fontSize: '14px' }}>
                                  点击上传分集视频（一次最多 10 个）
                                </span>
                              </div>
                              
                              {/* 视频文件命名提示 */}
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 10px',
                                backgroundColor: '#fffbf0',
                                border: '1px solid #ffecc7',
                                borderRadius: '4px',
                                color: '#d46b08',
                                fontSize: '11px',
                                whiteSpace: 'nowrap'
                              }}>
                                <InfoCircleOutlined style={{ color: '#f0a020', fontSize: '12px' }} />
                                <span>请以集数命名视频文件 (如: 1.mp4)，否则将影响后续剧本整合</span>
                              </div>
                            </div>
                            </Space>
                          </Card>
                          <Card title={<Title level={5} style={{margin:0}}>2. 分析设置</Title>} style={{ flex: 1 }}>
                            <Collapse
                              ghost
                              items={[{
                                key: 'advanced-analysis',
                                label: (
                                  <div>
                                    <div style={{ fontWeight: 600 }}>高级分析设置</div>
                                    <Text type="secondary" style={{ fontSize: 12 }}>模型、Temperature 与 Prompt</Text>
                                  </div>
                                ),
                                children: (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <Form.Item name="model" label="模型">
                                <Select disabled={!canEdit}>
                                  {(modelConfig.availableModels || []).map(model => (
                                    <Option key={model} value={model}>{model}</Option>
                                  ))}
                                </Select>
                              </Form.Item>

                              <Form.Item label="Temperature">
                                <Row align="middle">
                                  <Col flex="auto">
                                    <Form.Item name="temperature" noStyle initialValue={1}>
                                      <Slider min={0} max={2} step={0.1} disabled={!canEdit} style={{ marginRight: '16px' }}/>
                                    </Form.Item>
                                  </Col>
                                  <Col flex="none">
                                    <Form.Item name="temperature" noStyle initialValue={1}>
                                      <InputNumber min={0} max={2} step={0.1} disabled={!canEdit} style={{ width: 70 }} />
                                    </Form.Item>
                                  </Col>
                                </Row>
                              </Form.Item>

                              <Form.Item name="analysis_prompt" label="视频解析Prompt" style={{ marginBottom: 8, flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                  <EditableTextArea
                                    value={form.getFieldValue('analysis_prompt')}
                                    onChange={value => form.setFieldsValue({ analysis_prompt: value })}
                                    onSave={canEdit ? handleSaveAnalysisPrompt : undefined}
                                    onLoadDefault={canEdit ? handleLoadDefaultAnalysisPrompt : undefined}
                                    placeholder={usingSystemDefaults.analysis ? 
                                      "当前使用系统默认Prompt（点击放大编辑按钮进行编辑）" : 
                                      "例如：请将视频内容解析为剧本格式..."}
                                    title="编辑内容解析Prompt"
                                    rows={8}
                                    disabled={!canEdit}
                                    autoSize={true}
                                  />
                                </div>
                              </Form.Item>
                              
                              <Form.Item name="characterKnowledgeGraphPrompt" label="角色知识图谱Prompt" style={{ marginBottom: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                  <EditableTextArea
                                    value={form.getFieldValue('characterKnowledgeGraphPrompt')}
                                    onChange={value => form.setFieldsValue({ characterKnowledgeGraphPrompt: value })}
                                    onSave={canEdit ? handleSaveCharacterKnowledgeGraphPrompt : undefined}
                                    onLoadDefault={canEdit ? handleLoadDefaultCharacterKnowledgeGraphPrompt : undefined}
                                    placeholder={usingSystemDefaults.characterKnowledgeGraph ? 
                                      "当前使用系统默认Prompt（点击放大编辑按钮进行编辑）" : 
                                      "例如：请分析视频中的角色关系和特征..."}
                                    title="编辑角色知识图谱Prompt"
                                    rows={8}
                                    disabled={!canEdit}
                                    autoSize={true}
                                  />
                                </div>
                              </Form.Item>
                            </div>
                                )
                              }]}
                            />
                          </Card>
                        </Form>
                      </div>
                    </Col>

                    {/* Right: Video List */}
                    <Col xs={24} lg={16}>
                      <div className="video-processing-container" style={{ minHeight: '760px', display: 'flex', flexDirection: 'column' }}>
                         {/* 新的视频操作头部组件 */}
                         <VideoOperationsHeader
                           selectedCount={selectedFileIds.size}
                           totalCount={processedFiles.length}
                           allFilesSelected={allFilesSelected}
                           onSelectAll={handleSelectAll}
                           analysisStatusFilter={analysisStatusFilter}
                           onAnalysisStatusFilterChange={setAnalysisStatusFilter}
                           characterGraphFilter={characterGraphFilter}
                           onCharacterGraphFilterChange={setCharacterGraphFilter}
                           sortOrder={sortOrder}
                           onSortChange={handleSortChange}
                           statusStatistics={statusStatistics}
                           onShowStatistics={handleShowStatistics}
                           moreActions={moreActions}
                         />
                         
                         {/* 批量操作栏 */}
                         <BatchOperationsBar
                           selectedCount={selectedFileIds.size}
                           selectedFileIds={selectedFileIds}
                           canEdit={canEdit}
                           canDownload={canDownload}
                           processedFiles={processedFiles}
                           allFiles={processedFiles}
                           onAnalyzeFiles={handleAnalyseFiles}
                           onAddToQueue={handleAddSelectedToQueue}
                           onGenerateCharacterGraph={handleGenerateCharacterGraph}
                           onDownloadFiles={handleDownloadFiles}
                           onDeleteFiles={handleDeleteFiles}
                           onMarkToEpisode={handleMarkToEpisode}

                           onQuickConcatenate={handleDirectConcatenate}
                           onClearSelection={handleClearSelection}
                           addingToQueue={addingToQueue}
                         />
                         
                          <div className="video-list-content">
                            {loading ? (
                               <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                                  <Spin size="large" />
                               </div>
                            ) : paginatedFiles.length > 0 ? (
                               <List
                                itemLayout="vertical"
                                dataSource={paginatedFiles}
                                renderItem={file => (
                                  <List.Item key={file.id} style={{padding: '0', margin: '0 0 16px 0', border: 'none'}}>
                                    <VideoCard {...{ 
                                      file, 
                                      onRename: handleRenameFile, 
                                      onAnalyze: handleAnalyseFiles, 
                                      onPlay: setPlayingFile, 
                                      onDelete: handleDeleteFiles, 
                                      onEdit: handleEditResultModal, 
                                      onDownload: handleDownloadFiles,
                                      selected: selectedFileIds.has(file.id), 
                                      onSelect: handleFileSelect,
                                      isProcessing: processingFileIds.has(file.id),
                                      canEdit: canEdit,
                                      canDownload: canDownload,
                                      onCharacterGraph: handleSingleCharacterGraph,
                                      onViewCharacterGraph: handleCharacterKnowledgeGraph,
                                      processingFileIds: processingFileIds,
                                      characterGraphProcessingIds: characterGraphProcessingIds,
                                      hasCharacterGraph: characterGraphStatusMap.get(file.id) === 'success',
                                      characterGraphStatus: characterGraphStatusMap.get(file.id) || 'pending'
                                    }} />
                                  </List.Item>
                                )}
                              />
                            ) : (
                              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                               <Card><div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>暂无文件</div></Card>
                              </div>
                            )}
                          </div>
                          {processedFiles.length > pageSize && (
                            <div className="video-list-footer">
                              <Pagination 
                                current={currentPage} 
                                total={processedFiles.length} 
                                pageSize={pageSize} 
                                onChange={setCurrentPage}
                              />
                            </div>
                          )}
                      </div>
                    </Col>
                  </Row>
              </Col>
            </Row>
          </Tabs.TabPane>
          
          <Tabs.TabPane tab="角色图谱" key="2">
            <Form form={form} layout="vertical" onFinish={handleIntegrate}>
               <Row gutter={24}>
                  <Col xs={24}>
                    <div style={{ position: 'relative' }}>
                      {/* 图谱整合工作台 */}
                      <Card title="图谱整合工作台" bordered={false} style={{ marginBottom: 16 }}>
                      <div style={{ padding: '15px 0', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '150px' }}>
                        {/* 工作流程卡片 */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          gap: '12px',
                          flexWrap: 'wrap'
                        }}>

                          {/* 第一步：选择分集文本 */}
                          <div 
                            style={{
                              width: '200px',
                              height: '70px',
                              border: '2px solid #d9d9d9',
                              borderRadius: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: canEdit && !isWorkflowCompleted ? 'pointer' : 'not-allowed',
                              backgroundColor: characterDraftContent || isWorkflowCompleted ? '#f6ffed' : '#fafafa',
                              borderColor: characterDraftContent || isWorkflowCompleted ? '#52c41a' : '#d9d9d9',
                              transition: 'all 0.3s ease',
                              opacity: canEdit && !isWorkflowCompleted ? 1 : 0.6,
                              padding: '8px',
                              ...(isWorkflowCompleted ? {
                                backgroundColor: '#f6ffed',
                                borderColor: '#52c41a',
                                opacity: 0.8
                              } : {})
                            }}
                            onClick={() => {
                              if (canEdit && !isWorkflowCompleted) {
                                setCharacterModalSelectedFileIds(new Set());
                                setIsCharacterSelectionModalVisible(true);
                              } else if (isWorkflowCompleted) {
                                message.info('工作流已完成，如需重新选择请先重置工作流');
                              }
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                <SelectOutlined style={{ 
                                  fontSize: '16px', 
                                  color: characterDraftContent || isWorkflowCompleted ? '#52c41a' : '#8c8c8c',
                                  marginRight: '8px'
                                }} />
                                <div style={{ 
                                  fontSize: '12px', 
                                  color: characterDraftContent || isWorkflowCompleted ? '#52c41a' : '#595959',
                                  fontWeight: characterDraftContent || isWorkflowCompleted ? 'bold' : 'normal'
                                }}>
                                  选择分集图谱 ({(() => {
                                    const totalFiles = processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success').length;
                                    let selectedCount = 0;
                                    
                                    if (characterDraftContent && characterDraftContent.trim()) {
                                      // 尝试多种分隔符来解析选择的文件数量
                                      let sections = [];
                                      
                                      // 尝试 '\n\n---\n\n' 分隔符
                                      sections = characterDraftContent.split('\n\n---\n\n').filter(section => section.trim());
                                      
                                      // 如果没有找到，尝试其他可能的分隔符
                                      if (sections.length <= 1) {
                                        sections = characterDraftContent.split('---').filter(section => section.trim());
                                      }
                                      
                                      // 如果仍然没有找到，尝试按文件名模式计算
                                      if (sections.length <= 1) {
                                        const fileNameMatches = characterDraftContent.match(/文件名[：:]/g);
                                        if (fileNameMatches) {
                                          selectedCount = fileNameMatches.length;
                                        } else {
                                          selectedCount = sections.length > 0 ? sections.length : 1;
                                        }
                                      } else {
                                        selectedCount = sections.length;
                                      }
                                    }
                                    
                                    return `${selectedCount}/${totalFiles}`;
                                  })()})
                                </div>
                              </div>
                              {(characterDraftContent || isWorkflowCompleted) && (
                                <div style={{ 
                                  display: 'flex',
                                  alignItems: 'center',
                                  marginLeft: '24px'
                                }}>
                                  <div style={{ 
                                    fontSize: '10px', 
                                    color: '#52c41a',
                                    marginRight: '8px'
                                  }}>
                                    ✓ 已完成
                                  </div>
                                  {characterDraftContent && (
                                    <Button 
                                      type="link" 
                                      size="small" 
                                      icon={<EyeOutlined />}
                                      style={{ 
                                        fontSize: '10px',
                                        padding: '0 4px',
                                        height: '16px',
                                        lineHeight: '16px'
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewCharacterContent(characterDraftContent);
                                        setIsCharacterDraftPreviewVisible(true);
                                      }}
                                    >
                                      预览
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 连接箭头 */}
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            color: '#bfbfbf',
                            fontSize: '30px'
                          }}>
                            ··· →
                          </div>

                          {/* 第二步：图谱整合 */}
                          <div 
                            style={{
                              width: '200px',
                              height: '70px',
                              border: '2px solid #d9d9d9',
                              borderRadius: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: canEdit && characterDraftContent && !isWorkflowCompleted ? 'pointer' : 'not-allowed',
                              backgroundColor: characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') ? '#f6ffed' : 
                                             characterIntegrationResult && characterIntegrationResult.startsWith('整合失败') ? '#fff2f0' :
                                             characterDraftContent ? '#fff7e6' : '#fafafa',
                              borderColor: characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') ? '#52c41a' : 
                                          characterIntegrationResult && characterIntegrationResult.startsWith('整合失败') ? '#ff4d4f' :
                                          characterDraftContent ? '#fa8c16' : '#d9d9d9',
                              transition: 'all 0.3s ease',
                              opacity: canEdit && characterDraftContent && !isWorkflowCompleted ? 1 : 0.6,
                              padding: '8px',
                              position: 'relative', // 添加相对定位以支持绝对定位的计时器
                              ...(isWorkflowCompleted ? {
                                backgroundColor: '#f6ffed',
                                borderColor: '#52c41a',
                                opacity: 0.8
                              } : {})
                            }}
                            onClick={() => {
                              if (canEdit && characterDraftContent && !isWorkflowCompleted) {
                                handleCharacterIntegrate(form.getFieldsValue(true));
                              } else if (isWorkflowCompleted) {
                                message.info('工作流已完成，如需重新整合请先重置工作流');
                              }
                            }}
                          >
                            {characterIntegrating ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                  <PartitionOutlined style={{ 
                                    fontSize: '16px', 
                                    color: '#1890ff',
                                    marginRight: '8px'
                                  }} />
                                  <LoadingDots size="small" color="#1890ff" />
                                  <div style={{ 
                                    fontSize: '12px', 
                                    color: '#1890ff',
                                    fontWeight: 'bold'
                                  }}>
                                    角色图谱整合中
                                  </div>
                                </div>
                                {/* 计时器 */}
                                <div style={{
                                  position: 'absolute',
                                  bottom: '4px',
                                  right: '8px',
                                  fontSize: '10px',
                                  color: '#1890ff',
                                  fontFamily: 'monospace'
                                }}>
                                  {formatTimer(characterIntegrationTimer)}
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                  <PartitionOutlined style={{ 
                                    fontSize: '16px', 
                                    color: characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') ? '#52c41a' : 
                                           characterIntegrationResult && characterIntegrationResult.startsWith('整合失败') ? '#ff4d4f' :
                                           characterDraftContent ? '#fa8c16' : '#8c8c8c',
                                    marginRight: '8px'
                                  }} />
                                  <div style={{ 
                                    fontSize: '12px', 
                                    color: characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') ? '#52c41a' : 
                                           characterIntegrationResult && characterIntegrationResult.startsWith('整合失败') ? '#ff4d4f' :
                                           characterDraftContent ? '#fa8c16' : '#595959',
                                    fontWeight: characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') ? 'bold' : 'normal'
                                  }}>
                                    角色图谱整合
                                  </div>
                                </div>
                                <div style={{ 
                                  fontSize: '10px', 
                                  color: characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') ? '#52c41a' : 
                                         characterIntegrationResult && characterIntegrationResult.startsWith('整合失败') ? '#ff4d4f' :
                                         characterDraftContent ? '#fa8c16' : '#8c8c8c',
                                  marginLeft: '24px'
                                }}>
                                  {characterIntegrationResult && characterIntegrationResult.startsWith('整合失败') ? '失败，点击重试' :
                                   characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') ? '✓ 已完成' : 
                                   characterDraftContent ? '待整合' : '待选择'}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 连接箭头 */}
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            color: '#bfbfbf',
                            fontSize: '30px'
                          }}>
                            ··· →
                          </div>

                          {/* 第三步：查看和保存 */}
                          <div 
                            style={{
                              width: '200px',
                              height: '70px',
                              border: '2px solid #d9d9d9',
                              borderRadius: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              backgroundColor: globalCharacterContent && !isCharacterWorkflowReset ? '#f6ffed' : 
                                             characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') && !globalCharacterContent ? '#fff7e6' : '#fafafa',
                              borderColor: globalCharacterContent && !isCharacterWorkflowReset ? '#52c41a' : 
                                          characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') && !globalCharacterContent ? '#fa8c16' : '#d9d9d9',
                              transition: 'all 0.3s ease',
                              opacity: 1,
                              padding: '8px',
                              ...(isCharacterWorkflowReset ? {
                                backgroundColor: '#f0f0f0',
                                borderColor: '#d9d9d9',
                                opacity: 0.7
                              } : {})
                            }}
                            onClick={() => {
                              if (characterIntegrationFailed) {
                                // 如果整合失败，打开手动输入模态框
                                handleOpenManualInput();
                              } else if (characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败')) {
                                setPreviewCharacterContent(characterIntegrationResult);
                                setCharacterResultEditContent(characterIntegrationResult);
                                setIsCharacterResultEditing(true);
                                setIsCharacterResultPreviewVisible(true);
                              } else if (globalCharacterContent) {
                                setPreviewCharacterContent(globalCharacterContent);
                                setCharacterResultEditContent(globalCharacterContent);
                                setIsCharacterResultEditing(true);
                                setIsCharacterResultPreviewVisible(true);
                              } else {
                                // 无任何内容时，打开手动输入模态框允许用户手动录入
                                handleOpenManualInput();
                              }
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                <EyeOutlined style={{ 
                                  fontSize: '16px', 
                                  color: globalCharacterContent && !isCharacterWorkflowReset ? '#52c41a' : 
                                         characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') && !globalCharacterContent ? '#fa8c16' : '#8c8c8c',
                                  marginRight: '8px'
                                }} />
                                <div style={{ 
                                  fontSize: '12px', 
                                  color: globalCharacterContent && !isCharacterWorkflowReset ? '#52c41a' : 
                                         characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') && !globalCharacterContent ? '#fa8c16' : '#595959',
                                  fontWeight: globalCharacterContent && !isCharacterWorkflowReset ? 'bold' : 'normal'
                                }}>
                                  查看结果
                                </div>
                              </div>
                              {globalCharacterContent && !isCharacterWorkflowReset && (
                                <div style={{ 
                                  fontSize: '10px', 
                                  color: '#52c41a',
                                  marginLeft: '24px'
                                }}>
                                  ✓ 已完成
                                </div>
                              )}
                              {isCharacterWorkflowReset && (
                                <div style={{ 
                                  fontSize: '10px', 
                                  color: '#8c8c8c',
                                  marginLeft: '24px'
                                }}>
                                  已重置
                                </div>
                              )}
                              {characterIntegrationResult && !characterIntegrationResult.startsWith('整合失败') && !globalCharacterContent && !isCharacterWorkflowReset && (
                                <div style={{ 
                                  fontSize: '10px', 
                                  color: '#1890ff',
                                  marginLeft: '24px'
                                }}>
                                  可操作
                                </div>
                              )}
                              {!characterIntegrationResult && !globalCharacterContent && !isCharacterWorkflowReset && (
                                <div style={{ 
                                  fontSize: '10px', 
                                  color: '#1890ff',
                                  marginLeft: '24px'
                                }}>
                                  点击手动录入
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 重置按钮 - 只有在工作流完成时才显示 */}
                          {isWorkflowCompleted && canEdit && (
                            <Tooltip title="重置工作流">
                              <Button
                                type="primary"
                                danger
                                icon={<ReloadOutlined />}
                                shape="circle"
                                size="small"
                                onClick={handleResetWorkflow}
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  marginLeft: '36px'
                                }}
                              />
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </Card>

                    {/* 模型配置 */}
                    <Card 
                      title="模型配置" 
                      bordered={false}
                      style={{ marginTop: 16, minHeight: '300px' }}
                    >
                      <Row gutter={16}>
                        <Col xs={24} md={8}>
                          <Form.Item label="模型" name="character_integration_model" style={{ marginBottom: '45px' }}>
                            <Select disabled={!canEdit}>
                              {(modelConfig.availableModels || []).map(m => (
                                <Option key={m} value={m}>{m}</Option>
                              ))}
                            </Select>
                          </Form.Item>
                          <Row align="middle" gutter={8}>
                            <Col flex="auto">
                              <Form.Item
                                label="Temperature"
                                name="character_integration_temperature"
                                initialValue={1}
                              >
                                <Slider
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  disabled={!canEdit}
                                />
                              </Form.Item>
                            </Col>
                            <Col>
                              <Form.Item
                                name="character_integration_temperature"
                                initialValue={1}
                                style={{ marginTop: 30 }}
                              >
                                <InputNumber
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  disabled={!canEdit}  
                                  style={{ width: 60, marginLeft: 8 }}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                        </Col>
                        <Col xs={24} md={16}>
                          <Form.Item label="图谱整合Prompt" name="characterIntegrationPrompt">
                             <EditableTextArea 
                               value={form.getFieldValue('characterIntegrationPrompt')}
                               onChange={value => form.setFieldsValue({ characterIntegrationPrompt: value })}
                               onSave={canEdit ? handleSaveCharacterIntegrationPrompt : undefined}
                               onLoadDefault={canEdit ? handleLoadDefaultCharacterIntegrationPrompt : undefined}
                               placeholder={usingSystemDefaults.characterIntegration ? 
                                 "当前使用系统默认Prompt（点击放大编辑按钮进行编辑）" : 
                                 "例如：请将以下分集角色图谱整合成完整的角色关系图谱..."}
                               title="编辑角色知识图谱整合Prompt"
                               rows={6}
                               disabled={!canEdit}
                             />
                           </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                    </div>
                  </Col>
               </Row>
            </Form>
          </Tabs.TabPane>
          
          <Tabs.TabPane tab="单元剧本" key="3">
            <Form form={form} layout="vertical" onFinish={handleIntegrate}>
               <Row gutter={24}>
                  <Col xs={24}>
                    {/* 单元剧本工作台 - 三步工作流 */}
                    <Card 
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>单元剧本工作台</span>
                        </div>
                      } 
                      bordered={false}
                      style={{ marginBottom: 24 }}
                    >
                      {scriptUnits.length === 0 ? (
                        <div style={{ 
                          textAlign: 'center', 
                          padding: '60px 20px',
                          color: '#999'
                        }}>
                          <div style={{ fontSize: '16px', marginBottom: '12px' }}>暂无单元</div>
                          <div style={{ fontSize: '14px', marginBottom: '20px' }}>
                            点击下方按钮开始创建第一个剧本单元
                          </div>
                          <Button 
                            type="primary" 
                            onClick={createUnit}
                            disabled={!canEdit}
                          >
                            创建第一个单元
                          </Button>
                        </div>
                      ) : (
                        <div>
                          {/* 单元管理标签页（带滑动按钮） */}

                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'stretch',
                            marginBottom: 24,
                            gap: '8px'
                          }}>
                            {/* 左滑动按钮 */}
                            {scriptUnits.length > 0 && (
                              <div 
                                style={{
                                  border: '1px solid #d9d9d9',
                                  borderRadius: '6px',
                                  width: '48px',
                                  height: '40px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  backgroundColor: canScrollLeft ? '#fff' : '#f5f5f5',
                                  cursor: canScrollLeft ? 'pointer' : 'not-allowed',
                                  transition: 'all 0.2s',
                                  borderColor: canScrollLeft ? '#d9d9d9' : '#e8e8e8',
                                  opacity: canScrollLeft ? 1 : 0.5
                                }}
                                onMouseEnter={(e) => {
                                  if (canScrollLeft) {
                                    e.target.style.backgroundColor = '#f0f8ff';
                                    e.target.style.borderColor = '#1890ff';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.backgroundColor = canScrollLeft ? '#fff' : '#f5f5f5';
                                  e.target.style.borderColor = canScrollLeft ? '#d9d9d9' : '#e8e8e8';
                                }}
                                onClick={canScrollLeft ? scrollTabsLeft : undefined}
                              >
                                <LeftOutlined 
                                  style={{ 
                                    fontSize: '14px',
                                    color: canScrollLeft ? '#1890ff' : '#bfbfbf'
                                  }} 
                                />
                              </div>
                            )}
                            
                            {/* 标签页容器 */}
                            <div 
                              ref={tabsRef}
                              style={{ 
                                flex: 1, 
                                overflow: 'hidden',
                                border: '1px solid #d9d9d9',
                                borderRadius: '6px',
                                backgroundColor: '#fff',
                                minHeight: '40px'
                              }}
                            >
                              <Tabs 
                                type="editable-card"
                                activeKey={activeUnitId?.toString()}
                                onChange={(key) => {
                                  setActiveUnitId(parseInt(key));
                                  // 切换标签页后检测滚动状态
                                  setTimeout(checkTabsScrollStatus, 50);
                                  setTimeout(checkTabsScrollStatus, 200);
                                }}
                                onEdit={(targetKey, action) => {
                                  if (action === 'add') {
                                    createUnit();
                                  } else if (action === 'remove') {
                                    deleteUnit(parseInt(targetKey));
                                  }
                                  // 编辑操作后检测滚动状态
                                  setTimeout(checkTabsScrollStatus, 100);
                                  setTimeout(checkTabsScrollStatus, 300);
                                }}
                                hideAdd={!canEdit}
                                onTabClick={() => {
                                  // 点击标签页后检测滚动状态
                                  setTimeout(checkTabsScrollStatus, 50);
                                  setTimeout(checkTabsScrollStatus, 200);
                                }}
                                style={{
                                  height: '40px'
                                }}
                                className="simple-tabs"
                              >
                                {scriptUnits.map(unit => (
                                  <Tabs.TabPane 
                                    tab={getUnitDisplayName(unit)} 
                                    key={unit.id.toString()}
                                    closable={canEdit}
                                  />
                                ))}
                              </Tabs>
                            </div>
                            
                            {/* 右滑动按钮 */}
                            {scriptUnits.length > 0 && (
                              <div 
                                style={{
                                  border: '1px solid #d9d9d9',
                                  borderRadius: '6px',
                                  width: '48px',
                                  height: '40px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  backgroundColor: canScrollRight ? '#fff' : '#f5f5f5',
                                  cursor: canScrollRight ? 'pointer' : 'not-allowed',
                                  transition: 'all 0.2s',
                                  borderColor: canScrollRight ? '#d9d9d9' : '#e8e8e8',
                                  opacity: canScrollRight ? 1 : 0.5
                                }}
                                onMouseEnter={(e) => {
                                  if (canScrollRight) {
                                    e.target.style.backgroundColor = '#f0f8ff';
                                    e.target.style.borderColor = '#1890ff';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.backgroundColor = canScrollRight ? '#fff' : '#f5f5f5';
                                  e.target.style.borderColor = canScrollRight ? '#d9d9d9' : '#e8e8e8';
                                }}
                                onClick={canScrollRight ? scrollTabsRight : undefined}
                              >
                                <RightOutlined 
                                  style={{ 
                                    fontSize: '14px',
                                    color: canScrollRight ? '#1890ff' : '#bfbfbf'
                                  }} 
                                />
                              </div>
                            )}
                          </div>

                          {/* 三步工作流内容 */}
                          {activeUnitId && (() => {
                            const activeUnit = scriptUnits.find(u => u.id === activeUnitId);
                            if (!activeUnit) return null;

                            return (
                              <div>
                                {/* 三步工作流程卡片 */}
                                <div style={{ 
                                  display: 'flex', 
                                  gap: '24px',
                                  justifyContent: 'center',
                                  marginBottom: 32,
                                  alignItems: 'center'
                                }}>
                                  {/* 步骤1：选择分集素材 - 修复版 */}
                                  <Card
                                    hoverable
                                    style={{ 
                                      width: '220px',
                                      textAlign: 'center',
                                      borderColor: getUnitStepStatus(activeUnit, 1) === 'finish' ? '#52c41a' : 
                                                   getUnitStepStatus(activeUnit, 1) === 'process' ? '#1890ff' : '#d9d9d9'
                                    }}
                                  >
                                    <div 
                                      style={{ 
                                        padding: '16px 12px',
                                        cursor: canExecuteStep(activeUnit, 1) ? 'pointer' : 'default',
                                        opacity: canExecuteStep(activeUnit, 1) || getUnitStepStatus(activeUnit, 1) === 'finish' ? 1 : 0.7
                                      }}
                                      onClick={() => canExecuteStep(activeUnit, 1) && handleStep1()}
                                    >
                                      <div style={{ 
                                        fontSize: '32px', 
                                        marginBottom: '12px',
                                        color: getUnitStepStatus(activeUnit, 1) === 'finish' ? '#52c41a' : 
                                               getUnitStepStatus(activeUnit, 1) === 'process' ? '#1890ff' : '#d9d9d9'
                                      }}>
                                        {getUnitStepStatus(activeUnit, 1) === 'finish' ? (
                                          <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            backgroundColor: '#52c41a',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            margin: '0 auto',
                                            boxShadow: '0 2px 8px rgba(82, 196, 26, 0.3)'
                                          }}>
                                            <span style={{ color: 'white', fontSize: '18px', fontWeight: 'bold' }}>✓</span>
                                          </div>
                                        ) : getUnitStepStatus(activeUnit, 1) === 'process' ? '📝' : '⏳'}
                                      </div>
                                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                        步骤1
                                      </div>
                                      <div style={{ fontSize: '14px', color: '#666' }}>
                                        选择分集素材
                                      </div>
                                      {Boolean(activeUnit.step1_completed) && (
                                        <div style={{ fontSize: '12px', color: '#52c41a', marginTop: '8px' }}>
                                          已选择素材
                                        </div>
                                      )}
                                    </div>
                                                                        {Boolean(activeUnit.step1_completed) && (
                                      <div style={{ paddingBottom: '12px' }}>
                                        <Space size="small" direction="horizontal">
                                          <Button 
                                            size="small" 
                                            icon={<EyeOutlined />}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleStep1CardPreview();
                                            }}
                                            style={{ fontSize: '12px' }}
                                          >
                                            预览
                                          </Button>
                                          {canEdit && canReselectStep1(activeUnit) && (
                                            <Tooltip title="重新选择">
                                              <Button 
                                                size="small" 
                                                icon={<ReloadOutlined />}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleStep1Reselect();
                                                }}
                                                style={{ fontSize: '12px' }}
                                              />
                                            </Tooltip>
                                          )}
                                        </Space>
                                      </div>
                                    )}
                                  </Card>

                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '24px', color: '#d9d9d9', margin: '0 8px' }}>
                                    →
                                  </div>

                                  {/* 步骤2：分集内容整合 - 修复版 */}
                                  <Card
                                    hoverable
                                    style={{ 
                                      width: '220px',
                                      textAlign: 'center',
                                      borderColor: getUnitStepStatus(activeUnit, 2) === 'finish' ? '#52c41a' : 
                                                   getUnitStepStatus(activeUnit, 2) === 'process' ? '#1890ff' : '#d9d9d9'
                                    }}
                                  >
                                    <div 
                                      style={{ 
                                        padding: '16px 12px',
                                        cursor: canExecuteStep(activeUnit, 2) ? 'pointer' : 'default',
                                        opacity: canExecuteStep(activeUnit, 2) || getUnitStepStatus(activeUnit, 2) === 'finish' ? 1 : 0.7
                                      }}
                                      onClick={() => canExecuteStep(activeUnit, 2) && handleStep2()}
                                    >
                                      <div style={{ 
                                        fontSize: '32px', 
                                        marginBottom: '12px',
                                        color: getUnitStepStatus(activeUnit, 2) === 'finish' ? '#52c41a' : 
                                               getUnitStepStatus(activeUnit, 2) === 'process' ? '#1890ff' : '#d9d9d9'
                                      }}>
                                        {getUnitStepStatus(activeUnit, 2) === 'finish' ? (
                                          <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            backgroundColor: '#52c41a',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            margin: '0 auto',
                                            boxShadow: '0 2px 8px rgba(82, 196, 26, 0.3)'
                                          }}>
                                            <span style={{ color: 'white', fontSize: '18px', fontWeight: 'bold' }}>✓</span>
                                          </div>
                                        ) : getUnitStepStatus(activeUnit, 2) === 'process' ? '🔄' : '⏳'}
                                      </div>
                                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                        步骤2
                                      </div>
                                      <div style={{ fontSize: '14px', color: '#666' }}>
                                        分集内容整合
                                      </div>
                                      {Boolean(unitWorkflowProcessing[activeUnit.id]?.step2) && (
                                        <div style={{ fontSize: '12px', color: '#1890ff', marginTop: '8px' }}>
                                          整合中...
                                        </div>
                                      )}
                                      {Boolean(activeUnit.step2_completed) && !unitWorkflowProcessing[activeUnit.id]?.step2 && (
                                        <div style={{ fontSize: '12px', color: '#52c41a', marginTop: '8px' }}>
                                          内容整合完成
                                        </div>
                                      )}
                                    </div>
                                    {Boolean(activeUnit.step2_completed) && (
                                      <div style={{ paddingBottom: '12px' }}>
                                        <Button 
                                          size="small" 
                                          icon={<EyeOutlined />}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setStep2PreviewContent(activeUnit.content_integration_result || '');
                                            setStep2EditContent(activeUnit.content_integration_result || '');
                                            setIsStep2ModalVisible(true);
                                          }}
                                          style={{ fontSize: '12px' }}
                                        >
                                          预览
                                        </Button>
                                      </div>
                                    )}
                                  </Card>

                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '24px', color: '#d9d9d9', margin: '0 8px' }}>
                                    →
                                  </div>

                                  {/* 步骤3：添加角色图谱 */}
                                  <Card
                                    hoverable
                                    style={{ 
                                      width: '220px',
                                      textAlign: 'center',
                                      borderColor: getUnitStepStatus(activeUnit, 3) === 'finish' ? '#52c41a' : 
                                                   getUnitStepStatus(activeUnit, 3) === 'process' ? '#1890ff' : '#d9d9d9'
                                    }}
                                  >
                                    <div 
                                      style={{ 
                                        padding: '16px 12px',
                                        cursor: canExecuteStep(activeUnit, 3) ? 'pointer' : 'default',
                                        opacity: canExecuteStep(activeUnit, 3) || getUnitStepStatus(activeUnit, 3) === 'finish' ? 1 : 0.7
                                      }}
                                      onClick={() => canExecuteStep(activeUnit, 3) && handleStep3()}
                                    >
                                      <div style={{ 
                                        fontSize: '32px', 
                                        marginBottom: '12px',
                                        color: getUnitStepStatus(activeUnit, 3) === 'finish' ? '#52c41a' : 
                                               getUnitStepStatus(activeUnit, 3) === 'process' ? '#1890ff' : '#d9d9d9'
                                      }}>
                                        {getUnitStepStatus(activeUnit, 3) === 'finish' ? (
                                          <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            backgroundColor: '#52c41a',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            margin: '0 auto',
                                            boxShadow: '0 2px 8px rgba(82, 196, 26, 0.3)'
                                          }}>
                                            <span style={{ color: 'white', fontSize: '18px', fontWeight: 'bold' }}>✓</span>
                                          </div>
                                        ) : getUnitStepStatus(activeUnit, 3) === 'process' ? '🎭' : '⏳'}
                                      </div>
                                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                        步骤3
                                      </div>
                                      <div style={{ fontSize: '14px', color: '#666' }}>
                                        添加角色图谱
                                      </div>
                                      {Boolean(unitWorkflowProcessing[activeUnit.id]?.step3) && (
                                        <div style={{ fontSize: '12px', color: '#1890ff', marginTop: '8px' }}>
                                          添加中...
                                        </div>
                                      )}
                                      {Boolean(activeUnit.step3_character_graph_completed) && !unitWorkflowProcessing[activeUnit.id]?.step3 && (
                                        <div style={{ fontSize: '12px', color: '#52c41a', marginTop: '8px' }}>
                                          角色图谱已添加
                                        </div>
                                      )}
                                    </div>
                                                                        {/* 预览和重新选择按钮 */}
                                    {Boolean(activeUnit.step3_character_graph_completed) && (
                                      <div style={{ paddingBottom: '12px' }}>
                                        <Space size="small" direction="horizontal">
                                          <Button 
                                            size="small" 
                                            icon={<EyeOutlined />}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleStep3Preview();
                                            }}
                                            style={{ fontSize: '12px' }}
                                          >
                                            预览
                                          </Button>
                                          {canEdit && canReselectStep3(activeUnit) && (
                                            <Tooltip title="重新选择">
                                              <Button 
                                                size="small" 
                                                icon={<ReloadOutlined />}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleStep3Reselect();
                                                }}
                                                style={{ fontSize: '12px' }}
                                              />
                                            </Tooltip>
                                          )}
                                        </Space>
                                      </div>
                                    )}
                                  </Card>

                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '24px', color: '#d9d9d9', margin: '0 8px' }}>
                                    →
                                  </div>

                                  {/* 步骤4：分集角色整合 */}
                                  <Card
                                    hoverable
                                    style={{ 
                                      width: '220px',
                                      textAlign: 'center',
                                      borderColor: getUnitStepStatus(activeUnit, 4) === 'finish' ? '#52c41a' : 
                                                   getUnitStepStatus(activeUnit, 4) === 'process' ? '#1890ff' : '#d9d9d9'
                                    }}
                                  >
                                    <div 
                                      style={{ 
                                        padding: '16px 12px',
                                        cursor: canExecuteStep(activeUnit, 4) ? 'pointer' : 'default',
                                        opacity: canExecuteStep(activeUnit, 4) || getUnitStepStatus(activeUnit, 4) === 'finish' ? 1 : 0.7
                                      }}
                                      onClick={() => canExecuteStep(activeUnit, 4) && handleStep4()}
                                    >
                                      <div style={{ 
                                        fontSize: '32px', 
                                        marginBottom: '12px',
                                        color: getUnitStepStatus(activeUnit, 4) === 'finish' ? '#52c41a' : 
                                               getUnitStepStatus(activeUnit, 4) === 'process' ? '#1890ff' : '#d9d9d9'
                                      }}>
                                        {getUnitStepStatus(activeUnit, 4) === 'finish' ? (
                                          <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            backgroundColor: '#52c41a',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            margin: '0 auto',
                                            boxShadow: '0 2px 8px rgba(82, 196, 26, 0.3)'
                                          }}>
                                            <span style={{ color: 'white', fontSize: '18px', fontWeight: 'bold' }}>✓</span>
                                          </div>
                                        ) : getUnitStepStatus(activeUnit, 4) === 'process' ? '👥' : '⏳'}
                                      </div>
                                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                        步骤4
                                      </div>
                                      <div style={{ fontSize: '14px', color: '#666' }}>
                                        分集角色整合
                                      </div>
                                      {Boolean(unitWorkflowProcessing[activeUnit.id]?.step4) && (
                                        <div style={{ fontSize: '12px', color: '#1890ff', marginTop: '8px' }}>
                                          角色整合中...
                                        </div>
                                      )}
                                      {Boolean(activeUnit.step4_completed) && !unitWorkflowProcessing[activeUnit.id]?.step4 && (
                                        <div style={{ fontSize: '12px', color: '#52c41a', marginTop: '8px' }}>
                                          角色整合完成
                                        </div>
                                      )}
                                    </div>
                                    {/* 预览按钮 */}
                                    {Boolean(activeUnit.step4_completed) && (
                                      <div style={{ paddingBottom: '12px' }}>
                                        <Button 
                                          size="small" 
                                          icon={<EyeOutlined />}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setStep4PreviewContent(activeUnit.character_integration_result || '');
                                            setStep4EditContent(activeUnit.character_integration_result || '');
                                            setIsStep4ModalVisible(true);
                                          }}
                                          style={{ fontSize: '12px' }}
                                        >
                                          预览
                                        </Button>
                                      </div>
                                    )}
                                  </Card>
                                  
                                  {/* 重置按钮 - 步骤4后面 */}
                                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
                                    <Tooltip title="重置工作流">
                                      <Button
                                        type="primary"
                                        danger
                                        icon={<ReloadOutlined />}
                                        shape="circle"
                                        size="small"
                                        onClick={() => handleResetUnitWorkflow(activeUnitId)}
                                        disabled={!canEdit}
                                        style={{
                                          width: '32px',
                                          height: '32px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          marginLeft: '40px'
                                        }}
                                      />
                                    </Tooltip>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </Card>

                    {/* 模型配置区域 */}
                    <Row gutter={24} style={{ marginTop: 24 }}>
                      <Col xs={24} md={12}>
                        {/* 内容整合模型配置 */}
                        <Card 
                          title="内容整合配置" 
                          bordered={false}
                          style={{ height: '100%', minHeight: '320px' }}
                        >
                          <Form.Item label="内容整合模型" name="integration_model" style={{ marginBottom: '20px' }}>
                            <Select disabled={!canEdit}>
                              {(modelConfig.availableModels || []).map(m => (
                                <Option key={m} value={m}>{m}</Option>
                              ))}
                            </Select>
                          </Form.Item>
                          <Row align="middle" gutter={8} style={{ marginBottom: '20px' }}>
                            <Col flex="auto">
                              <Form.Item
                                label="Temperature"
                                name="integration_temperature"
                                initialValue={1}
                              >
                                <Slider
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  disabled={!canEdit}
                                />
                              </Form.Item>
                            </Col>
                            <Col>
                              <Form.Item
                                name="integration_temperature"
                                initialValue={1}
                                style={{ marginTop: 30 }}
                              >
                                <InputNumber
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  disabled={!canEdit}  
                                  style={{ width: 60, marginLeft: 8 }}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                           <Form.Item label="内容整合Prompt" name="integrationPrompt">
                             <EditableTextArea 
                               value={form.getFieldValue('integrationPrompt')}
                               onChange={value => form.setFieldsValue({ integrationPrompt: value })}
                               onSave={canEdit ? handleSaveIntegrationPrompt : undefined}
                               onLoadDefault={canEdit ? handleLoadDefaultIntegrationPrompt : undefined}
                               placeholder={usingSystemDefaults.integration ? 
                                 "当前使用系统默认Prompt（点击放大编辑按钮进行编辑）" : 
                                 "例如：请将以下内容整合成一个连贯的剧本..."}
                               title="编辑剧本整合Prompt"
                               rows={4}
                               disabled={!canEdit}
                             />
                           </Form.Item>
                        </Card>
                      </Col>
                      
                      <Col xs={24} md={12}>
                        {/* 角色整合模型配置 */}
                        <Card 
                          title="角色整合配置" 
                          bordered={false}
                          style={{ height: '100%', minHeight: '320px' }}
                        >
                          <Form.Item label="角色整合模型" name="character_model" style={{ marginBottom: '20px' }}>
                            <Select disabled={!canEdit}>
                              {(modelConfig.availableModels || []).map(m => (
                                <Option key={m} value={m}>{m}</Option>
                              ))}
                            </Select>
                          </Form.Item>
                          <Row align="middle" gutter={8} style={{ marginBottom: '20px' }}>
                            <Col flex="auto">
                              <Form.Item
                                label="Temperature"
                                name="character_temperature"
                                initialValue={1}
                              >
                                <Slider
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  disabled={!canEdit}
                                />
                              </Form.Item>
                            </Col>
                            <Col>
                              <Form.Item
                                name="character_temperature"
                                initialValue={1}
                                style={{ marginTop: 30 }}
                              >
                                <InputNumber
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  disabled={!canEdit}  
                                  style={{ width: 60, marginLeft: 8 }}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                           <Form.Item label="角色整合Prompt" name="characterPrompt">
                             <EditableTextArea 
                               value={form.getFieldValue('characterPrompt')}
                               onChange={value => form.setFieldsValue({ characterPrompt: value })}
                               onSave={canEdit ? handleSaveCharacterPrompt : undefined}
                               onLoadDefault={canEdit ? handleLoadDefaultCharacterPrompt : undefined}
                               placeholder={usingSystemDefaults.character ? 
                                 "当前使用系统默认Prompt（点击放大编辑按钮进行编辑）" : 
                                 "例如：请对以下素材进行角色整合处理..."}
                               title="编辑角色整合Prompt"
                               rows={4}
                               disabled={!canEdit}
                             />
                           </Form.Item>
                        </Card>
                      </Col>
                    </Row>
                  </Col>
               </Row>
            </Form>
          </Tabs.TabPane>
          
          <Tabs.TabPane tab="完整剧本" key="4">
            <Row gutter={[16, 16]}>
              <Col span={24}>
                <Card title="完整剧本工作台" bordered={false}>
                  {/* 步骤导航 */}
                  <div style={{ marginBottom: 24 }}>
                    <Steps 
                      current={fullScriptCurrentStep - 1} 
                      size="small"
                      onChange={(current) => {
                        // 只允许跳转到已完成的步骤
                        if (fullScript) {
                          const targetStep = current + 1;
                          if (targetStep === 1 || 
                              (targetStep === 2 && fullScript.step_1_completed) ||
                              (targetStep === 3 && fullScript.step_2_completed)) {
                            setFullScriptCurrentStep(targetStep);
                          }
                        }
                      }}
                    >
                      <Steps.Step 
                        title="单元剧本拼接" 
                        description="选择单元剧本进行拼接"
                        status={(() => {
                          if (!fullScript) return 'process';
                          if (fullScript.step_1_completed) return 'finish';
                          if (fullScriptCurrentStep === 1) return 'process';
                          return 'wait';
                        })()}
                      />
                      <Steps.Step 
                        title="全剧本审核" 
                        description="编辑和审核完整剧本"
                        status={(() => {
                          if (!fullScript || !fullScript.step_1_completed) return 'wait';
                          if (fullScript.step_2_completed) return 'finish';
                          if (fullScriptCurrentStep === 2) return 'process';
                          return 'wait';
                        })()}
                      />
                      <Steps.Step 
                        title="知识库存档" 
                        description="将剧本存档到知识库"
                        status={(() => {
                          if (!fullScript || !fullScript.step_2_completed) return 'wait';
                          if (fullScript.step_3_completed) return 'finish';
                          if (fullScriptCurrentStep === 3) return 'process';
                          return 'wait';
                        })()}
                      />
                    </Steps>
                  </div>

                  {/* 步骤内容区域 */}
                  {/* 直接根据当前步骤显示内容，无需创建工作流按钮 */}
                  <>
                      {fullScriptCurrentStep === 1 && (
                        <div>
                          <div style={{ marginBottom: 16 }}>
                            <Text strong>步骤 1：单元剧本拼接</Text>
                            <div style={{ marginTop: 8, color: '#666' }}>
                              选择要拼接的单元剧本，系统将按单元顺序自动拼接成完整剧本。
                            </div>
                          </div>
                          
                          <Row gutter={16}>
                            <Col span={12}>
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '14px', fontWeight: 500 }}>可选择的单元剧本</span>
                                  {scriptUnits.filter(unit => {
                                    const hasCharacterIntegration = !!unit.character_integration_result;
                                    const hasOldIntegration = !!unit.integration_result;
                                    return hasCharacterIntegration || hasOldIntegration;
                                  }).length > 0 && (
                                    <Button 
                                      size="small"
                                      onClick={handleFullScriptSelectAll}
                                      disabled={!canEdit}
                                    >
                                      {(() => {
                                        const availableUnits = scriptUnits.filter(unit => {
                                          const hasCharacterIntegration = !!unit.character_integration_result;
                                          const hasOldIntegration = !!unit.integration_result;
                                          return hasCharacterIntegration || hasOldIntegration;
                                        });
                                        const availableUnitIds = availableUnits.map(unit => unit.id);
                                        const allSelected = availableUnitIds.length > 0 && availableUnitIds.every(id => fullScriptSelectedUnitIds.includes(id));
                                        return allSelected ? '取消全选' : '全选';
                                      })()}
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <Card 
                                size="small"
                                style={{ height: '420px' }}
                                bodyStyle={{ 
                                  height: '350px',
                                  padding: '16px',
                                  display: 'flex',
                                  flexDirection: 'column'
                                }}
                              >
                                {scriptUnits.length === 0 ? (
                                  <div style={{ 
                                    textAlign: 'center', 
                                    padding: '60px 20px', 
                                    color: '#999',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    height: '100%'
                                  }}>
                                    暂无可用的单元剧本，请先在"剧本生成"页面创建单元剧本
                                  </div>
                                ) : (
                                  <div style={{ 
                                    flex: 1,
                                    overflowY: 'auto',
                                    paddingRight: '4px'
                                  }}>
                                    {scriptUnits
                                      .filter(unit => {
                                        // 显示有任何完成内容的单元
                                        return unit.character_integration_result || unit.content_integration_result || unit.integration_result;
                                      })
                                      .map(unit => {
                                        // 确定内容类型和完成状态
                                        const hasCharacterIntegration = !!unit.character_integration_result;
                                        const hasContentIntegration = !!unit.content_integration_result;
                                        const hasOldIntegration = !!unit.integration_result;
                                        
                                        // 判断是否可选择：只有完成角色整合的单元才可选
                                        const isSelectable = hasCharacterIntegration || hasOldIntegration;
                                        
                                        let statusText = '';
                                        let statusColor = '#666';
                                        
                                        if (hasCharacterIntegration) {
                                          statusText = '已完成角色整合';
                                          statusColor = '#52c41a';
                                        } else if (hasContentIntegration) {
                                          statusText = '已完成内容整合，需要角色整合才可选择';
                                          statusColor = '#999'; // 灰色
                                        } else if (hasOldIntegration) {
                                          statusText = '已完成剧本整合';
                                          statusColor = '#1890ff';
                                        }
                                        
                                        return (
                                          <div 
                                            key={unit.id} 
                                            style={{ 
                                              marginBottom: 8,
                                              opacity: isSelectable ? 1 : 0.6 // 不可选择的单元降低透明度
                                            }}
                                          >
                                            <Checkbox
                                              checked={fullScriptSelectedUnitIds.includes(unit.id)}
                                              onChange={(e) => {
                                                if (!isSelectable) return; // 不可选择的单元阻止状态变更
                                                const newSelectedIds = e.target.checked
                                                  ? [...fullScriptSelectedUnitIds, unit.id]
                                                  : fullScriptSelectedUnitIds.filter(id => id !== unit.id);
                                                handleFullScriptUnitSelection(newSelectedIds);
                                              }}
                                              disabled={!canEdit || !isSelectable} // 未完成角色整合的单元不可选
                                            >
                                              <div>
                                                <Text 
                                                  strong 
                                                  style={{ 
                                                    color: isSelectable ? 'inherit' : '#999' // 不可选择的单元文字颜色变灰
                                                  }}
                                                >
                                                  {getUnitDisplayName(unit)}
                                                  {hasCharacterIntegration && (
                                                    <Tag size="small" color="green" style={{ marginLeft: 8 }}>
                                                      可用
                                                    </Tag>
                                                  )}
                                                  {hasOldIntegration && !hasCharacterIntegration && (
                                                    <Tag size="small" color="blue" style={{ marginLeft: 8 }}>
                                                      可用
                                                    </Tag>
                                                  )}
                                                  {!isSelectable && (
                                                    <Tag size="small" color="default" style={{ marginLeft: 8 }}>
                                                      不可选
                                                    </Tag>
                                                  )}
                                                </Text>
                                                <div style={{ fontSize: '12px', color: statusColor }}>
                                                  {statusText}
                                                </div>

                                              </div>
                                            </Checkbox>
                                          </div>
                                        );
                                      })
                                    }
                                  </div>
                                )}
                              </Card>
                            </Col>
                            
                            <Col span={12}>
                              <Card 
                                title="拼接预览" 
                                size="small"
                                style={{ height: '420px' }}
                                bodyStyle={{ 
                                  height: '350px',
                                  padding: '16px',
                                  display: 'flex',
                                  flexDirection: 'column'
                                }}
                              >
                                {fullScriptSelectedUnitIds.length === 0 ? (
                                  <div style={{ 
                                    textAlign: 'center', 
                                    padding: '60px 20px', 
                                    color: '#999',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    height: '100%'
                                  }}>
                                    请先选择要拼接的单元剧本
                                  </div>
                                ) : (
                                  <div style={{ 
                                    flex: 1,
                                    overflowY: 'auto',
                                    paddingRight: '4px'
                                  }}>
                                    <div style={{ marginBottom: 8 }}>
                                      <Text type="secondary">将按以下顺序拼接：</Text>
                                    </div>
                                    {scriptUnits
                                      .filter(unit => fullScriptSelectedUnitIds.includes(unit.id))
                                      .sort((a, b) => a.unit_order - b.unit_order)
                                      .map((unit, index) => (
                                        <div key={unit.id} style={{ 
                                          marginTop: 8, 
                                          padding: '8px 12px', 
                                          backgroundColor: '#f5f5f5',
                                          borderRadius: '4px'
                                        }}>
                                          <Text>{index + 1}. {getUnitDisplayName(unit)}</Text>
                                        </div>
                                      ))
                                    }
                                  </div>
                                )}
                              </Card>
                            </Col>
                          </Row>
                          
                          <div style={{ marginTop: 16, textAlign: 'center' }}>
                            <Button 
                              type="primary" 
                              icon={fullScriptProcessing.step1 ? <LoadingDots size="small" color="#ffffff" /> : null}
                              onClick={handleFullScriptStep1}
                              disabled={!canEdit || fullScriptSelectedUnitIds.length === 0 || fullScriptProcessing.step1}
                            >
                              拼接剧本
                            </Button>
                          </div>
                        </div>
                      )}

                      {fullScriptCurrentStep === 2 && (
                        <div>
                          <div style={{ marginBottom: 16 }}>
                            <Text strong>步骤 2：全剧本审核</Text>
                            <div style={{ marginTop: 8, color: '#666' }}>
                              审核和编辑拼接后的完整剧本，确认无误后进入存档步骤
                            </div>
                          </div>
                          
                          <Row gutter={16}>
                            <Col span={24}>
                              <Card title="剧本内容审核" size="small">
                                <TextArea
                                  value={fullScriptEditMode ? (fullScriptReviewedContent ?? '') : ((fullScriptReviewedContent !== null && fullScriptReviewedContent !== undefined) ? fullScriptReviewedContent : fullScriptConcatenatedContent)}
                                  onChange={fullScriptEditMode ? (e) => setFullScriptReviewedContent(e.target.value) : undefined}
                                  placeholder="完整剧本内容将在此显示，您可以进行编辑和审核..."
                                  autoSize={{ minRows: 20, maxRows: 30 }}
                                  readOnly={!canEdit || !fullScriptEditMode}
                                  style={{ 
                                    marginBottom: 16,
                                    backgroundColor: '#fff',
                                    cursor: fullScriptEditMode ? 'text' : 'default'
                                  }}
                                />

                                {/* 剧本内容编辑和保存按钮 */}
                                <div style={{ 
                                  textAlign: 'center', 
                                  marginBottom: 16 
                                }}>
                                  <Space>
                                    {!fullScriptEditMode ? (
                                      <Button 
                                        type="default" 
                                        icon={<EditOutlined />}
                                        onClick={handleFullScriptStartEdit}
                                        disabled={!canEdit}
                                      >
                                        编辑内容
                                      </Button>
                                    ) : (
                                      <>
                                        <Button 
                                          type="primary" 
                                          icon={<SaveOutlined />}
                                          onClick={handleFullScriptSaveEdit}
                                          disabled={!canEdit}
                                        >
                                          保存
                                        </Button>
                                        <Button 
                                          type="default" 
                                          onClick={handleFullScriptCancelEdit}
                                          disabled={!canEdit}
                                        >
                                          取消
                                        </Button>
                                      </>
                                    )}
                                  </Space>
                                </div>

                                <Input.TextArea
                                  value={fullScriptReviewNotes}
                                  onChange={fullScriptNotesEditMode ? (e) => setFullScriptReviewNotes(e.target.value) : undefined}
                                  placeholder="审核备注（可选）"
                                  rows={3}
                                  readOnly={!canEdit || !fullScriptNotesEditMode}
                                  style={{ 
                                    marginBottom: 16,
                                    backgroundColor: '#fff',
                                    cursor: fullScriptNotesEditMode ? 'text' : 'default'
                                  }}
                                />

                                {/* 审核备注编辑和保存按钮 */}
                                <div style={{ 
                                  textAlign: 'center', 
                                  marginBottom: 16 
                                }}>
                                  <Space>
                                    {!fullScriptNotesEditMode ? (
                                      <Button 
                                        type="default" 
                                        icon={<EditOutlined />}
                                        onClick={handleFullScriptNotesStartEdit}
                                        disabled={!canEdit}
                                      >
                                        编辑备注
                                      </Button>
                                    ) : (
                                      <>
                                        <Button 
                                          type="primary" 
                                          icon={<SaveOutlined />}
                                          onClick={handleFullScriptNotesSaveEdit}
                                          disabled={!canEdit}
                                        >
                                          保存
                                        </Button>
                                        <Button 
                                          type="default" 
                                          onClick={handleFullScriptNotesCancelEdit}
                                          disabled={!canEdit}
                                        >
                                          取消
                                        </Button>
                                      </>
                                    )}
                                  </Space>
                                </div>
                                
                                <div style={{ textAlign: 'center' }}>
                                  <Button 
                                    type="primary" 
                                    icon={fullScriptProcessing.step2 ? <LoadingDots size="small" color="#ffffff" /> : null}
                                    onClick={handleFullScriptStep2}
                                    disabled={!canEdit || fullScriptProcessing.step2}
                                  >
                                    确认审核
                                  </Button>
                                </div>
                              </Card>
                            </Col>
                          </Row>
                        </div>
                      )}

                      {fullScriptCurrentStep === 3 && (
                        <div>
                          <div style={{ marginBottom: 16 }}>
                            <Text strong>步骤 3：知识库存档</Text>
                            <div style={{ marginTop: 8, color: '#666' }}>
                              将审核完成的完整剧本存档到项目知识库，生成Word文档供后续查阅和使用
                            </div>
                          </div>
                          
                          <Row gutter={16}>
                            {!(fullScript && fullScript.step_3_completed) ? (
                              <>
                                <Col span={12}>
                                  <Card 
                                    title="存档设置" 
                                    size="small"
                                    style={{ height: '480px' }}
                                    bodyStyle={{ 
                                      height: '410px',
                                      padding: '16px',
                                      display: 'flex',
                                      flexDirection: 'column'
                                    }}
                                  >
                                    <div style={{ 
                                      flex: 1,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      justifyContent: 'space-between'
                                    }}>
                                      <div style={{ marginBottom: 16 }}>
                                        <Text strong>文档名称</Text>
                                        <div style={{ marginTop: 4, color: '#666', fontSize: '12px' }}>
                                          将生成Word文档（.docx格式）
                                        </div>
                                      </div>
                                      
                                      <Input
                                        value={fullScriptArchiveTitle}
                                        onChange={(e) => setFullScriptArchiveTitle(e.target.value)}
                                        placeholder="请输入存档文档名称"
                                        suffix={<Text type="secondary">.docx</Text>}
                                        disabled={!canEdit}
                                        style={{ marginBottom: 16 }}
                                      />
                                      
                                      <div style={{ marginBottom: 16 }}>
                                        <Text strong>存档内容</Text>
                                        <div style={{ marginTop: 4, color: '#666', fontSize: '12px' }}>
                                          将包含完整的剧本内容、审核备注等信息
                                        </div>
                                      </div>
                                      
                                      <div style={{ 
                                        padding: '12px', 
                                        backgroundColor: '#f6ffed', 
                                        border: '1px solid #b7eb8f',
                                        borderRadius: '6px',
                                        marginBottom: 20
                                      }}>
                                        <div style={{ fontSize: '12px', color: '#52c41a' }}>
                                            ✅ 剧本内容：{((fullScriptReviewedContent ?? fullScriptConcatenatedContent) ?? '').length} 字符
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#52c41a' }}>
                                          ✅ 审核备注：{(fullScriptReviewNotes || '').length} 字符
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#52c41a' }}>
                                          ✅ 存档格式：Word文档 (.docx)
                                        </div>
                                      </div>
                                      
                                      <Button 
                                        type="primary" 
                                        size="large"
                                        block
                                        icon={fullScriptProcessing.step3 ? <LoadingDots size="medium" color="#ffffff" /> : <SaveOutlined />}
                                        onClick={handleFullScriptStep3}
                                        disabled={!canEdit || fullScriptProcessing.step3 || !fullScriptArchiveTitle.trim()}
                                      >
                                        存档到知识库
                                      </Button>
                                    </div>
                                  </Card>
                                </Col>
                                
                                <Col span={12}>
                                  <Card 
                                    title="内容预览" 
                                    size="small"
                                    style={{ height: '480px' }}
                                    bodyStyle={{ 
                                      height: '410px',
                                      padding: '16px',
                                      display: 'flex',
                                      flexDirection: 'column'
                                    }}
                                  >
                                    <div style={{ 
                                      flex: 1,
                                      overflowY: 'auto',
                                      paddingRight: '4px'
                                    }}>
                                      <div style={{ marginBottom: 16 }}>
                                        <Text strong>剧本内容预览</Text>
                                        <div style={{ 
                                          marginTop: 8, 
                                          padding: '12px', 
                                          backgroundColor: '#fafafa',
                                          borderRadius: '4px',
                                          maxHeight: '200px',
                                          overflowY: 'auto',
                                          fontSize: '12px',
                                          lineHeight: '1.5'
                                        }}>
                                          {(fullScriptReviewedContent ?? fullScriptConcatenatedContent) ?? '暂无内容'}
                                        </div>
                                      </div>
                                      
                                      {fullScriptReviewNotes && (
                                        <div style={{ marginBottom: 16 }}>
                                          <Text strong>审核备注</Text>
                                          <div style={{ 
                                            marginTop: 8, 
                                            padding: '12px', 
                                            backgroundColor: '#fafafa',
                                            borderRadius: '4px',
                                            fontSize: '12px',
                                            lineHeight: '1.5'
                                          }}>
                                            {fullScriptReviewNotes}
                                          </div>
                                        </div>
                                      )}
                                      
                                      <div style={{ 
                                        padding: '8px 12px', 
                                        backgroundColor: '#e6f7ff',
                                        border: '1px solid #91d5ff',
                                        borderRadius: '4px',
                                        fontSize: '12px'
                                      }}>
                                        📄 将生成专业格式的Word文档，包含标题、内容和备注信息
                                      </div>
                                    </div>
                                  </Card>
                                </Col>
                              </>
                            ) : (
                              <Col span={24}>
                                <Card title="存档完成" size="small">
                                  <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                                    <div style={{ marginBottom: 16 }}>
                                      <Text style={{ color: '#52c41a', fontSize: '18px' }}>
                                        ✅ 完整剧本已成功存档到知识库
                                      </Text>
                                    </div>
                                    <div style={{ color: '#666', marginBottom: 8 }}>
                                      存档文档：{fullScript?.archive_title || fullScriptArchiveTitle}.docx
                                    </div>
                                    <div style={{ color: '#666', marginBottom: 24 }}>
                                      您可以在知识库管理中查看和管理已存档的完整剧本
                                    </div>
                                    <Button 
                                      type="primary" 
                                      size="large"
                                      onClick={() => navigate('/knowledge-base')}
                                      style={{ 
                                        borderRadius: '6px',
                                        boxShadow: '0 2px 8px rgba(24, 144, 255, 0.3)'
                                      }}
                                    >
                                      查看知识库
                                    </Button>
                                  </div>
                                </Card>
                              </Col>
                            )}
                          </Row>
                        </div>
                      )}
                    </>
                </Card>
              </Col>
            </Row>
          </Tabs.TabPane>
        </Tabs>
      </Content>
      <Modal
        title="最终整合剧本"
        open={isResultModalVisible}
        onCancel={() => setIsResultModalVisible(false)}
        footer={[
          <Button key="copy" onClick={() => {
            navigator.clipboard.writeText(integrationResult);
            message.success('已复制到剪贴板');
          }}>
            复制内容
          </Button>,
          <Button key="back" onClick={() => setIsResultModalVisible(false)}>
            关闭
          </Button>,
        ]}
        width="60%"
      >
        <TextArea 
          value={integrationResult} 
          readOnly 
          autoSize={{ minRows: 15, maxRows: 25 }}
          style={{ background: '#f5f5f5', border: 'none' }}
        />
      </Modal>
      <Modal
        title="剧本存档"
        open={isArchiveModalVisible}
        onOk={handleConfirmArchive}
        onCancel={() => setIsArchiveModalVisible(false)}
        okText="存档"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            剧本将以专业格式保存为DOCX文档，包含格式化的标题。
          </Text>
        </div>
        <Input 
          placeholder="输入剧本存档的标题（将作为文档标题）"
          value={archiveTitle}
          onChange={(e) => setArchiveTitle(e.target.value)}
          suffix={<Text type="secondary">.docx</Text>}
        />
      </Modal>
      <Modal
        title="选择分集剧本"
        open={isSelectionModalVisible}
        onCancel={() => setIsSelectionModalVisible(false)}
        onOk={handleConfirmSelectionAndAddToDraft}
        okText="确认选择"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Button 
            onClick={handleSelectAllInModal}
            disabled={processedFiles.filter(f => f.task_status === 'completed').length === 0}
          >
            {processedFiles.filter(f => f.task_status === 'completed').length > 0 && processedFiles.filter(f => f.task_status === 'completed').every(f => modalSelectedFileIds.has(f.id))
              ? '取消全选'
              : '全选'}
          </Button>
        </div>
        <List
            dataSource={processedFiles.filter(f => f.task_status === 'completed')}
            renderItem={file => (
                <List.Item>
                    <Checkbox
                        style={{ width: '100%' }}
                        checked={modalSelectedFileIds.has(file.id)}
                        onChange={e => {
                            setModalSelectedFileIds(prev => {
                                const newSet = new Set(prev);
                                if (e.target.checked) {
                                    newSet.add(file.id);
                                } else {
                                    newSet.delete(file.id);
                                }
                                return newSet;
                            });
                        }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 8 }}>
                        <Text strong>{file.original_name}</Text>
                        <Paragraph type="secondary" ellipsis={{ rows: 2, expandable: false }}>
                          {file.task_result || '无解析内容'}
                        </Paragraph>
                      </div>
                    </Checkbox>
                </List.Item>
            )}
          />
          {processedFiles.filter(f => f.task_status === 'completed').length === 0 && (
            <Text type="secondary">暂无可选择的已解析文件。</Text>
          )}
      </Modal>
      {editingFile && (
        <Modal
          title={`编辑解析结果 - ${editingFile.original_name}`}
          open={!!editingFile}
          onOk={handleSaveAnalysisResult}
          onCancel={() => {
            // 关闭时清空批量替换输入
            setBatchFindText('');
            setBatchReplaceText('');
            setBatchMatchCount(null);
            setEditingFile(null);
          }}
          okText="保存"
          width={1400}
          destroyOnClose
          bodyStyle={{ padding: 0, overflow: 'hidden' }}
          rootClassName="edit-analysis-modal"
        >
          <div style={{ display: 'flex', gap: 0, height: '70vh', overflow: 'hidden' }}>
            {/* 左侧：视频播放器 */}
            <div style={{ flex: '0 0 35%', borderRight: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
              <div style={{ width: '100%', height: '100%' }}>
                <VideoPlayer 
                  file={editingFile}
                  canDownload={false}
                  showMeta={false}
                  fill
                />
              </div>
            </div>
            {/* 中间：文本编辑（固定高度填充，内部滚动） */}
            <div style={{ flex: '1 1 auto', padding: 16, boxSizing: 'border-box', display: 'flex', overflow: 'hidden' }}>
              <TextArea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoSize={false}
                style={{ flex: 1, height: '100%', resize: 'none', overflow: 'auto' }}
                placeholder="Edit analysis result here..."
              />
            </div>
            {/* 右侧：人物名称确认侧栏 */}
            <div style={{ flex: '0 0 220px', borderLeft: '1px solid #f0f0f0', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>名称替换</span>
                  <Space size={8}>
                    <Button size="small" onClick={handleRefreshExtraction}>刷新</Button>
                    <Button size="small" type="primary" onClick={handleReplaceAll}>全部替换</Button>
                  </Space>
                </div>
                {/* 批量替换区域 */}
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>批量替换（不区分大小写）</div>
                  <Space.Compact style={{ width: '100%', marginBottom: 6 }}>
                    <Input
                      placeholder="查找文本"
                      value={batchFindText}
                      onChange={(e) => setBatchFindText(e.target.value)}
                    />
                    <AutoComplete
                      style={{ width: 120 }}
                      value={batchReplaceText}
                      onChange={(v) => setBatchReplaceText(v)}
                      options={nameHistory.map((n) => ({ value: n }))}
                      placeholder="替换为（可空）"
                      filterOption={(inputValue, option) => option?.value?.toLowerCase().includes(inputValue.toLowerCase())}
                    />
                  </Space.Compact>
                  <Space size={8}>
                    <Button size="small" type="primary" onClick={handleBatchReplaceAll}>替换全部</Button>
                    {batchMatchCount !== null && (
                      <span style={{ fontSize: 12, color: '#888' }}>匹配 {batchMatchCount} 处</span>
                    )}
                  </Space>
                </div>
              </div>
              <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
                {bracketTerms.length === 0 ? (
                  <Text type="secondary">未检测到方括号称谓</Text>
                ) : (
                  bracketTerms.map(({ raw, count }) => (
                    <div key={raw} style={{ marginBottom: 12, borderBottom: '1px dashed #eee', paddingBottom: 8 }}>
                      <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#555' }}>[{raw}]</span>
                        <span style={{ color: '#999' }}>×{count}</span>
                      </div>
                      <Space.Compact style={{ width: '100%' }}>
                        <AutoComplete
                          style={{ width: '100%' }}
                          value={nameInputs[raw] || ''}
                          onChange={(v) => handleNameInputChange(raw, v)}
                          options={nameHistory.map((n) => ({ value: n }))}
                          placeholder="输入标准名或选择历史"
                          filterOption={(inputValue, option) => option?.value?.toLowerCase().includes(inputValue.toLowerCase())}
                        />
                        <Button onClick={() => handleStripBrackets(raw)}>去括号</Button>
                        <Button type="primary" disabled={!((nameInputs[raw] || '').trim())} onClick={() => handleReplaceOne(raw)}>替换</Button>
                      </Space.Compact>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
      
      {/* 移除了一键拼接的模态框，现在直接拼接 */}
      {/* 角色知识图谱模态框 */}
      <Modal
        title={`分集角色知识图谱 - ${currentCharacterFile?.original_name || ''}`}
        open={isCharacterModalVisible}
        onOk={canEdit ? handleSaveCharacterGraph : undefined}
        onCancel={handleCancelCharacterGraph}
        footer={[
          <Button key="cancel" onClick={handleCancelCharacterGraph}>
            {canEdit ? '取消' : '关闭'}
          </Button>,
          ...(canEdit ? [
            <Button key="save" type="primary" onClick={handleSaveCharacterGraph}>
              保存
            </Button>
          ] : [])
        ]}
        width="60vw"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            {canEdit ? '请编辑该集的角色关系和知识图谱信息：' : '该集的角色关系和知识图谱信息（只读模式）：'}
          </Text>
        </div>
        <TextArea
          value={characterContent}
          onChange={(e) => canEdit && setCharacterContent(e.target.value)}
          readOnly={!canEdit}
          placeholder={canEdit ? "请输入角色关系图谱、人物设定、关键情节等信息..." : "暂无角色图谱信息"}
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount={canEdit}
          style={{ 
            marginBottom: '14px',
            backgroundColor: canEdit ? '#fff' : '#f5f5f5'
          }}
        />
      </Modal>

      {/* 选择分集角色图谱模态框 */}
      <Modal
        title={`选择分集角色图谱 (${characterModalSelectedFileIds.size}/${processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success').length})`}
        open={isCharacterSelectionModalVisible}
        onCancel={() => setIsCharacterSelectionModalVisible(false)}
        onOk={handleConfirmCharacterSelectionAndAddToDraft}
        okText="确认选择"
        cancelText="取消"
        destroyOnClose
        key={`character-modal-${characterGraphStatusMap.size}-${processedFiles.length}`}
        bodyStyle={{ 
          maxHeight: '70vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <Button 
            onClick={handleSelectAllCharacterInModal}
            disabled={processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success').length === 0}
          >
            {processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success').length > 0 && processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success').every(f => characterModalSelectedFileIds.has(f.id))
              ? '取消全选'
              : '全选'}
          </Button>
        </div>
        <div style={{ 
          flex: 1, 
          overflow: 'auto', 
          border: '1px solid #d9d9d9',
          borderRadius: '6px',
          padding: '8px'
        }}>
          <List
              dataSource={processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success')}
              renderItem={file => (
                  <List.Item>
                      <Checkbox
                          style={{ width: '100%' }}
                          checked={characterModalSelectedFileIds.has(file.id)}
                          onChange={e => {
                              setCharacterModalSelectedFileIds(prev => {
                                  const newSet = new Set(prev);
                                  if (e.target.checked) {
                                      newSet.add(file.id);
                                  } else {
                                      newSet.delete(file.id);
                                  }
                                  return newSet;
                              });
                          }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 8 }}>
                          <Text strong>{file.original_name}</Text>
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            有角色知识图谱数据
                          </Text>
                        </div>
                      </Checkbox>
                  </List.Item>
              )}
            />
        </div>
        {processedFiles.filter(f => characterGraphStatusMap.get(f.id) === 'success').length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px', flexShrink: 0 }}>
            <Text type="secondary">暂无可选择的角色知识图谱文件。请先生成角色知识图谱。</Text>
          </div>
        )}
      </Modal>

      {/* 全局角色图谱编辑模态框 */}
      <Modal
        title="全局角色图谱 (1/1)"
        open={isGlobalCharacterModalVisible}
        onOk={handleSaveGlobalCharacterContent}
        onCancel={() => setIsGlobalCharacterModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width="60vw"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            编辑全局角色关系图谱，这将作为图谱整合的补充素材：
          </Text>
        </div>
        <TextArea
          value={globalCharacterContent}
          onChange={(e) => setGlobalCharacterContent(e.target.value)}
          placeholder="请输入全局角色设定、主要角色关系、背景设定等信息..."
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount
          style={{ marginBottom: '14px' }}
        />
      </Modal>

      {/* 单元选择角色图谱模态框 */}
      <Modal
        title="选择角色图谱"
        open={isUnitCharacterModalVisible}
        onCancel={() => setIsUnitCharacterModalVisible(false)}
        onOk={handleConfirmUnitCharacterSelection}
        okText="确认添加"
        cancelText="取消"
        width="60vw"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            将选择的全局角色图谱添加到当前单元的素材区中：
          </Text>
        </div>
        {globalCharacterContent ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <Text strong>全局角色图谱内容预览：</Text>
            </div>
            <div style={{ 
              maxHeight: '300px', 
              overflowY: 'auto', 
              padding: '12px', 
              backgroundColor: '#f5f5f5', 
              borderRadius: '6px',
              border: '1px solid #d9d9d9'
            }}>
              <pre style={{ 
                whiteSpace: 'pre-wrap', 
                fontSize: '12px', 
                lineHeight: '1.5',
                margin: 0,
                fontFamily: 'inherit'
              }}>
                {globalCharacterContent}
              </pre>
            </div>
          </div>
        ) : (
          <div style={{ 
            textAlign: 'center', 
            padding: '40px', 
            color: '#999',
            backgroundColor: '#fafafa',
            borderRadius: '6px'
          }}>
            暂无全局角色图谱内容，请先在图谱整合工作台中生成角色图谱
          </div>
        )}
      </Modal>

      {/* 单元选择分集剧本模态框 */}
      <Modal
        title="为单元选择分集剧本"
        open={isUnitSelectionModalVisible}
        onCancel={() => setIsUnitSelectionModalVisible(false)}
        onOk={handleConfirmUnitSelection}
        okText="确认选择"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ color: '#d46b08' }}>
            提示：最多可选择10集分集剧本
          </Text>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Button 
            onClick={() => {
              const completedFiles = processedFiles.filter(f => f.task_status === 'completed');
              const allSelected = completedFiles.length > 0 && completedFiles.every(f => unitModalSelectedFileIds.has(f.id));
              
              if (allSelected) {
                setUnitModalSelectedFileIds(new Set());
              } else {
                // 限制最多选择10个
                const fileIds = completedFiles.slice(0, 10).map(f => f.id);
                setUnitModalSelectedFileIds(new Set(fileIds));
              }
            }}
            disabled={processedFiles.filter(f => f.task_status === 'completed').length === 0}
          >
            {processedFiles.filter(f => f.task_status === 'completed').length > 0 && processedFiles.filter(f => f.task_status === 'completed').every(f => unitModalSelectedFileIds.has(f.id))
              ? '取消全选'
              : '全选'}
          </Button>
          <Text type="secondary" style={{ marginLeft: 16 }}>
            已选择 {unitModalSelectedFileIds.size} / 10 集
          </Text>
        </div>
        <List
            dataSource={processedFiles.filter(f => f.task_status === 'completed')}
            renderItem={file => {
              const isDisabled = !unitModalSelectedFileIds.has(file.id) && unitModalSelectedFileIds.size >= 10;
              return (
                <List.Item>
                    <Checkbox
                        style={{ width: '100%', opacity: isDisabled ? 0.5 : 1 }}
                        checked={unitModalSelectedFileIds.has(file.id)}
                        disabled={isDisabled}
                        onChange={e => {
                            setUnitModalSelectedFileIds(prev => {
                                const newSet = new Set(prev);
                                if (e.target.checked) {
                                    if (newSet.size < 10) {
                                      newSet.add(file.id);
                                    }
                                } else {
                                    newSet.delete(file.id);
                                }
                                return newSet;
                            });
                        }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 8 }}>
                        <Text strong>{file.original_name}</Text>
                        <Paragraph type="secondary" ellipsis={{ rows: 2, expandable: false }}>
                          {file.task_result || '无解析内容'}
                        </Paragraph>
                      </div>
                    </Checkbox>
                </List.Item>
              );
            }}
          />
          {processedFiles.filter(f => f.task_status === 'completed').length === 0 && (
            <Text type="secondary">暂无可选择的已解析文件。</Text>
          )}
      </Modal>

      {/* 单元选择素材模态框（整合版） */}
      <Modal
        title="选择素材"
        open={isUnitMaterialModalVisible}
        onCancel={() => setIsUnitMaterialModalVisible(false)}
        onOk={handleConfirmUnitMaterialSelection}
        okText="确认添加"
        cancelText="取消"
        destroyOnClose
        width="75vw"
        style={{ top: 20, maxHeight: 'calc(100vh - 40px)' }}
        bodyStyle={{ 
          padding: '16px',
          maxHeight: 'calc(100vh - 160px)',
          overflow: 'hidden'
        }}
      >
        <div style={{ height: '500px', maxHeight: 'calc(100vh - 200px)', padding: '4px' }}>
          <Row gutter={16} style={{ height: '100%' }}>
            {/* 左侧：分集剧本选择 */}
            <Col span={14}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Title level={5} style={{ margin: 0, marginBottom: 4 }}>分集剧本</Title>
                  <Text type="secondary" style={{ color: '#d46b08', fontSize: '12px' }}>
                    提示：最多可选择10集分集剧本
                  </Text>
                </div>
                
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Button 
                    size="small"
                    onClick={() => {
                      const completedFiles = processedFiles.filter(f => f.task_status === 'completed');
                      const allSelected = completedFiles.length > 0 && completedFiles.every(f => unitMaterialSelectedFileIds.has(f.id));
                      
                      if (allSelected) {
                        setUnitMaterialSelectedFileIds(new Set());
                      } else {
                        // 限制最多选择10个
                        const fileIds = completedFiles.slice(0, 10).map(f => f.id);
                        setUnitMaterialSelectedFileIds(new Set(fileIds));
                      }
                    }}
                    disabled={processedFiles.filter(f => f.task_status === 'completed').length === 0}
                  >
                    {processedFiles.filter(f => f.task_status === 'completed').length > 0 && processedFiles.filter(f => f.task_status === 'completed').every(f => unitMaterialSelectedFileIds.has(f.id))
                      ? '取消全选'
                      : '全选'}
                  </Button>
                  <Text type="secondary" style={{ marginLeft: 12, fontSize: '11px' }}>
                    已选择 {unitMaterialSelectedFileIds.size} / 10 集
                  </Text>
                </div>

                <div style={{ 
                  flex: 1, 
                  display: 'flex',
                  flexDirection: 'column',
                  border: '1px solid #d9d9d9', 
                  borderRadius: '6px',
                  minHeight: 0,
                  maxHeight: '400px'
                }}>
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '4px'
                  }}>
                    {processedFiles.filter(f => f.task_status === 'completed').length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '30px 10px', color: '#999', fontSize: '12px' }}>
                        暂无可选择的已解析文件
                      </div>
                    ) : (
                      <List
                        size="small"
                        dataSource={processedFiles.filter(f => f.task_status === 'completed')}
                        split={false}
                        renderItem={file => {
                          const isDisabled = !unitMaterialSelectedFileIds.has(file.id) && unitMaterialSelectedFileIds.size >= 10;
                          return (
                            <List.Item style={{ padding: '4px 2px', margin: 0 }}>
                              <Checkbox
                                style={{ width: '100%', opacity: isDisabled ? 0.5 : 1 }}
                                checked={unitMaterialSelectedFileIds.has(file.id)}
                                disabled={isDisabled}
                                onChange={e => {
                                  setUnitMaterialSelectedFileIds(prev => {
                                    const newSet = new Set(prev);
                                    if (e.target.checked) {
                                      if (newSet.size < 10) {
                                        newSet.add(file.id);
                                      }
                                    } else {
                                      newSet.delete(file.id);
                                    }
                                    return newSet;
                                  });
                                }}
                              >
                                <div style={{ marginLeft: 6 }}>
                                  <Text strong style={{ fontSize: '12px' }}>{file.original_name}</Text>
                                </div>
                              </Checkbox>
                            </List.Item>
                          );
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </Col>

            {/* 右侧：角色图谱选择 */}
            <Col span={10}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Title level={5} style={{ margin: 0, marginBottom: 4 }}>角色图谱</Title>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    选择是否添加全局角色图谱
                  </Text>
                </div>
                
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Checkbox
                    checked={unitMaterialIncludeCharacterGraph}
                    onChange={(e) => setUnitMaterialIncludeCharacterGraph(e.target.checked)}
                    disabled={!globalCharacterContent}
                  >
                    <Text strong style={{ fontSize: '12px' }}>选择全局角色图谱</Text>
                  </Checkbox>
                </div>

                <div style={{ 
                  flex: 1, 
                  display: 'flex',
                  flexDirection: 'column',
                  border: '1px solid #d9d9d9', 
                  borderRadius: '6px',
                  minHeight: 0,
                  maxHeight: '400px'
                }}>
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '6px'
                  }}>
                    {globalCharacterContent ? (
                      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ marginBottom: 4, flexShrink: 0 }}>
                          <Text strong style={{ fontSize: '11px' }}>内容预览：</Text>
                        </div>
                        <div style={{ 
                          backgroundColor: '#f5f5f5', 
                          borderRadius: '4px',
                          padding: '6px',
                          flex: 1,
                          overflowY: 'auto',
                          minHeight: 0
                        }}>
                          <pre style={{ 
                            whiteSpace: 'pre-wrap', 
                            fontSize: '10px', 
                            lineHeight: '1.3',
                            margin: 0,
                            fontFamily: 'inherit'
                          }}>
                            {globalCharacterContent}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <div style={{ 
                        textAlign: 'center', 
                        padding: '40px 15px', 
                        color: '#999',
                        backgroundColor: '#fafafa',
                        borderRadius: '4px',
                        fontSize: '11px',
                        lineHeight: '1.4'
                      }}>
                        暂无全局角色图谱内容
                        <br />
                                                              请先在图谱整合工作台中生成角色图谱
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Col>
          </Row>
        </div>
      </Modal>

      {/* 角色图谱预览模态框 */}
      <Modal
        title="角色图谱预览"
        open={isCharacterDraftPreviewVisible}
        onOk={canEdit ? handleSavePreviewCharacterContent : undefined}
        onCancel={() => setIsCharacterDraftPreviewVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setIsCharacterDraftPreviewVisible(false)}>
            {canEdit ? '取消' : '关闭'}
          </Button>,
          ...(canEdit ? [
            <Button key="save" type="primary" onClick={handleSavePreviewCharacterContent}>
              保存修改
            </Button>
          ] : [])
        ]}
        width="60vw"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            {canEdit ? '预览和编辑分集图谱的拼接内容：' : '分集图谱的拼接内容（只读模式）：'}
          </Text>
        </div>
        <TextArea
          value={previewCharacterContent}
          onChange={(e) => canEdit && setPreviewCharacterContent(e.target.value)}
          readOnly={!canEdit}
          placeholder={canEdit ? "预览内容为空..." : "暂无内容"}
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount={canEdit}
          style={{ 
            marginBottom: '14px',
            backgroundColor: canEdit ? '#fff' : '#f5f5f5'
          }}
        />
      </Modal>

      {/* 角色结果预览模态框 */}
      <Modal
        title="角色结果预览"
        open={isCharacterResultPreviewVisible}
        onCancel={() => {
          setIsCharacterResultPreviewVisible(false);
          setIsCharacterResultEditing(false);
          setCharacterResultEditContent('');
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setIsCharacterResultPreviewVisible(false);
            setIsCharacterResultEditing(false);
            setCharacterResultEditContent('');
          }}>
            关闭
          </Button>,
          ...(canEdit ? [
            <Button key="save" type="primary" onClick={handleSaveCharacterResult}>
              保存修改
            </Button>
          ] : [])
        ]}
        width="60vw"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            预览角色整合结果内容：
          </Text>
        </div>
        <TextArea
          value={characterResultEditContent}
          onChange={(e) => canEdit && setCharacterResultEditContent(e.target.value)}
          readOnly={!canEdit}
          placeholder="预览内容为空..."
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount={canEdit}
          style={{ 
            marginBottom: '14px', 
            backgroundColor: canEdit ? '#fff' : '#f5f5f5'
          }}
        />
      </Modal>

      {/* 新增：三步工作流模态框 */}
      
      {/* 步骤1：选择素材模态框 */}
      <Modal
        title="步骤1：选择分集素材"
        open={isStep1ModalVisible}
        onCancel={() => setIsStep1ModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setIsStep1ModalVisible(false)}>
            取消
          </Button>,
          <Button 
            key="preview" 
            onClick={handleStep1Preview}
            disabled={unitMaterialSelectedFileIds.size === 0}
          >
            预览内容
          </Button>,
          <Button 
            key="confirm" 
            type="primary" 
            loading={unitWorkflowProcessing[activeUnitId]?.step1}
            onClick={handleConfirmStep1}
          >
            确认选择
          </Button>
        ]}
        destroyOnClose
        width="60vw"
        style={{ top: 10, maxHeight: 'calc(100vh - 20px)' }}
        bodyStyle={{ 
          padding: '16px',
          maxHeight: 'calc(100vh - 140px)',
          overflow: 'hidden'
        }}
      >
        <div style={{ height: '500px', maxHeight: 'calc(100vh - 200px)', padding: '4px' }}>
          <Row style={{ height: '100%' }}>
            {/* 分集剧本选择 */}
            <Col span={24}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Title level={5} style={{ margin: 0, marginBottom: 4 }}>分集剧本</Title>
                  <Text type="secondary" style={{ color: '#d46b08', fontSize: '12px' }}>
                    提示：最多可选择10集分集剧本
                  </Text>
                </div>
                
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Button 
                    size="small"
                    onClick={() => {
                      const completedFiles = processedFiles.filter(f => f.task_status === 'completed');
                      const allSelected = completedFiles.length > 0 && completedFiles.every(f => unitMaterialSelectedFileIds.has(f.id));
                      
                      if (allSelected) {
                        setUnitMaterialSelectedFileIds(new Set());
                      } else {
                        const fileIds = completedFiles.slice(0, 10).map(f => f.id);
                        setUnitMaterialSelectedFileIds(new Set(fileIds));
                      }
                    }}
                    disabled={processedFiles.filter(f => f.task_status === 'completed').length === 0}
                  >
                    {processedFiles.filter(f => f.task_status === 'completed').length > 0 && processedFiles.filter(f => f.task_status === 'completed').every(f => unitMaterialSelectedFileIds.has(f.id))
                      ? '取消全选'
                      : '全选'}
                  </Button>
                  <Text type="secondary" style={{ marginLeft: 12, fontSize: '11px' }}>
                    已选择 {unitMaterialSelectedFileIds.size} / 10 集
                  </Text>
                </div>

                <div style={{ 
                  flex: 1, 
                  display: 'flex',
                  flexDirection: 'column',
                  border: '1px solid #d9d9d9', 
                  borderRadius: '6px',
                  minHeight: 0,
                  maxHeight: '400px'
                }}>
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '4px'
                  }}>
                    {processedFiles.filter(f => f.task_status === 'completed').length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '30px 10px', color: '#999', fontSize: '12px' }}>
                        暂无可选择的已解析文件
                      </div>
                    ) : (
                      <List
                        size="small"
                        dataSource={processedFiles.filter(f => f.task_status === 'completed')}
                        split={false}
                        renderItem={file => {
                          const isDisabled = !unitMaterialSelectedFileIds.has(file.id) && unitMaterialSelectedFileIds.size >= 10;
                          return (
                            <List.Item style={{ padding: '4px 2px', margin: 0 }}>
                              <Checkbox
                                style={{ width: '100%', opacity: isDisabled ? 0.5 : 1 }}
                                checked={unitMaterialSelectedFileIds.has(file.id)}
                                disabled={isDisabled}
                                onChange={e => {
                                  setUnitMaterialSelectedFileIds(prev => {
                                    const newSet = new Set(prev);
                                    if (e.target.checked) {
                                      if (newSet.size < 10) {
                                        newSet.add(file.id);
                                      }
                                    } else {
                                      newSet.delete(file.id);
                                    }
                                    return newSet;
                                  });
                                }}
                              >
                                <div style={{ marginLeft: 6 }}>
                                  <Text strong style={{ fontSize: '12px' }}>{file.original_name}</Text>
                                </div>
                              </Checkbox>
                            </List.Item>
                          );
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </Col>
          </Row>
        </div>
      </Modal>

      {/* 步骤2：内容整合模态框 */}
      <Modal
        title="步骤2：分集内容整合"
        open={isStep2ModalVisible}
        onCancel={() => setIsStep2ModalVisible(false)}
        footer={(() => {
          const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
          const isCompleted = activeUnit?.step2_completed;
          
          return [
            <Button key="cancel" onClick={() => setIsStep2ModalVisible(false)}>
              {isCompleted ? '取消' : '取消'}
            </Button>,
            !isCompleted ? (
              <Button 
                key="execute" 
                type="primary" 
                loading={unitWorkflowProcessing[activeUnitId]?.step2}
                onClick={handleExecuteStep2}
              >
                开始内容整合
              </Button>
            ) : (
              <Button 
                key="save" 
                type="primary" 
                onClick={handleStep2Save}
                disabled={!canEdit}
              >
                保存
              </Button>
            )
          ].filter(Boolean);
        })()}
        destroyOnClose
        width="60vw"
        style={{ top: 20 }}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            {(() => {
              const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
              return activeUnit?.step2_completed 
                ? '您可以编辑以下内容，点击保存生效' 
                : '以下内容将用于内容整合，您可以预览但不能在此修改';
            })()}
          </div>
        </div>
        <TextArea
          value={(() => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            return activeUnit?.step2_completed ? step2EditContent : step2PreviewContent;
          })()}
          onChange={(e) => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            if (activeUnit?.step2_completed) {
              setStep2EditContent(e.target.value);
            }
          }}
          readOnly={(() => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            return !activeUnit?.step2_completed || !canEdit;
          })()}
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount={(() => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            return activeUnit?.step2_completed && canEdit;
          })()}
          style={(() => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            const baseStyle = { marginBottom: '10px' };
            return (!activeUnit?.step2_completed || !canEdit) ? 
              { ...baseStyle, backgroundColor: '#f5f5f5' } : 
              baseStyle;
          })()}
        />
      </Modal>

      {/* 步骤4：角色整合模态框 */}
      <Modal
        title="步骤4：分集角色整合"
        open={isStep4ModalVisible}
        onCancel={() => setIsStep4ModalVisible(false)}
        footer={(() => {
          const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
          const isCompleted = activeUnit?.step4_completed;
          
          return [
            <Button key="cancel" onClick={() => setIsStep4ModalVisible(false)}>
              取消
            </Button>,
            !isCompleted ? (
              <Button 
                key="execute" 
                type="primary" 
                loading={unitWorkflowProcessing[activeUnitId]?.step4}
                onClick={handleExecuteStep4}
              >
                点击开始角色整合
              </Button>
            ) : (
              <Button 
                key="save" 
                type="primary" 
                onClick={handleStep4Save}
                disabled={!canEdit}
              >
                保存
              </Button>
            )
          ].filter(Boolean);
        })()}
        destroyOnClose
        width="60vw"
        style={{ top: 20 }}
      >
        <div style={{ marginBottom: 16 }}>
          {/* <Text strong>
            {(() => {
              const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
              return activeUnit?.step4_completed ? '步骤4角色整合结果：' : '内容预览：';
            })()}
          </Text> */}
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            {(() => {
              const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
              return activeUnit?.step4_completed 
                ? '您可以编辑以下内容，点击保存生效' 
                : '以下是步骤3的内容整合结果，将基于此进行角色整合';
            })()}
          </div>
        </div>
        <TextArea
          value={(() => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            return activeUnit?.step4_completed ? step4EditContent : step4PreviewContent;
          })()}
          onChange={(e) => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            if (activeUnit?.step4_completed) {
              setStep4EditContent(e.target.value);
            }
          }}
          readOnly={(() => {
            const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
            return !activeUnit?.step4_completed || !canEdit;
          })()}
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount
          style={(() => {
             const activeUnit = activeUnitId && scriptUnits.find(u => u.id === activeUnitId);
             const baseStyle = { marginBottom: '10px' };
             return (!activeUnit?.step4_completed || !canEdit) ? 
               { ...baseStyle, backgroundColor: '#f5f5f5' } : 
               baseStyle;
           })()}
        />
      </Modal>

            {/* 步骤3：添加角色图谱模态框 */}
      <Modal
        title="步骤3：选择角色图谱集数片段"
        open={isStep3ModalVisible}
        onCancel={() => setIsStep3ModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setIsStep3ModalVisible(false)}>
            取消
          </Button>,
          <Button 
            key="execute" 
            type="primary" 
            loading={unitWorkflowProcessing[activeUnitId]?.step3}
            onClick={handleExecuteStep3}
            disabled={characterEpisodeSegments.length === 0 || selectedEpisodeSegments.size === 0}
          >
            确认选择
          </Button>
        ]}
        destroyOnClose
        width="60vw"
        style={{ top: 10, maxHeight: 'calc(100vh - 20px)' }}
        bodyStyle={{ 
          padding: '16px',
          maxHeight: 'calc(100vh - 140px)',
          overflow: 'hidden'
        }}
      >
        <div style={{ height: '500px', maxHeight: 'calc(100vh - 200px)', padding: '4px' }}>
          <Row style={{ height: '100%' }}>
            {/* 角色图谱集数片段选择 */}
            <Col span={24}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Title level={5} style={{ margin: 0, marginBottom: 4 }}>角色图谱集数片段</Title>
                  <Text type="secondary" style={{ color: '#d46b08', fontSize: '12px' }}>
                    提示：选择需要添加到剧本中的角色图谱集数片段
                  </Text>
                </div>
                
                <div style={{ marginBottom: 8, flexShrink: 0 }}>
                  <Button 
                    size="small"
                    onClick={handleSelectAllEpisodeSegments}
                    disabled={characterEpisodeSegments.length === 0}
                  >
                    {selectedEpisodeSegments.size === characterEpisodeSegments.length ? '取消全选' : '全选'}
                  </Button>
                  <Text type="secondary" style={{ marginLeft: 12, fontSize: '11px' }}>
                    已选择 {selectedEpisodeSegments.size} / {characterEpisodeSegments.length} 个片段
                  </Text>
                </div>

                <div style={{ 
                  flex: 1, 
                  display: 'flex',
                  flexDirection: 'column',
                  border: '1px solid #d9d9d9', 
                  borderRadius: '6px',
                  minHeight: 0,
                  maxHeight: '400px'
                }}>
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '4px'
                  }}>
                    {characterEpisodeSegments.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '30px 10px', color: '#999', fontSize: '12px' }}>
                        暂无可选择的角色图谱集数片段
                      </div>
                    ) : (
                      <List
                        size="small"
                        dataSource={characterEpisodeSegments}
                        split={false}
                        renderItem={segment => (
                          <List.Item style={{ padding: '4px 2px', margin: 0 }}>
                            <Checkbox
                              style={{ width: '100%' }}
                              checked={selectedEpisodeSegments.has(segment.id)}
                              onChange={e => handleEpisodeSegmentSelect(segment.id, e.target.checked)}
                            >
                              <div style={{ marginLeft: 6 }}>
                                <Text strong style={{ fontSize: '12px' }}>{segment.title}</Text>
                              </div>
                            </Checkbox>
                          </List.Item>
                        )}
                      />
                    )}
                  </div>
                </div>
              </div>
            </Col>
          </Row>
        </div>
      </Modal>

      {/* 步骤1：内容预览模态框 */}
      <Modal
        title="步骤1：选择内容预览"
        open={isStep1PreviewVisible}
        onCancel={() => setIsStep1PreviewVisible(false)}
        footer={[
          <Button key="close" onClick={() => setIsStep1PreviewVisible(false)}>
            取消
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            onClick={handleStep1Save}
            disabled={!canEdit}
          >
            保存
          </Button>
        ]}
        destroyOnClose
        width="60vw"
        style={{ top: 20 }}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            您可以编辑以下内容，点击保存生效
          </div>
        </div>
        <TextArea
          value={step1EditContent}
          onChange={(e) => setStep1EditContent(e.target.value)}
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount
          disabled={!canEdit}
          style={{ marginBottom: '30px' }}
        />
      </Modal>

      {/* 步骤3：内容预览模态框 */}
      <Modal
        title="步骤3：角色图谱内容预览"
        open={isStep3PreviewVisible}
        onCancel={() => setIsStep3PreviewVisible(false)}
        footer={[
          <Button key="close" onClick={() => setIsStep3PreviewVisible(false)}>
            取消
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            onClick={handleStep3Save}
            disabled={!canEdit}
          >
            保存
          </Button>
        ]}
        destroyOnClose
        width="60vw"
        style={{ top: 20 }}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            您可以编辑以下内容，点击保存生效
          </div>
        </div>
        <TextArea
          value={step3EditContent}
          onChange={(e) => setStep3EditContent(e.target.value)}
          autoSize={{ minRows: 15, maxRows: 25 }}
          showCount
          disabled={!canEdit}
          style={{ marginBottom: '30px' }}
        />
      </Modal>

      {/* 手动输入角色图谱模态框 */}
      <Modal
        title="手动录入角色图谱"
        open={isManualInputModalVisible}
        onCancel={() => {
          setIsManualInputModalVisible(false);
          setManualInputContent('');
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setIsManualInputModalVisible(false);
            setManualInputContent('');
          }}>
            取消
          </Button>,
          <Button 
            key="test" 
            onClick={() => testParseFunction(manualInputContent)}
            disabled={!manualInputContent.trim()}
          >
            测试解析
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            onClick={handleSaveManualInput}
            disabled={!manualInputContent.trim()}
          >
            保存
          </Button>
        ]}
        destroyOnClose
        width="70vw"
        style={{ top: 20 }}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ 
            padding: '12px',
            backgroundColor: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <InfoCircleOutlined style={{ color: '#52c41a', marginRight: '8px' }} />
              <Text strong style={{ color: '#389e0d' }}>格式说明</Text>
            </div>
            <Text style={{ color: '#389e0d', fontSize: '14px' }}>
              为了在剧本单元中正确选择角色图谱片段，请按以下格式录入：
            </Text>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#595959' }}>
              <div>• 支持格式：<code>第1集</code>、<code>第2集</code>、<code>1集</code>、<code>Episode 1</code>、<code>EP.1</code></div>
              <div>• 每集内容独立成段，集数标题单独一行</div>
              <div>• 不符合集数格式的内容会归为"通用内容"</div>
            </div>
          </div>
          
          <div style={{ 
            padding: '12px',
            backgroundColor: '#f0f2ff',
            border: '1px solid #adc6ff',
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            <Text strong style={{ color: '#2f54eb', marginBottom: '8px', display: 'block' }}>示例格式：</Text>
            <pre style={{ 
              fontSize: '12px', 
              color: '#595959', 
              margin: 0,
              whiteSpace: 'pre-wrap',
              fontFamily: 'Monaco, Consolas, monospace'
            }}>
{`第1集
主角张三：男，25岁，软件工程师
女主李四：女，23岁，设计师
他们在咖啡店相遇...

第2集  
张三向李四表白
新角色王五出现：男，30岁，张三的朋友
剧情发展...

通用角色背景
这里是不分集的通用角色信息
可以包含整体设定等内容`}
            </pre>
          </div>
        </div>
        <TextArea
          value={manualInputContent}
          onChange={(e) => setManualInputContent(e.target.value)}
          placeholder="请按上述格式输入角色图谱内容，可以点击'测试解析'按钮验证格式..."
          autoSize={{ minRows: 12, maxRows: 20 }}
          showCount
          style={{ marginBottom: '10px' }}
        />
      </Modal>

      {/* 修改密码模态框 */}
      <ChangePasswordModal
        visible={passwordModalVisible}
        onCancel={() => setPasswordModalVisible(false)}
        onFinish={handleChangePassword}
      />



      
      {playingFile && (
        <Modal
          title={playingFile.original_name}
          open={!!playingFile}
          onCancel={() => setPlayingFile(null)}
          footer={null}
          destroyOnClose
          width="70vw"
          bodyStyle={{ padding: 0, lineHeight: 0 }}
        >
          <VideoPlayer 
            file={playingFile}
            canDownload={canDownload}
            autoPlay
          />
        </Modal>
      )}
      
      {/* 队列管理模态框 */}
      <QueueManagementModal 
        visible={queueModalVisible}
        onClose={() => setQueueModalVisible(false)}
      />
      
    </Layout>
  )
}

export default ProjectDetail
