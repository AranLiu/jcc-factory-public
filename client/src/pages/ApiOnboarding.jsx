import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Select, Space, Spin, Tag, Typography, message } from 'antd'
import { ApiOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from '../services/router'
import { useAuth } from '../contexts/AuthContext'
import { aiProviderAPI } from '../services/api'
import { completeApiOnboarding, fetchApiOnboardingStatus } from '../services/apiOnboarding'
import {
  PROVIDER_PRESET_OPTIONS,
  getProviderPreset,
  inferProviderPreset,
} from '../config/providerPresets'
import shibaLogo from '../assets/shiba-logo.png.png'

const { Text, Title } = Typography

const parseModels = value => [...new Set(String(value || '').split(/[\n,]/).map(model => model.trim()).filter(Boolean))]

const ApiOnboarding = () => {
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const { markApiOnboardingComplete } = useAuth()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusError, setStatusError] = useState(false)
  const [savedProvider, setSavedProvider] = useState(null)
  const mountedRef = useRef(false)
  const presetId = Form.useWatch('presetId', form)
  const selectedPreset = getProviderPreset(presetId)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const finishOnboarding = useCallback(async (skipped) => {
    const completion = await completeApiOnboarding(skipped)
    if (!completion.completed || !mountedRef.current) return false
    markApiOnboardingComplete()
    navigate('/workspace', { replace: true })
    return true
  }, [markApiOnboardingComplete, navigate])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setStatusError(false)
    try {
      const nextStatus = await fetchApiOnboardingStatus()
      if (!mountedRef.current) return
      if (!nextStatus.required) {
        markApiOnboardingComplete()
        navigate('/workspace', { replace: true })
        return
      }

      const providerResponse = await aiProviderAPI.getAll()
      const existing = providerResponse.data?.providers?.[0] || null
      setSavedProvider(existing)
      setStatus(nextStatus)
      if (existing) {
        const preset = inferProviderPreset(existing)
        form.setFieldsValue({
          name: existing.name,
          presetId: preset?.id || 'custom',
          baseUrl: existing.baseUrl,
          apiKey: '',
          defaultModel: existing.defaultModel,
          modelsText: existing.models.join('\n'),
        })
      } else {
        const preset = getProviderPreset('gemini')
        const defaultModel = nextStatus.defaultModel || preset.defaultModel
        form.setFieldsValue({
          name: `${preset.label} 文本服务`,
          presetId: preset.id,
          baseUrl: preset.baseUrl,
          defaultModel,
          modelsText: defaultModel,
        })
      }
    } catch {
      if (mountedRef.current) setStatusError(true)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [form, markApiOnboardingComplete, navigate])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

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

  const onSaveAndTest = async values => {
    const models = parseModels(values.modelsText)
    if (!models.includes(values.defaultModel?.trim())) {
      message.error('模型列表必须包含默认模型')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        name: values.name,
        providerType: selectedPreset?.providerType || savedProvider?.providerType,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey || undefined,
        defaultModel: values.defaultModel,
        models,
        enabled: true,
      }
      const response = savedProvider
        ? await aiProviderAPI.updateProvider(savedProvider.id, payload)
        : await aiProviderAPI.createProvider(payload)
      const provider = response.data
      setSavedProvider(provider)
      await aiProviderAPI.testProvider(provider.id)
      await aiProviderAPI.setScriptIntegrationRoute(provider.id, provider.defaultModel)
      if (!mountedRef.current) return
      const completed = await finishOnboarding(false)
      if (completed) message.success('AI 服务商已保存，连接测试通过')
    } catch (error) {
      if (mountedRef.current) message.error(error.response?.data?.message || '无法保存或测试 AI 服务商，请检查后重试')
    } finally {
      if (mountedRef.current) {
        form.setFieldValue('apiKey', '')
        setSubmitting(false)
      }
    }
  }

  const onRetry = async () => {
    if (!savedProvider) return
    setSubmitting(true)
    try {
      await aiProviderAPI.testProvider(savedProvider.id)
      await aiProviderAPI.setScriptIntegrationRoute(savedProvider.id, savedProvider.defaultModel)
      if (!mountedRef.current) return
      const completed = await finishOnboarding(false)
      if (completed) message.success('连接测试通过')
    } catch (error) {
      if (mountedRef.current) message.error(error.response?.data?.message || '连接测试失败，可修改配置或稍后再设置')
    } finally {
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const onSkip = async () => {
    setSubmitting(true)
    try {
      const completed = await finishOnboarding(true)
      if (completed) message.info('已跳过 API 设置，可稍后在系统配置中完成')
    } catch {
      if (mountedRef.current) message.error('无法保存设置选择，请重试')
    } finally {
      if (mountedRef.current) setSubmitting(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-form" style={{ maxWidth: 560 }}>
        <div className="logo-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <img src={shibaLogo} alt="JCC Factory logo" style={{ width: 43, marginRight: 13 }} />
            <h1 className="logo-title" style={{ margin: 0, fontSize: 27 }}>JCC Factory</h1>
          </div>
          <p className="logo-subtitle" style={{ marginBottom: 12 }}>管理员初始化</p>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Tag color="blue">第 2 步，共 2 步</Tag>
          <Title level={3} style={{ marginTop: 12, marginBottom: 4 }}><ApiOutlined /> 配置 AI 服务商</Title>
          <Text type="secondary">密钥只发送到服务端并加密保存，不会保存在当前浏览器中。</Text>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : statusError ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert type="error" showIcon message="无法确认 API 设置状态" />
            <Button type="primary" onClick={loadStatus}>重新检查</Button>
          </Space>
        ) : (
          <Form form={form} layout="vertical" onFinish={onSaveAndTest} autoComplete="off" size="large">
            {status?.managedByEnvironment && (
              <Alert type="success" showIcon icon={<CheckCircleOutlined />} message="Gemini API 密钥由运行环境管理" style={{ marginBottom: 16 }} />
            )}
            <Alert
              type="warning"
              showIcon
              message="视频解析目前仍需 Gemini"
              description="本页配置的 Gemini、OpenAI 或 OpenAI-compatible 服务用于剧本整合。短剧视频解析仍需在系统配置中设置 Gemini 视频 API。"
              style={{ marginBottom: 20 }}
            />

            <Form.Item name="presetId" label="服务商" rules={[{ required: true, message: '请选择服务商' }]}>
              <Select options={PROVIDER_PRESET_OPTIONS} onChange={handlePresetChange} disabled={Boolean(savedProvider)} />
            </Form.Item>
            <Form.Item name="name" label="显示名称" rules={[{ required: true, whitespace: true, message: '请输入显示名称' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="baseUrl" label="API Base URL" rules={[{ required: true, whitespace: true, message: '请输入 API Base URL' }]} extra={selectedPreset?.notice}>
              <Input disabled={selectedPreset?.endpointMode !== 'editable'} />
            </Form.Item>
            <Form.Item
              name="apiKey"
              label="API 密钥"
              rules={savedProvider ? [] : [{ required: true, whitespace: true, message: '请输入 API 密钥' }]}
              extra={savedProvider ? '留空表示保留已保存的密钥。' : '保存后不会回显完整密钥。'}
            >
              <Input.Password autoComplete="new-password" placeholder={savedProvider ? '留空以保留当前密钥' : '输入 API 密钥'} />
            </Form.Item>
            <Form.Item name="defaultModel" label="默认模型" rules={[{ required: true, whitespace: true, message: '请输入默认模型' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="modelsText" label="可用模型" rules={[{ required: true, whitespace: true, message: '请输入至少一个模型' }]} extra="每行一个模型，也可用逗号分隔。">
              <Input.TextArea rows={3} />
            </Form.Item>

            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Button type="primary" htmlType="submit" block loading={submitting}>保存并测试</Button>
              <Button icon={<ReloadOutlined />} block onClick={onRetry} disabled={submitting || !savedProvider}>重新测试连接</Button>
              <Button type="link" block onClick={onSkip} disabled={submitting}>稍后配置</Button>
            </Space>
          </Form>
        )}
      </div>
    </div>
  )
}

export default ApiOnboarding
