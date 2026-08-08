import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve('src/pages/ProjectDetail.jsx'), 'utf8')

describe('ProjectDetail project prompt persistence', () => {
  it('loads the saved step 4 prompt from the database field returned by the API', () => {
    expect(source).toContain('project.character_prompt')
    expect(source).not.toContain('project.characterPrompt')
  })
})
