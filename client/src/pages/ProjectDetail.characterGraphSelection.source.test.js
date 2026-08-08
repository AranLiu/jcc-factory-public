import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve('src/pages/ProjectDetail.jsx'), 'utf8')

describe('ProjectDetail step 3 character graph loading', () => {
  it('uses structured graph segments and does not open an empty modal after a load failure', () => {
    expect(source).toContain('resolveCharacterEpisodeSegments')
    expect(source).toContain('const loaded = await loadCharacterIntegrations(activeUnitId)')
    expect(source).toContain('if (!loaded) return;')
    expect(source).toContain('角色图谱列表加载失败')
  })
})
