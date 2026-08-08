const CHARACTER_DATA_MARKERS = Object.freeze({
  start: '<!--JCC_CHARACTER_DATA_START-->',
  end: '<!--JCC_CHARACTER_DATA_END-->',
})

const MAX_JSON_BYTES = 64 * 1024
const MAX_REGISTRY_CHARACTERS = 24

function boundedText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength)
}

function boundedConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(1, number))
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map(item => ({
    scene: boundedText(item?.scene, 64),
    detail: boundedText(item?.detail, 500),
  })).filter(item => item.scene || item.detail)
}

function normalizeCharacter(value, index) {
  const aliases = Array.isArray(value?.aliases)
    ? [...new Set(value.aliases.map(alias => boundedText(alias, 80)).filter(Boolean))].slice(0, 12)
    : []
  return {
    localId: boundedText(value?.localId, 80) || `local_${index + 1}`,
    matchedCharacterId: boundedText(value?.matchedCharacterId, 80) || null,
    canonicalName: boundedText(value?.canonicalName, 120),
    nameExplicit: value?.nameExplicit === true,
    aliases,
    visualDescription: boundedText(value?.visualDescription, 500),
    roleDescription: boundedText(value?.roleDescription, 500),
    confidence: boundedConfidence(value?.confidence),
    evidence: normalizeEvidence(value?.evidence),
  }
}

function normalizeRelationship(value) {
  return {
    sourceLocalId: boundedText(value?.sourceLocalId, 80),
    targetLocalId: boundedText(value?.targetLocalId, 80),
    relationshipType: boundedText(value?.relationshipType, 120),
    confidence: boundedConfidence(value?.confidence),
    evidence: boundedText(value?.evidence, 500),
  }
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const episodeNumber = Number(value.episode)
  const characters = Array.isArray(value.characters)
    ? value.characters.slice(0, 80).map(normalizeCharacter)
    : []
  const relationships = Array.isArray(value.relationships)
    ? value.relationships.slice(0, 160).map(normalizeRelationship).filter(item => (
      item.sourceLocalId && item.targetLocalId && item.relationshipType
    ))
    : []
  return {
    episode: Number.isInteger(episodeNumber) && episodeNumber > 0 ? episodeNumber : null,
    characters,
    relationships,
  }
}

function stripMachineBlock(text, startIndex, endIndex) {
  return `${text.slice(0, startIndex)}${text.slice(endIndex + CHARACTER_DATA_MARKERS.end.length)}`.trim()
}

function parseCharacterAwareResult(value) {
  const text = String(value || '')
  const startIndex = text.lastIndexOf(CHARACTER_DATA_MARKERS.start)
  if (startIndex < 0) return { scriptText: text.trim(), snapshot: null, warning: null }

  const contentStart = startIndex + CHARACTER_DATA_MARKERS.start.length
  const endIndex = text.indexOf(CHARACTER_DATA_MARKERS.end, contentStart)
  if (endIndex < 0) {
    return {
      scriptText: text.slice(0, startIndex).trim(),
      snapshot: null,
      warning: 'character_snapshot_invalid',
    }
  }

  const scriptText = stripMachineBlock(text, startIndex, endIndex)
  const jsonText = text.slice(contentStart, endIndex).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!jsonText || Buffer.byteLength(jsonText, 'utf8') > MAX_JSON_BYTES) {
    return { scriptText, snapshot: null, warning: 'character_snapshot_invalid' }
  }

  try {
    const snapshot = normalizeSnapshot(JSON.parse(jsonText))
    if (!snapshot) throw new Error('Snapshot must be an object')
    return { scriptText, snapshot, warning: null }
  } catch {
    return { scriptText, snapshot: null, warning: 'character_snapshot_invalid' }
  }
}

function serializeRegistry(registry) {
  if (!Array.isArray(registry)) return []
  return registry.slice(0, MAX_REGISTRY_CHARACTERS).map(item => ({
    publicId: boundedText(item?.publicId, 80),
    canonicalName: boundedText(item?.canonicalName, 120),
    aliases: Array.isArray(item?.aliases)
      ? [...new Set(item.aliases.map(alias => boundedText(alias, 60)).filter(Boolean))].slice(0, 6)
      : [],
    visualDescription: boundedText(item?.visualDescription, 120),
    roleDescription: boundedText(item?.roleDescription, 120),
    lastSeenEpisode: Number.isInteger(Number(item?.lastSeenEpisode)) ? Number(item.lastSeenEpisode) : null,
  })).filter(item => item.publicId && item.canonicalName)
}

function buildCharacterAwarePrompt(basePrompt, registry = []) {
  const safeBasePrompt = String(basePrompt || '')
    .replaceAll(CHARACTER_DATA_MARKERS.start, '')
    .replaceAll(CHARACTER_DATA_MARKERS.end, '')
    .trim()
  const knownCharacters = serializeRegistry(registry)
  return `${safeBasePrompt}

## 自动角色连续性数据（系统附加要求）
在严格完成上述剧本正文之后，追加一个机器可读 JSON 区块。该区块不会展示给最终用户，也不得改变、缩写或包裹剧本正文。

已知角色档案：
${JSON.stringify(knownCharacters)}

角色识别规则：
1. 若画面中的人物与已知档案高度一致，matchedCharacterId 使用该档案的 publicId；不能可靠确认时必须为 null。
2. 只有视频、对白或字幕明确给出姓名时，nameExplicit 才能为 true；不要通过剧情猜姓名。
3. 未知人物使用本集稳定 localId，并保留客观外观描述，不能强行归并。
4. confidence 取 0 到 1；关系必须能在本集找到证据。
5. 不要在 JSON 区块之外解释这些数据。

严格追加以下结构：
${CHARACTER_DATA_MARKERS.start}
{"episode":null,"characters":[{"localId":"local_1","matchedCharacterId":null,"canonicalName":"","nameExplicit":false,"aliases":[],"visualDescription":"","roleDescription":"","confidence":0,"evidence":[{"scene":"[x]-1","detail":"可核验依据"}]}],"relationships":[{"sourceLocalId":"local_1","targetLocalId":"local_2","relationshipType":"","confidence":0,"evidence":"可核验依据"}]}
${CHARACTER_DATA_MARKERS.end}`
}

module.exports = {
  CHARACTER_DATA_MARKERS,
  buildCharacterAwarePrompt,
  parseCharacterAwareResult,
}
