const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildCharacterIndexes,
  chooseCharacterCandidate,
  isPlaceholderName,
  normalizeIdentityLabel,
  parseEvidenceJson,
} = require('../services/characterRegistryService')

test('character registry normalizes safe identity labels without merging generic family titles', () => {
  assert.equal(normalizeIdentityLabel('  [顾 总]  '), '顾总')
  assert.equal(normalizeIdentityLabel('ＧＵ总'), 'gu总')
  assert.equal(normalizeIdentityLabel(''), '')
  assert.equal(isPlaceholderName('[黑衣男人]'), true)
  assert.equal(isPlaceholderName('待识别角色 8-1'), true)
  assert.equal(isPlaceholderName('顾霆琛'), false)
})

test('character registry treats corrupt stored evidence as empty instead of failing the whole page', () => {
  assert.deepEqual(parseEvidenceJson('[{"scene":"1-1"}]'), [{ scene: '1-1' }])
  assert.deepEqual(parseEvidenceJson('{not-json'), [])
  assert.deepEqual(parseEvidenceJson(null), [])
})

test('character registry prefers a confident valid model match then exact canonical names', () => {
  const characters = [
    { id: 1, public_id: 'char_gu', canonical_name: '顾霆琛', normalized_name: '顾霆琛' },
    { id: 2, public_id: 'char_si', canonical_name: '司念', normalized_name: '司念' },
  ]
  const indexes = buildCharacterIndexes(characters, [
    { character_id: 1, normalized_alias: '顾总' },
  ])

  assert.equal(chooseCharacterCandidate({ matchedCharacterId: 'char_si', confidence: 0.91 }, indexes).id, 2)
  assert.equal(chooseCharacterCandidate({ canonicalName: '顾霆琛', nameExplicit: true, confidence: 0.8 }, indexes).id, 1)
  assert.equal(chooseCharacterCandidate({ aliases: ['顾总'], confidence: 0.85 }, indexes).id, 1)
})

test('character registry keeps low-confidence and generic aliases unresolved', () => {
  const characters = [
    { id: 1, public_id: 'char_gu', canonical_name: '顾霆琛', normalized_name: '顾霆琛' },
    { id: 2, public_id: 'char_si', canonical_name: '司念', normalized_name: '司念' },
  ]
  const indexes = buildCharacterIndexes(characters, [
    { character_id: 1, normalized_alias: '妈妈' },
    { character_id: 2, normalized_alias: '妈妈' },
  ])

  assert.equal(chooseCharacterCandidate({ matchedCharacterId: 'char_gu', confidence: 0.4 }, indexes), null)
  assert.equal(chooseCharacterCandidate({ canonicalName: '顾霆琛', nameExplicit: true, confidence: 0.4 }, indexes), null)
  assert.equal(chooseCharacterCandidate({ aliases: ['妈妈'], confidence: 0.99 }, indexes), null)
  assert.equal(chooseCharacterCandidate({ canonicalName: '陌生人', confidence: 0.99 }, indexes), null)
})
