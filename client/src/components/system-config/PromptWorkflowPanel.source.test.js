import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./PromptWorkflowPanel.jsx', import.meta.url), 'utf8')

describe('prompt workflow panel', () => {
  it('maps every active runtime step to its stored prompt', () => {
    for (const key of [
      'video_analysis_prompt',
      'character_knowledge_graph_prompt',
      'character_integration_prompt',
      'script_integration_prompt',
      'character_prompt',
    ]) {
      expect(source).toContain(key)
    }
  })

  it('does not present the unimplemented full review prompt as active', () => {
    expect(source).not.toContain('full_script_review_prompt')
    expect(source).toContain('全本通审尚未接入自动任务')
  })
})
