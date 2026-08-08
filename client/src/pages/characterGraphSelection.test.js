import { describe, expect, it, vi } from 'vitest'

import { resolveCharacterEpisodeSegments } from './characterGraphSelection'

describe('step 3 character graph selection', () => {
  it('prefers structured per-file character graph segments returned by the API', () => {
    const parseFallback = vi.fn(() => [{ id: 'general', title: '通用内容', content: '旧整合结果' }])
    const segments = resolveCharacterEpisodeSegments({
      segments: [
        { id: 'episode_1', episode: 1, title: '第1集', content: '第一集角色图谱' },
        { id: 'episode_2', episode: 2, title: '第2集', content: '第二集角色图谱' },
      ],
      data: [{ content: '旧整合结果' }],
    }, parseFallback)

    expect(segments).toHaveLength(2)
    expect(segments.map(segment => segment.id)).toEqual(['episode_1', 'episode_2'])
    expect(parseFallback).not.toHaveBeenCalled()
  })

  it('falls back to the latest integration only when no per-file segments exist', () => {
    const parseFallback = vi.fn(() => [{ id: 'general', title: '通用内容', content: '全局图谱' }])
    const segments = resolveCharacterEpisodeSegments({ data: [{ content: '全局图谱' }] }, parseFallback)

    expect(parseFallback).toHaveBeenCalledWith('全局图谱')
    expect(segments).toEqual([{ id: 'general', title: '通用内容', content: '全局图谱' }])
  })
})
