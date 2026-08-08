import axios from 'axios'
import logger from '../utils/logger'
import { applySessionSecurity, createAuthResponseErrorHandler } from './httpSecurity'

const handleAuthResponseError = createAuthResponseErrorHandler()

const api = axios.create({
  baseURL: '',
  timeout: 30000,
  withCredentials: true,
})

// 请求拦截器
api.interceptors.request.use((config) => {
  applySessionSecurity(config)
  // 只记录请求开始时间，不输出日志（减少噪音）
  const startTime = Date.now()
  config.metadata = { startTime }
  
  return config
})

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    // 计算响应时间
    const responseTime = response.config.metadata ? Date.now() - response.config.metadata.startTime : null
    
    logger.apiCall(
      response.config.method?.toUpperCase() || 'GET',
      response.config.url || '',
      response.status,
      responseTime
    )
    
    return response.data
  },
  (error) => {
    // 计算响应时间
    const responseTime = error.config?.metadata ? Date.now() - error.config.metadata.startTime : null
    
    logger.apiCall(
      error.config?.method?.toUpperCase() || 'GET',
      error.config?.url || '',
      error.response?.status || 0,
      responseTime
    )
    
    logger.error('API', `API请求失败: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
      status: error.response?.status,
      message: error.message,
      responseTime
    })
    
    return handleAuthResponseError(error)
  }
)

// 认证相关API
export const authAPI = {
  changePassword: (data) => api.post('/api/auth/change-password', data),
  // 管理员用户管理API
  getUsers: () => api.get('/api/auth/users'),
  createUser: (data) => api.post('/api/auth/users', data),
  resetUserPassword: (userId, newPassword) => api.post(`/api/auth/users/${userId}/reset-password`, { newPassword }),
  deleteUser: (userId) => api.delete(`/api/auth/users/${userId}`),
  updateUserStatus: (userId, status) => api.put(`/api/auth/users/${userId}/status`, { status }),
  updateUserRemarks: (userId, remarks) => api.put(`/api/auth/users/${userId}/remarks`, { remarks }),
  updateUserPermission: (userId, permission) => api.put(`/api/auth/users/${userId}/permission`, { permission })
}

// 系统配置相关API
export const systemConfigAPI = {
  getApiOnboardingStatus: () => api.get('/api/system-config/onboarding'),
  completeApiOnboarding: (skipped) => api.put('/api/system-config/onboarding', { skipped }),
  // 获取所有配置
  getAllConfigs: () => api.get('/api/system-config'),
  
  // 获取连接状态
  getStatus: () => api.get('/api/system-config/status'),
  
  // 获取公开的默认Prompt配置
  getPublicPrompts: () => api.get('/api/system-config/public-prompts'),
  
  // 更新Gemini API密钥
  updateGeminiKey: (apiKey) => api.put('/api/system-config/gemini-key', { apiKey }),
  
  // 更新模型配置
  updateModels: (defaultModel, availableModels) => api.put('/api/system-config/models', { defaultModel, availableModels }),
  
  // 更新视频解析Prompt
  updateVideoAnalysisPrompt: (prompt) => api.put('/api/system-config/video-analysis-prompt', { prompt }),
  
  // 更新单元剧本Prompt
  updateScriptIntegrationPrompt: (prompt) => api.put('/api/system-config/script-integration-prompt', { prompt }),
  
  // 更新角色知识图谱Prompt
  updateCharacterKnowledgeGraphPrompt: (prompt) => api.put('/api/system-config/character-knowledge-graph-prompt', { prompt }),
  
  // 更新角色知识图谱整合Prompt
  updateCharacterIntegrationPrompt: (prompt) => api.put('/api/system-config/character-integration-prompt', { prompt }),
  updateCharacterPrompt: (prompt) => api.put('/api/system-config/character-prompt', { prompt }),
  
  // 应用配置
  applyConfigs: () => api.post('/api/system-config/apply'),
  
  // 清除缓存
  clearCache: () => api.post('/api/system-config/clear-cache'),
  
  // 获取单个配置
  getConfig: (key) => api.get(`/api/system-config/config/${key}`),
  
  // 设置单个配置
  setConfig: (key, value, userId) => api.put(`/api/system-config/config/${key}`, { value, userId }),
  
  // 恢复：测试Gemini连接（使用更长超时）
  testGemini: () => api.post('/api/system-config/test-gemini', {}, { timeout: 120000 }),
  // 新增：测试代理连通性
  testProxy: () => api.post('/api/system-config/test-proxy', {}, { timeout: 120000 }),

  // 获取公开的模型配置（非admin用户也可以访问）
  getPublicConfigs: () => api.get('/api/system-config/public-configs'),
}

// AI 服务商与文本任务路由（仅管理员）
export const aiProviderAPI = {
  getAll: () => api.get('/api/ai-providers'),
  createProvider: (data) => api.post('/api/ai-providers', data),
  updateProvider: (id, data) => api.put(`/api/ai-providers/${id}`, data),
  testProvider: (id) => api.post(`/api/ai-providers/${id}/test`, {}, { timeout: 120000 }),
  setScriptIntegrationRoute: (providerId, model) => api.put('/api/ai-providers/routes/script_integration', { providerId, model }),
}

// 项目相关API
export const projectAPI = {
  getList: (params) => api.get('/api/projects', { params }),
  getDetail: (id) => api.get(`/api/projects/${id}`),
  create: (data) => api.post('/api/projects', data),
  update: (id, data) => api.put(`/api/projects/${id}`, data),
  updatePrompts: (id, data) => api.put(`/api/projects/${id}/prompts`, data),
  delete: (id) => api.delete(`/api/projects/${id}`)
}

// 项目级全局角色档案（在视频解析过程中自动生成）
export const characterRegistryAPI = {
  getProject: (projectId) => api.get(`/api/characters/project/${projectId}`),
}

// 文件相关API  
export const fileAPI = {
  upload: (projectId, file, projectType) => {
    const formData = new FormData()
    formData.append('projectId', projectId)
    formData.append('file', file)
    
    return api.post('/api/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 300000 // 5分钟超时，适应大文件上传和视频处理
    })
  },
  
  renameFile: (fileId, name) => api.put(`/api/files/${fileId}/rename`, { name }),
  getProjectFiles: (projectId) => api.get(`/api/files/project/${projectId}`),
  delete: (fileId) => api.delete(`/api/files/${fileId}`),
  getDownloadUrl: (fileId) => `/api/files/${fileId}/download`,
  updateAnalysisResult: (fileId, result) => api.put(`/api/files/${fileId}/analysis-result`, { result }),
  // 新增：切换处理完成标记
  markDone: (fileId, done) => api.put(`/api/files/${fileId}/mark-done`, { done })
}

// AI相关API
export const aiAPI = {
  testConnection: () => api.get('/api/ai/test'),
  getModels: () => api.get('/api/ai/models'),
  analyze: (data) => api.post('/api/ai/analyze', data, {
    timeout: 120000,
    headers: { 'Idempotency-Key': crypto.randomUUID() }
  }),
  integrate: (data) => api.post('/api/ai/integrate-script', data, { timeout: 180000 }),
  integrateScript: (data) => api.post('/api/ai/integrate-script', data, { timeout: 180000 }),
  generateCharacterGraph: (data) => api.post('/api/ai/generate-character-graph', data, { timeout: 120000 }),
  // 新增：角色知识图谱整合
  integrateCharacterGraph: (data) => api.post('/api/ai/integrate-character-graph', data, { timeout: 300000 }), // 增加到5分钟

  getTaskStatus: (taskId) => api.get(`/api/ai/task/${taskId}`),
  cancelTask: (taskId) => api.post(`/api/ai/task/${taskId}/cancel`),
  pauseTask: (taskId) => api.post(`/api/ai/task/${taskId}/pause`),
  resumeTask: (taskId) => api.post(`/api/ai/task/${taskId}/resume`),
  getProjectTasks: (projectId) => api.get(`/api/ai/project/${projectId}/tasks`),
  // 新增：根据任务类型获取AI任务
  getTasksByType: (projectId, taskType) => api.get(`/api/ai/tasks/${projectId}/${taskType}`),
  // 新增：根据任务类型删除AI任务
  deleteTasksByType: (projectId, taskType) => api.delete(`/api/ai/tasks/${projectId}/${taskType}`),
  // 新增：获取文件的特定类型分析结果
  getFileResult: (fileId, taskType) => api.get(`/api/ai/file/${fileId}/result/${taskType}`),
  // 新增：更新文件的特定类型分析结果
  updateFileResult: (fileId, taskType, result) => api.put(`/api/ai/file/${fileId}/result/${taskType}`, { result }),
  // 新增：获取项目的角色知识图谱整合结果
  getCharacterIntegrationResult: (projectId) => api.get(`/api/ai/project/${projectId}/character-integration`),
  // 新增：更新项目的角色知识图谱整合结果
  updateCharacterIntegrationResult: (projectId, result) => api.put(`/api/ai/project/${projectId}/character-integration`, { result }),
  // 新增：保存全局角色图谱
  saveGlobalCharacterContent: (projectId, content) => api.put(`/api/ai/project/${projectId}/global-character-content`, { content }),
  // 新增：获取全局角色图谱
  getGlobalCharacterContent: (projectId) => api.get(`/api/ai/project/${projectId}/global-character-content`)
}

// 单元剧本相关API
export const scriptUnitsAPI = {
  // 获取项目的所有单元
  getUnits: (projectId) => api.get(`/api/script-units/${projectId}`),
  // 创建新单元
  createUnit: (projectId, data) => api.post(`/api/script-units/${projectId}`, data),
  // 更新单元
  updateUnit: (unitId, data) => api.put(`/api/script-units/${unitId}`, data),
  // 删除单元
  deleteUnit: (unitId) => api.delete(`/api/script-units/${unitId}`),
  // 单元剧本整合（旧接口，保持兼容性）
  integrateUnit: (unitId, data) => api.post(`/api/script-units/${unitId}/integrate`, data, { timeout: 180000 }),
  
  // 新增：三步工作流接口
  // 重置单元工作流
  resetWorkflow: (unitId) => api.post(`/api/script-units/${unitId}/reset-workflow`),
  // 步骤1：选择素材
  executeStep1: (unitId, data) => api.post(`/api/script-units/${unitId}/step1`, data),
  // 步骤2：内容整合
  executeStep2: (unitId, data) => api.post(`/api/script-units/${unitId}/step2`, data, { timeout: 180000 }),
  // 步骤3：添加角色图谱
  executeStep3CharacterGraph: (unitId, data) => api.post(`/api/script-units/${unitId}/step3-character-graph`, data),
  // 获取项目的角色整合结果列表
  getCharacterIntegrations: (unitId) => api.get(`/api/script-units/${unitId}/character-integrations`),
  // 步骤4：角色整合
  executeStep4: (unitId, data) => api.post(`/api/script-units/${unitId}/step4`, data, { timeout: 180000 })
}

// 完整剧本相关API
export const fullScriptsAPI = {
  // 获取项目的完整剧本
  getFullScript: (projectId) => api.get(`/api/full-scripts/${projectId}`),
  // 创建新的完整剧本工作流
  createFullScript: (projectId, data) => api.post(`/api/full-scripts/${projectId}`, data),
  // 步骤1：单元剧本拼接
  executeStep1: (scriptId, data) => api.put(`/api/full-scripts/${scriptId}/step1`, data),
    // 一键拼接：直接持久化拼接结果
    quickConcat: (scriptId, content) => api.put(`/api/full-scripts/${scriptId}/quick-concat`, { content }),
  // 步骤2：全剧本审核
  executeStep2: (scriptId, data) => api.put(`/api/full-scripts/${scriptId}/step2`, data),
  // 保存步骤2审核内容草稿（允许空内容）
  saveStep2Draft: (scriptId, reviewedContent) => api.put(`/api/full-scripts/${scriptId}/reviewed-draft`, { reviewedContent }),
  // 步骤3：知识库存档
  executeStep3: (scriptId, data) => api.put(`/api/full-scripts/${scriptId}/step3`, data),
  // 删除完整剧本
  deleteFullScript: (scriptId) => api.delete(`/api/full-scripts/${scriptId}`)
}

// 知识库相关API
export const knowledgeBaseAPI = {
  getAll: (tagIds) => {
    let url = '/api/knowledge-base';
    if (tagIds && tagIds.length > 0) {
      url += `?tagIds=${tagIds.join(',')}`;
    }
    return api.get(url);
  },
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/api/knowledge-base/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  delete: (id) => api.delete(`/api/knowledge-base/${id}`),
  archive: (data) => api.post('/api/knowledge-base/archive', data),
  getPreview: (id) => api.get(`/api/knowledge-base/${id}/preview`),
  getContent: (id) => api.get(`/api/knowledge-base/${id}/content`),
  updateContent: (id, content) => api.put(`/api/knowledge-base/${id}/content`, { content }),
  updateTitle: (id, title) => api.put(`/api/knowledge-base/${id}/title`, { title }),
  addTag: (id, tagId) => api.post(`/api/knowledge-base/${id}/tags`, { tagId }),
  removeTag: (id, tagId) => api.delete(`/api/knowledge-base/${id}/tags/${tagId}`),
  // 新增：检查文件完整性
  checkIntegrity: (id) => api.get(`/api/knowledge-base/${id}/check-integrity`),
  // 新增：从内容恢复文件
  restoreFromContent: (id, content) => api.post(`/api/knowledge-base/${id}/restore-from-content`, { content }),
}

// 标签相关API
export const tagsAPI = {
  getAll: () => api.get('/api/tags'),
  create: (data) => api.post('/api/tags', data),
  delete: (id) => api.delete(`/api/tags/${id}`),
}

// 队列管理相关API
export const queueAPI = {
  // 批量添加视频到解析队列
  addBatch: (data) => api.post('/api/queue/add-batch', data),
  // 获取队列状态
  getStatus: () => api.get('/api/queue/status'),
  // 从队列中移除任务
  removeTask: (taskId) => api.delete(`/api/queue/${taskId}`),
  // 重新加入队列（失败任务）
  retryTask: (taskId) => api.post(`/api/queue/${taskId}/retry`),
  // 暂停/恢复队列
  pauseQueue: (pause) => api.post('/api/queue/global/pause', { pause }),
  // 清空队列
  clearQueue: () => api.delete('/api/queue/clear'),
}

export default api
