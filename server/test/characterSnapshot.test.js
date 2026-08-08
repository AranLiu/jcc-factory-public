const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CHARACTER_DATA_MARKERS,
  buildCharacterAwarePrompt,
  parseCharacterAwareResult,
} = require('../services/characterSnapshot')

test('character snapshot parser preserves a plain script when no structured block exists', () => {
  const result = parseCharacterAwareResult('第1集\n\n**1-1 日 内 客厅**')

  assert.equal(result.scriptText, '第1集\n\n**1-1 日 内 客厅**')
  assert.equal(result.snapshot, null)
  assert.equal(result.warning, null)
})

test('character snapshot parser removes and bounds a valid machine-readable block', () => {
  const payload = {
    episode: 8,
    characters: [{
      localId: 'lead-1',
      matchedCharacterId: 'char_existing',
      canonicalName: '顾霆琛',
      nameExplicit: true,
      aliases: ['顾总', '司念丈夫'],
      visualDescription: '黑色西装、短发',
      roleDescription: '司念的丈夫',
      confidence: 0.94,
      evidence: [{ scene: '8-2', detail: '司念称其为顾总' }],
    }],
    relationships: [{
      sourceLocalId: 'lead-1',
      targetLocalId: 'lead-2',
      relationshipType: '夫妻',
      confidence: 0.9,
      evidence: '第8场明确称呼',
    }],
  }
  const text = [
    '第8集\n\n**8-1 夜 内 客厅**',
    CHARACTER_DATA_MARKERS.start,
    JSON.stringify(payload),
    CHARACTER_DATA_MARKERS.end,
  ].join('\n')

  const result = parseCharacterAwareResult(text)

  assert.equal(result.scriptText, '第8集\n\n**8-1 夜 内 客厅**')
  assert.equal(result.snapshot.episode, 8)
  assert.deepEqual(result.snapshot.characters[0], payload.characters[0])
  assert.deepEqual(result.snapshot.relationships[0], payload.relationships[0])
  assert.equal(result.warning, null)
})

test('character snapshot parser fails open to script text when JSON is malformed', () => {
  const text = [
    '第3集正文',
    CHARACTER_DATA_MARKERS.start,
    '{bad json',
    CHARACTER_DATA_MARKERS.end,
  ].join('\n')

  const result = parseCharacterAwareResult(text)

  assert.equal(result.scriptText, '第3集正文')
  assert.equal(result.snapshot, null)
  assert.equal(result.warning, 'character_snapshot_invalid')
})

test('character-aware prompt includes only bounded public registry context', () => {
  const registry = Array.from({ length: 60 }, (_, index) => ({
    publicId: `char_${index}`,
    canonicalName: `角色${index}`,
    aliases: Array.from({ length: 20 }, (_value, aliasIndex) => `别名${index}-${aliasIndex}`),
    roleDescription: `角色说明${index}`.repeat(120),
    visualDescription: `外观线索${index}`.repeat(120),
    secret: 'must-not-appear',
  }))

  const prompt = buildCharacterAwarePrompt('请解析视频。', registry)

  assert.match(prompt, /请解析视频。/)
  assert.match(prompt, /JCC_CHARACTER_DATA_START/)
  assert.match(prompt, /char_0/)
  assert.match(prompt, /char_23/)
  assert.doesNotMatch(prompt, /char_24/)
  assert.doesNotMatch(prompt, /char_59/)
  assert.doesNotMatch(prompt, /must-not-appear/)
  assert.doesNotMatch(prompt, /别名0-6/)
  assert.ok(prompt.length < 18_000, `prompt context was ${prompt.length} characters`)
})
