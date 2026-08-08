const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildCharacterGraphSegments,
  getStep3CharacterSources,
} = require('../services/characterGraphSelection')

test('character graph segments keep the latest completed result for each file and sort by episode', () => {
  const segments = buildCharacterGraphSegments([
    { id: 14, file_id: 16, original_name: '5.mp4', result: '第五集角色图谱', created_at: '2026-08-07T05:33:52Z' },
    { id: 13, file_id: 8, original_name: '1.mp4', result: '第一集角色图谱', created_at: '2026-08-07T05:33:47Z' },
    { id: 9, file_id: 8, original_name: '1.mp4', result: '旧结果', created_at: '2026-08-06T05:33:47Z' },
    { id: 12, file_id: 7, original_name: '第2集.mp4', result: '第二集角色图谱', created_at: '2026-08-07T05:33:48Z' },
    { id: 11, file_id: 99, original_name: '花絮.mp4', result: '   ', created_at: '2026-08-07T05:33:48Z' },
  ])

  assert.deepEqual(segments.map(segment => ({ id: segment.id, episode: segment.episode, title: segment.title, content: segment.content })), [
    { id: 'episode_1', episode: 1, title: '第1集', content: '第一集角色图谱' },
    { id: 'episode_2', episode: 2, title: '第2集', content: '第二集角色图谱' },
    { id: 'episode_5', episode: 5, title: '第5集', content: '第五集角色图谱' },
  ])
})

test('step3 sources use completed_at and return both integrations and per-file segments', async () => {
  const calls = []
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params })
      if (calls.length === 1) {
        return [[{
          id: 31,
          result: '全局角色图谱',
          created_at: '2026-08-07T06:00:00Z',
          completed_at: '2026-08-07T06:01:00Z',
          task_type: 'character_integration',
        }]]
      }
      return [[{
        id: 14,
        file_id: 8,
        original_name: '1.mp4',
        result: '第一集角色图谱',
        created_at: '2026-08-07T05:33:47Z',
      }]]
    },
  }

  const result = await getStep3CharacterSources(pool, 2)

  assert.equal(calls.length, 2)
  assert.doesNotMatch(calls[0].sql, /\bupdated_at\b/i)
  assert.match(calls[0].sql, /\bcompleted_at\b/i)
  assert.deepEqual(calls[0].params, [2])
  assert.equal(result.integrations[0].updatedAt, '2026-08-07T06:01:00Z')
  assert.equal(result.segments[0].id, 'episode_1')
})
