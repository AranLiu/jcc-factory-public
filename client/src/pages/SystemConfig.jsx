import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Input,
  Layout,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ApiOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  EditOutlined,
  GlobalOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useNavigate } from '../services/router'
import { useAuth } from '../contexts/AuthContext'
import { systemConfigAPI } from '../services/api'
import ProviderConfigPanel from '../components/ProviderConfigPanel'
import PromptWorkflowPanel from '../components/system-config/PromptWorkflowPanel'
import './SystemConfig.css'

const { Header, Content } = Layout
const { Paragraph, Text, Title } = Typography

const PIPELINE_STEPS = Object.freeze([
  ['Step 1.1', '视频解析', 'Gemini'],
  ['Step 1.2', '分集角色图谱', 'Gemini'],
  ['Step 2', '全局角色图谱', 'Gemini'],
  ['Step 3.1', '内容整合', '文本路由'],
  ['Step 3.2', '角色整合', '文本路由'],
])

const PROMPT_UPDATERS = Object.freeze({
  video_analysis_prompt: 'updateVideoAnalysisPrompt',
  character_knowledge_graph_prompt: 'updateCharacterKnowledgeGraphPrompt',
  character_integration_prompt: 'updateCharacterIntegrationPrompt',
  script_integration_prompt: 'updateScriptIntegrationPrompt',
  character_prompt: 'updateCharacterPrompt',
})

const PROMPT_TITLES = Object.freeze({
  video_analysis_prompt: 'Step 1.1 · 视频解析提示词',
  character_knowledge_graph_prompt: 'Step 1.2 · 分集角色图谱提示词',
  character_integration_prompt: 'Step 2 · 全局角色图谱提示词',
  script_integration_prompt: 'Step 3.1 · 内容整合提示词',
  character_prompt: 'Step 3.2 · 角色整合提示词',
})

const uniqueModels = value => [...new Set(String(value || '').split(/[\n,]/).map(item => item.trim()).filter(Boolean))]

const SystemConfig = () => {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [configs, setConfigs] = useState({})
  const [status, setStatus] = useState({})
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState({})
  const [geminiKeyOpen, setGeminiKeyOpen] = useState(false)
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('')
  const [modelsOpen, setModelsOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState({ defaultModel: '', modelsText: '' })
  const [relayDraft, setRelayDraft] = useState({ url: '', token: '' })
  const [saving, setSaving] = useState(false)
  const [promptModal, setPromptModal] = useState({ open: false, key: '', value: '' })

  const loadConfigs = useCallback(async () => {
    try {
      const response = await systemConfigAPI.getAllConfigs()
      const data = response.data || {}
      setConfigs(data)
      setRelayDraft(current => ({
        ...current,
        url: data.proxy_service_url?.value || '',
        token: '',
      }))
    } catch (error) {
      message.error(error.response?.data?.message || '无法加载系统配置')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role !== 'admin') {
      message.error('只有管理员可以访问系统配置')
      navigate('/')
      return
    }
    loadConfigs()
  }, [loadConfigs, navigate, user])

  const geminiModels = useMemo(() => configs.gemini_available_models?.value || [], [configs])
  const relayEnabled = configs.proxy_service_enabled?.value === true

  const testConnection = async type => {
    setTesting(current => ({ ...current, [type]: true }))
    try {
      const response = type === 'gemini' ? await systemConfigAPI.testGemini() : await systemConfigAPI.testProxy()
      const result = response.data || {}
      setStatus(current => ({ ...current, [type]: result }))
      if (result.success) message.success(type === 'gemini' ? 'Gemini 视频服务连接正常' : 'API 中继连接正常')
      else message.warning(result.message || '连接验证失败')
    } catch (error) {
      message.error(error.response?.data?.message || '连接验证失败')
    } finally {
      setTesting(current => ({ ...current, [type]: false }))
    }
  }

  const saveGeminiKey = async () => {
    if (!geminiKeyDraft.trim()) return
    setSaving(true)
    try {
      await systemConfigAPI.updateGeminiKey(geminiKeyDraft)
      setGeminiKeyOpen(false)
      message.success('Gemini API 密钥已更新')
      await loadConfigs()
    } catch (error) {
      message.error(error.response?.data?.message || '无法更新 Gemini API 密钥')
    } finally {
      setGeminiKeyDraft('')
      setSaving(false)
    }
  }

  const openModelEditor = () => {
    setModelDraft({
      defaultModel: configs.gemini_default_model?.value || '',
      modelsText: geminiModels.join('\n'),
    })
    setModelsOpen(true)
  }

  const saveModels = async () => {
    const models = uniqueModels(modelDraft.modelsText)
    const defaultModel = modelDraft.defaultModel.trim()
    if (!models.includes(defaultModel)) {
      message.error('可用模型列表必须包含默认模型')
      return
    }
    setSaving(true)
    try {
      await systemConfigAPI.updateModels(defaultModel, models)
      setModelsOpen(false)
      message.success('Gemini 视频模型已更新')
      await loadConfigs()
    } catch (error) {
      message.error(error.response?.data?.message || '无法更新 Gemini 模型')
    } finally {
      setSaving(false)
    }
  }

  const updateRelayEnabled = async enabled => {
    const persist = async () => {
      setSaving(true)
      try {
        await systemConfigAPI.setConfig('proxy_service_enabled', enabled)
        message.success(enabled ? 'API 中继已启用' : 'API 中继已关闭')
        await loadConfigs()
      } catch (error) {
        message.error(error.response?.data?.message || '无法更新 API 中继状态')
      } finally {
        setSaving(false)
      }
    }
    if (!enabled) return persist()
    Modal.confirm({
      title: '确认启用 API 中继？',
      content: '启用后，Gemini 视频数据会发送到你配置的中继地址。请确认你有权使用该服务，并已了解其数据处理与留存规则。',
      okText: '确认启用',
      cancelText: '取消',
      onOk: persist,
    })
  }

  const saveRelayField = async key => {
    const isSecret = key === 'proxy_service_auth_token'
    const value = isSecret ? relayDraft.token : relayDraft.url
    if (!value.trim()) return
    setSaving(true)
    try {
      await systemConfigAPI.setConfig(key, value)
      message.success(isSecret ? '中继认证密钥已更新' : '中继地址已更新')
      await loadConfigs()
    } catch (error) {
      message.error(error.response?.data?.message || '无法更新 API 中继配置')
    } finally {
      if (isSecret) setRelayDraft(current => ({ ...current, token: '' }))
      setSaving(false)
    }
  }

  const openPromptEditor = (key, value) => setPromptModal({ open: true, key, value })

  const savePrompt = async () => {
    const updater = PROMPT_UPDATERS[promptModal.key]
    if (!updater || !promptModal.value.trim()) return
    setSaving(true)
    try {
      await systemConfigAPI[updater](promptModal.value)
      setPromptModal({ open: false, key: '', value: '' })
      message.success('提示词已更新，将用于下一次新任务')
      await loadConfigs()
    } catch (error) {
      message.error(error.response?.data?.message || '无法更新提示词')
    } finally {
      setSaving(false)
    }
  }

  const geminiStatusTag = status.gemini?.success
    ? <Tag icon={<CheckCircleOutlined />} color="success">连接正常</Tag>
    : <Tag color="error">{status.gemini?.message || '未验证'}</Tag>

  const aiServices = (
    <div className="config-tab-panel">
      <Alert
        showIcon
        type="info"
        message="按任务选择服务，不再混用两套“模型配置”"
        description="视频解析与角色图谱使用 Gemini 视频服务；内容整合与角色整合使用下方文本生成路由。两类配置都在这里管理，但运行边界保持清晰。"
      />
      <Card className="gemini-video-card" bordered={false}>
        <div className="config-section-heading compact">
          <div>
            <Text className="config-eyebrow">VIDEO ENGINE</Text>
            <h2><CloudServerOutlined /> Gemini 视频解析服务</h2>
            <Paragraph type="secondary">负责 Step 1.1、Step 1.2 与 Step 2。</Paragraph>
          </div>
          <Space>{geminiStatusTag}<Button icon={<PlayCircleOutlined />} loading={testing.gemini} onClick={() => testConnection('gemini')}>测试连接</Button></Space>
        </div>
        <div className="service-summary-grid">
          <div className="service-summary-cell">
            <Text type="secondary">API 密钥</Text>
            <strong>{configs.gemini_api_key?.configured ? '已安全配置' : '尚未配置'}</strong>
            <Button type="link" onClick={() => setGeminiKeyOpen(true)}>替换密钥</Button>
          </div>
          <div className="service-summary-cell">
            <Text type="secondary">默认模型</Text>
            <strong>{configs.gemini_default_model?.value || '尚未配置'}</strong>
            <Button type="link" icon={<EditOutlined />} onClick={openModelEditor}>管理模型</Button>
          </div>
          <div className="service-summary-cell wide">
            <Text type="secondary">可用模型</Text>
            <Space wrap>{geminiModels.map(model => <Tag key={model}>{model}</Tag>)}</Space>
            {configs.gemini_api_key?.updated_by_name && (
              <Text type="secondary">{`最近由 ${configs.gemini_api_key.updated_by_name} 更新`}</Text>
            )}
          </div>
        </div>
      </Card>
      <ProviderConfigPanel />
    </div>
  )

  const advancedSettings = (
    <div className="config-tab-panel">
      <Card className="advanced-settings-card" bordered={false}>
        <div className="config-section-heading compact">
          <div>
            <Text className="config-eyebrow">NETWORK · OPTIONAL</Text>
            <h2><GlobalOutlined /> API 中继服务</h2>
            <Paragraph type="secondary">仅在 Gemini 官方接口不可直连且你拥有合规中继时使用；它不是 VPN。</Paragraph>
          </div>
          <Space><Text>{relayEnabled ? '已启用' : '已关闭'}</Text><Switch checked={relayEnabled} loading={saving} onChange={updateRelayEnabled} /></Space>
        </div>
        <Alert type="warning" showIcon message="中继会处理你的业务数据" description="启用前请确认服务商授权、隐私政策、数据跨境与内容合规要求。关闭中继后才能修改地址或认证密钥。" />
        <div className="relay-fields">
          <div>
            <Text strong>中继地址</Text>
            <Input value={relayDraft.url} disabled={relayEnabled} onChange={event => setRelayDraft(current => ({ ...current, url: event.target.value }))} placeholder="https://relay.example.com" />
            <Button disabled={relayEnabled || !relayDraft.url.trim()} loading={saving} onClick={() => saveRelayField('proxy_service_url')}>保存地址</Button>
          </div>
          <Divider type="vertical" />
          <div>
            <Text strong>认证密钥</Text>
            <Input.Password value={relayDraft.token} disabled={relayEnabled} autoComplete="new-password" onChange={event => setRelayDraft(current => ({ ...current, token: event.target.value }))} placeholder={configs.proxy_service_auth_token?.configured ? '已配置；输入新密钥可替换' : '输入认证密钥'} />
            <Button disabled={relayEnabled || !relayDraft.token.trim()} loading={saving} onClick={() => saveRelayField('proxy_service_auth_token')}>保存密钥</Button>
          </div>
        </div>
        <Button icon={<PlayCircleOutlined />} disabled={!relayEnabled} loading={testing.proxy} onClick={() => testConnection('proxy')}>测试中继连接</Button>
      </Card>
    </div>
  )

  if (loading) {
    return <div className="system-config-loading"><Spin size="large" /></div>
  }

  return (
    <Layout className="workspace-layout system-config-page">
      <Header className="workspace-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/workspace')}>返回工作台</Button>
          <span className="system-config-header-title">系统配置</span>
        </Space>
        <Space><Text>{user?.username}</Text><Button type="link" onClick={logout}>退出</Button></Space>
      </Header>

      <Content className="workspace-content system-config-content">
        <section className="system-config-hero">
          <div>
            <Text className="config-eyebrow">JCC FACTORY · CONTROL ROOM</Text>
            <Title level={2}><SettingOutlined /> AI 与工作流配置</Title>
            <Paragraph>围绕短剧拉片流水线配置服务、模型路由与提示词。每一项都能对应到真实运行步骤。</Paragraph>
          </div>
          <Button icon={<ReloadOutlined />} onClick={loadConfigs}>刷新配置</Button>
        </section>

        <section className="pipeline-rail" aria-label="拉片流水线">
          <div className="pipeline-rail__heading"><SafetyCertificateOutlined /><span>拉片流水线</span></div>
          <div className="pipeline-rail__steps">
            {PIPELINE_STEPS.map(([step, title, engine], index) => (
              <React.Fragment key={step}>
                <div className="pipeline-step">
                  <span className="pipeline-step-code">{step}</span>
                  <strong>{title}</strong>
                  <small>{engine}</small>
                </div>
                {index < PIPELINE_STEPS.length - 1 && <div className="pipeline-connector" />}
              </React.Fragment>
            ))}
          </div>
        </section>

        <Tabs
          className="system-config-tabs"
          defaultActiveKey="services"
          items={[
            { key: 'services', label: <span><ApiOutlined /> AI 服务</span>, children: aiServices },
            { key: 'prompts', label: <span><EditOutlined /> 提示词工作流</span>, children: <PromptWorkflowPanel configs={configs} onEdit={openPromptEditor} /> },
            { key: 'advanced', label: <span><GlobalOutlined /> 高级设置</span>, children: advancedSettings },
          ]}
        />
      </Content>

      <Modal title="替换 Gemini API 密钥" open={geminiKeyOpen} onCancel={() => { setGeminiKeyOpen(false); setGeminiKeyDraft('') }} onOk={saveGeminiKey} okButtonProps={{ disabled: !geminiKeyDraft.trim() }} confirmLoading={saving} destroyOnClose>
        <Alert type="info" showIcon message="密钥只写不回显" description="保存后浏览器会立即清空输入框，页面只显示是否已配置。" />
        <Input.Password className="modal-secret-input" value={geminiKeyDraft} autoComplete="new-password" onChange={event => setGeminiKeyDraft(event.target.value)} placeholder="输入新的 Gemini API 密钥" />
      </Modal>

      <Modal title="管理 Gemini 视频模型" open={modelsOpen} onCancel={() => setModelsOpen(false)} onOk={saveModels} confirmLoading={saving} destroyOnClose>
        <Space direction="vertical" size="middle" className="model-editor">
          <div><Text strong>默认模型</Text><Select value={modelDraft.defaultModel} options={uniqueModels(modelDraft.modelsText).map(model => ({ value: model, label: model }))} onChange={defaultModel => setModelDraft(current => ({ ...current, defaultModel }))} /></div>
          <div><Text strong>可用模型</Text><Input.TextArea rows={5} value={modelDraft.modelsText} onChange={event => setModelDraft(current => ({ ...current, modelsText: event.target.value }))} placeholder="每行一个模型名称" /></div>
        </Space>
      </Modal>

      <Modal title={PROMPT_TITLES[promptModal.key] || '编辑提示词'} open={promptModal.open} width={900} onCancel={() => setPromptModal({ open: false, key: '', value: '' })} onOk={savePrompt} confirmLoading={saving} okButtonProps={{ disabled: !promptModal.value.trim() }} destroyOnClose>
        <Alert type="info" showIcon message="只影响后续新任务" description="已完成或正在执行的任务不会被追溯修改。建议保留任务边界、输入约束和输出格式。" />
        <Input.TextArea className="prompt-editor" rows={18} showCount value={promptModal.value} onChange={event => setPromptModal(current => ({ ...current, value: event.target.value }))} />
      </Modal>
    </Layout>
  )
}

export default SystemConfig
