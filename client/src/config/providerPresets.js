export const PROVIDER_PRESETS = Object.freeze([
  {
    id: 'openai',
    region: 'international',
    label: 'OpenAI',
    providerType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-terra',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    endpointMode: 'fixed',
    protocolLabel: '原生 Responses API',
  },
  {
    id: 'gemini',
    region: 'international',
    label: 'Google Gemini',
    providerType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.6-flash',
    models: ['gemini-3.6-flash'],
    endpointMode: 'fixed',
    protocolLabel: '原生 Gemini API',
  },
  {
    id: 'mistral',
    region: 'international',
    label: 'Mistral AI',
    providerType: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-small-latest'],
    endpointMode: 'editable',
    protocolLabel: 'OpenAI 兼容',
  },
  {
    id: 'deepseek',
    region: 'domestic',
    label: 'DeepSeek',
    providerType: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    endpointMode: 'editable',
    protocolLabel: 'OpenAI 兼容',
  },
  {
    id: 'qwen_bailian',
    region: 'domestic',
    label: '阿里云百炼 / 通义千问',
    providerType: 'openai_compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.7-plus',
    models: ['qwen3.7-plus', 'qwen3.7-max'],
    endpointMode: 'editable',
    protocolLabel: 'OpenAI 兼容',
    notice: 'API Key、地域和计费方案必须匹配；生产环境建议替换为业务空间专属地址。',
  },
  {
    id: 'zhipu_glm',
    region: 'domestic',
    label: '智谱 GLM',
    providerType: 'openai_compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.2',
    models: ['glm-5.2'],
    endpointMode: 'editable',
    protocolLabel: 'OpenAI 兼容',
  },
  {
    id: 'volcengine_ark',
    region: 'domestic',
    label: '火山方舟 / 豆包',
    providerType: 'openai_compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-0-lite-260215',
    models: ['doubao-seed-2-0-lite-260215'],
    endpointMode: 'editable',
    protocolLabel: 'OpenAI 兼容',
    notice: '也可填写方舟控制台创建的推理接入点 ID。',
  },
  {
    id: 'ollama',
    region: 'local',
    label: 'Ollama（本机）',
    providerType: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    models: ['llama3.2'],
    endpointMode: 'editable',
    protocolLabel: '本机 OpenAI 兼容',
    notice: '请先在本机安装并拉取同名模型；API 密钥可填写 ollama。',
  },
  {
    id: 'custom',
    region: 'local',
    label: '自定义 OpenAI 兼容服务',
    providerType: 'openai_compatible',
    baseUrl: '',
    defaultModel: '',
    models: [],
    endpointMode: 'editable',
    protocolLabel: 'OpenAI 兼容',
  },
])

const REGION_LABELS = Object.freeze({
  international: '国际服务',
  domestic: '国内服务',
  local: '本机与自定义',
})

export const PROVIDER_PRESET_OPTIONS = Object.entries(REGION_LABELS).map(([region, label]) => ({
  label,
  options: PROVIDER_PRESETS
    .filter(preset => preset.region === region)
    .map(preset => ({ value: preset.id, label: `${preset.label} · ${preset.protocolLabel}` })),
}))

export const getProviderPreset = id => PROVIDER_PRESETS.find(preset => preset.id === id) || null

export const inferProviderPreset = provider => {
  if (!provider) return null
  return PROVIDER_PRESETS.find(preset => (
    preset.providerType === provider.providerType
    && preset.baseUrl
    && preset.baseUrl.replace(/\/+$/, '') === String(provider.baseUrl || '').replace(/\/+$/, '')
  )) || getProviderPreset(provider.providerType) || getProviderPreset('custom')
}
