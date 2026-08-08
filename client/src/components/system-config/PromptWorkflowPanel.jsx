import React from 'react'
import { Alert, Button, Card, Tag, Typography } from 'antd'
import { EditOutlined, FileTextOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { Paragraph, Text } = Typography

export const PROMPT_STEPS = Object.freeze([
  {
    step: 'Step 1.1',
    title: '视频解析',
    key: 'video_analysis_prompt',
    engine: 'Gemini 视频服务',
    description: '逐集提取场景、角色、对白与动作，形成可追溯的拉片文本。',
  },
  {
    step: 'Step 1.2',
    title: '分集角色图谱',
    key: 'character_knowledge_graph_prompt',
    engine: 'Gemini 视频服务',
    description: '根据单集解析结果生成角色关系快照，不补写输入中不存在的信息。',
  },
  {
    step: 'Step 2',
    title: '全局角色图谱',
    key: 'character_integration_prompt',
    engine: 'Gemini 视频服务',
    description: '合并各集关系快照，统一角色身份与跨集关系。',
  },
  {
    step: 'Step 3.1',
    title: '内容整合',
    key: 'script_integration_prompt',
    engine: '文本生成路由',
    description: '合并分段剧本、去除重复内容，同时保留原始角色名。',
  },
  {
    step: 'Step 3.2',
    title: '角色整合',
    key: 'character_prompt',
    engine: '文本生成路由',
    description: '基于全局图谱统一角色指代，完成最终剧本角色校正。',
  },
])

const promptPreview = value => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  return normalized || '迁移尚未执行，当前没有可用提示词。'
}

const PromptWorkflowPanel = ({ configs, onEdit }) => (
  <section className="prompt-workflow-panel" aria-label="提示词工作流">
    <div className="config-section-heading">
      <div>
        <Text className="config-eyebrow">PROMPT WORKFLOW</Text>
        <h2>提示词工作流</h2>
        <Paragraph type="secondary">提示词与真实执行步骤一一对应，修改后会用于下一次新任务。</Paragraph>
      </div>
      <Tag color="blue">5 个已接入步骤</Tag>
    </div>

    <div className="prompt-step-grid">
      {PROMPT_STEPS.map(item => {
        const config = configs[item.key]
        const configured = Boolean(String(config?.value || '').trim())
        return (
          <Card className="prompt-step-card" key={item.key} bordered={false}>
            <div className="prompt-step-card__topline">
              <span className="pipeline-step-code">{item.step}</span>
              <Tag color={configured ? 'success' : 'warning'}>{configured ? '已接入' : '待迁移'}</Tag>
            </div>
            <div className="prompt-step-card__title">
              <FileTextOutlined />
              <strong>{item.title}</strong>
            </div>
            <Text type="secondary">{item.description}</Text>
            <div className="prompt-step-card__engine">执行服务：{item.engine}</div>
            <Paragraph className="prompt-step-card__preview" ellipsis={{ rows: 3 }}>
              {promptPreview(config?.value)}
            </Paragraph>
            <div className="prompt-step-card__footer">
              <Text type="secondary">
                {config?.updated_at ? `更新于 ${dayjs(config.updated_at).format('YYYY-MM-DD HH:mm')}` : '使用系统默认模板'}
              </Text>
              <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(item.key, config?.value || '')}>
                编辑提示词
              </Button>
            </div>
          </Card>
        )
      })}
    </div>

    <Alert
      showIcon
      type="info"
      message="全本通审尚未接入自动任务"
      description="你提供的 Step 4 提示词已完成适用性审查，但当前代码没有对应执行入口，因此本页不会把它展示为已生效配置。待增加全本通审功能时再单独接入。"
    />
  </section>
)

export default PromptWorkflowPanel
