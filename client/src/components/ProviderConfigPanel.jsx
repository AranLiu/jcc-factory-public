import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ApiOutlined,
  CheckCircleOutlined,
  EditOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { aiProviderAPI } from '../services/api'
import {
  PROVIDER_PRESET_OPTIONS,
  getProviderPreset,
  inferProviderPreset,
} from '../config/providerPresets'

const { Paragraph, Text, Title } = Typography
const { TextArea } = Input

const providerLabel = provider => inferProviderPreset(provider)?.label || provider.providerType

function parseModels(value) {
  return [...new Set(String(value || '').split(/[\n,]/).map(model => model.trim()).filter(Boolean))]
}

const ProviderConfigPanel = () => {
  const [form] = Form.useForm()
  const [routeForm] = Form.useForm()
  const [providers, setProviders] = useState([])
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [editingProvider, setEditingProvider] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const presetId = Form.useWatch('presetId', form)
  const selectedPreset = getProviderPreset(presetId)
  const selectedRouteProviderId = Form.useWatch('providerId', routeForm)

  const selectedRouteProvider = useMemo(
    () => providers.find(provider => provider.id === selectedRouteProviderId),
    [providers, selectedRouteProviderId]
  )
  const routeNeedsAttention = Boolean(
    route?.provider && (
      !route.provider.enabled ||
      !route.provider.models?.includes(route.model)
    )
  )

  const loadProviders = async () => {
    setLoading(true)
    try {
      const response = await aiProviderAPI.getAll()
      const data = response.data || {}
      const nextProviders = Array.isArray(data.providers) ? data.providers : []
      const nextRoute = data.routes?.scriptIntegration || null
      setProviders(nextProviders)
      setRoute(nextRoute)
      routeForm.setFieldsValue({
        providerId: nextRoute?.provider?.id,
        model: nextRoute?.model,
      })
    } catch (error) {
      message.error(error.response?.data?.message || '加载 AI 服务商失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProviders()
  }, [])

  const openCreate = () => {
    setEditingProvider(null)
    form.resetFields()
    handlePresetChange('openai')
    form.setFieldValue('enabled', true)
    setModalOpen(true)
  }

  const openEdit = provider => {
    setEditingProvider(provider)
    form.resetFields()
    const preset = inferProviderPreset(provider)
    form.setFieldsValue({
      name: provider.name,
      presetId: preset?.id || 'custom',
      baseUrl: provider.baseUrl,
      apiKey: '',
      defaultModel: provider.defaultModel,
      modelsText: provider.models.join('\n'),
      enabled: provider.enabled,
    })
    setModalOpen(true)
  }

  const handlePresetChange = presetId => {
    const preset = getProviderPreset(presetId)
    if (!preset) return
    form.setFieldsValue({
      presetId,
      name: preset.id === 'custom' ? '' : `${preset.label} 文本服务`,
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      modelsText: preset.models.join('\n'),
    })
  }

  const saveProvider = async values => {
    const models = parseModels(values.modelsText)
    if (!models.includes(values.defaultModel?.trim())) {
      message.error('模型列表必须包含默认模型')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: values.name,
        providerType: selectedPreset?.providerType || editingProvider?.providerType,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey || undefined,
        defaultModel: values.defaultModel,
        models,
        enabled: values.enabled,
      }
      if (editingProvider) await aiProviderAPI.updateProvider(editingProvider.id, payload)
      else await aiProviderAPI.createProvider(payload)
      form.setFieldValue('apiKey', '')
      setModalOpen(false)
      message.success(editingProvider ? 'AI 服务商已更新' : 'AI 服务商已添加')
      await loadProviders()
    } catch (error) {
      form.setFieldValue('apiKey', '')
      message.error(error.response?.data?.message || '保存 AI 服务商失败')
    } finally {
      setSaving(false)
    }
  }

  const testProvider = async provider => {
    setTestingId(provider.id)
    try {
      await aiProviderAPI.testProvider(provider.id)
      message.success(`${provider.name} 连接测试通过`)
      await loadProviders()
    } catch (error) {
      message.error(error.response?.data?.message || `${provider.name} 连接测试失败`)
    } finally {
      setTestingId(null)
    }
  }

  const saveRoute = async values => {
    try {
      await aiProviderAPI.setScriptIntegrationRoute(values.providerId, values.model)
      message.success('剧本整合服务已更新')
      await loadProviders()
    } catch (error) {
      message.error(error.response?.data?.message || '更新剧本整合服务失败')
    }
  }

  return (
    <Card
      loading={loading}
      title={
        <Space>
          <SafetyCertificateOutlined />
          <span>文本生成服务</span>
          <Tag color="blue">Step 3.1 / 3.2</Tag>
        </Space>
      }
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加服务商</Button>}
      style={{ marginBottom: 24 }}
    >
      <Alert
        showIcon
        type="info"
        message="文本生成服务与任务路由"
        description="可直接选择常用国内外厂商，兼容服务仍会保存为受约束的 OpenAI 兼容协议。这里负责 Step 3.1 与 Step 3.2；连接失败时不会静默切换厂商。"
        style={{ marginBottom: 20 }}
      />

      {providers.length === 0 ? (
        <Empty description="尚未添加文本生成服务商">
          <Button icon={<PlusOutlined />} onClick={openCreate}>添加第一个服务商</Button>
        </Empty>
      ) : (
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          {providers.map(provider => (
            <Col span={8} key={provider.id}>
              <Card size="small" style={{ height: '100%', borderColor: route?.provider?.id === provider.id ? '#1677ff' : undefined }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <ApiOutlined />
                      <Text strong>{provider.name}</Text>
                    </Space>
                    <Tag color={provider.enabled ? 'green' : 'default'}>{provider.enabled ? '已启用' : '已停用'}</Tag>
                  </div>
                  <Text type="secondary">{providerLabel(provider)} · {provider.defaultModel}</Text>
                  <Space wrap>
                    <Tag>剧本整合</Tag>
                    {provider.lastTestStatus === 'success' && <Tag icon={<CheckCircleOutlined />} color="success">测试通过</Tag>}
                    {provider.apiKeyConfigured && <Tag color="processing">密钥已配置</Tag>}
                  </Space>
                  <Space>
                    <Button size="small" loading={testingId === provider.id} onClick={() => testProvider(provider)}>测试连接</Button>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(provider)}>编辑</Button>
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Card size="small" title="文本生成任务路由" styles={{ body: { paddingBottom: 8 } }}>
        {routeNeedsAttention && (
          <Alert
            type="warning"
            showIcon
            message="当前剧本整合路由不可用"
            description="当前服务商已停用或模型已被移出可用列表。请重新启用服务商，或选择新的服务商和模型后保存。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Form form={routeForm} layout="inline" onFinish={saveRoute}>
          <Form.Item name="providerId" label="服务商" rules={[{ required: true, message: '请选择服务商' }]}>
            <Select
              style={{ width: 240 }}
              placeholder="选择已启用的服务商"
              options={providers.map(provider => ({ value: provider.id, label: provider.name, disabled: !provider.enabled }))}
              onChange={() => routeForm.setFieldValue('model', undefined)}
            />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true, message: '请选择模型' }]}>
            <Select style={{ width: 220 }} placeholder="选择模型" options={(selectedRouteProvider?.models || []).map(model => ({ value: model, label: model }))} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存路由</Button>
          </Form.Item>
        </Form>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          已配置路由时请求只会发送到所选服务；若调用失败，系统会直接报错，不会静默转发到其他厂商。
        </Paragraph>
      </Card>

      <Modal
        title={editingProvider ? '编辑 AI 服务商' : '添加 AI 服务商'}
        open={modalOpen}
        onCancel={() => { form.setFieldValue('apiKey', ''); setModalOpen(false) }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={720}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={saveProvider} autoComplete="off">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="显示名称" rules={[{ required: true, whitespace: true, message: '请输入显示名称' }]}>
                <Input placeholder="例如：OpenAI 主账号" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="presetId" label="服务商" rules={[{ required: true, message: '请选择服务商' }]}>
                <Select options={PROVIDER_PRESET_OPTIONS} onChange={handlePresetChange} disabled={Boolean(editingProvider)} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="baseUrl"
            label="API Base URL"
            rules={[{ required: true, whitespace: true, message: '请输入 API Base URL' }]}
            extra={selectedPreset?.notice || (selectedPreset?.endpointMode === 'editable' ? '远程地址必须使用 HTTPS；本机开发可使用 localhost 或 127.0.0.1 的 HTTP。' : '原生服务使用固定官方地址，避免凭据发送到非官方端点。')}
          >
            <Input disabled={selectedPreset?.endpointMode !== 'editable'} />
          </Form.Item>

          <Form.Item
            name="apiKey"
            label="API 密钥"
            rules={editingProvider ? [] : [{ required: true, whitespace: true, message: '请输入 API 密钥' }]}
            extra={editingProvider ? '密钥只写不回显；留空表示保留当前密钥。' : '保存后不会再次显示完整密钥。'}
          >
            <Input.Password autoComplete="new-password" placeholder={editingProvider ? '留空以保留当前密钥' : '输入 API 密钥'} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="defaultModel" label="默认模型" rules={[{ required: true, whitespace: true, message: '请输入默认模型' }]}>
                <Input placeholder="模型标识" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enabled" label="启用状态" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="modelsText" label="可用模型" rules={[{ required: true, whitespace: true, message: '请输入至少一个模型' }]} extra="每行一个模型，也可使用逗号分隔。">
            <TextArea rows={4} placeholder="gpt-5.6-terra" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

export default ProviderConfigPanel
