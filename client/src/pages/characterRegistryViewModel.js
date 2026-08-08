const MAX_PRIMARY_CHARACTERS = 12

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function relationPairKey(relationship) {
  return [relationship.sourceId, relationship.targetId].sort().join('::')
}

function relationTypeSignature(type) {
  return String(type || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s/／、,，;；:：·・|｜()（）\[\]【】_-]+/g, '')
}

function mergeRelatedRelationships(existing, candidate) {
  const existingSignature = relationTypeSignature(existing.type)
  const candidateSignature = relationTypeSignature(candidate.type)
  const describesSameRelationship = existingSignature.includes(candidateSignature)
    || candidateSignature.includes(existingSignature)

  if (!describesSameRelationship) return null

  const existingDetail = existingSignature.length * 100 + String(existing.type).length
  const candidateDetail = candidateSignature.length * 100 + String(candidate.type).length
  const preferred = candidateDetail > existingDetail ? candidate : existing

  return {
    ...preferred,
    confidence: Math.max(
      Number(existing.confidence || 0),
      Number(candidate.confidence || 0),
    ),
  }
}

function dedupeRelationships(relationships, allowedIds) {
  const deduped = []
  for (const relationship of asArray(relationships)) {
    if (!allowedIds.has(relationship.sourceId) || !allowedIds.has(relationship.targetId)) continue
    const type = String(relationship.type || '').trim()
    if (!type || relationship.sourceId === relationship.targetId) continue
    const normalized = { ...relationship, type }
    const pairKey = relationPairKey(normalized)
    const relatedIndex = deduped.findIndex(existing => (
      relationPairKey(existing) === pairKey
      && mergeRelatedRelationships(existing, normalized)
    ))

    if (relatedIndex === -1) {
      deduped.push(normalized)
      continue
    }

    deduped[relatedIndex] = mergeRelatedRelationships(deduped[relatedIndex], normalized)
  }
  return deduped
}

function buildPrimaryRegistryView(registry = {}) {
  const confirmed = asArray(registry.characters).filter(character => (
    character?.status === 'resolved' && character.publicId && String(character.canonicalName || '').trim()
  ))
  const confirmedIds = new Set(confirmed.map(character => character.publicId))
  const confirmedRelationships = dedupeRelationships(registry.relationships, confirmedIds)
  const degree = new Map(confirmed.map(character => [character.publicId, 0]))

  for (const relationship of confirmedRelationships) {
    degree.set(relationship.sourceId, (degree.get(relationship.sourceId) || 0) + 1)
    degree.set(relationship.targetId, (degree.get(relationship.targetId) || 0) + 1)
  }

  const characters = confirmed
    .filter(character => asArray(character.appearances).length >= 2 || (degree.get(character.publicId) || 0) > 0)
    .map((character, sourceOrder) => ({
      ...character,
      appearances: asArray(character.appearances),
      aliases: asArray(character.aliases),
      relationshipCount: degree.get(character.publicId) || 0,
      importanceScore: asArray(character.appearances).length * 4
        + (degree.get(character.publicId) || 0) * 3
        + Number(character.confidence || 0),
      sourceOrder,
    }))
    .sort((left, right) => right.importanceScore - left.importanceScore || left.sourceOrder - right.sourceOrder)
    .slice(0, MAX_PRIMARY_CHARACTERS)

  const primaryIds = new Set(characters.map(character => character.publicId))
  const relationships = dedupeRelationships(confirmedRelationships, primaryIds)

  return {
    characters,
    relationships,
    summary: {
      characters: characters.length,
      relationships: relationships.length,
    },
  }
}

function buildGlobalRelationshipGraph(characters = [], relationships = [], selectedId) {
  const characterList = asArray(characters)
  if (characterList.length === 0) return { nodes: [], edges: [] }

  const allowedIds = new Set(characterList.map(character => character.publicId))
  const edges = asArray(relationships).filter(relationship => (
    allowedIds.has(relationship.sourceId) && allowedIds.has(relationship.targetId)
  ))
  const degree = new Map(characterList.map(character => [character.publicId, 0]))
  edges.forEach(relationship => {
    degree.set(relationship.sourceId, (degree.get(relationship.sourceId) || 0) + 1)
    degree.set(relationship.targetId, (degree.get(relationship.targetId) || 0) + 1)
  })

  const hub = characterList
    .map((character, index) => ({ character, index }))
    .sort((left, right) => (
      (degree.get(right.character.publicId) || 0) - (degree.get(left.character.publicId) || 0)
      || left.index - right.index
    ))[0].character
  const selected = characterList.find(character => character.publicId === selectedId) || hub
  const perimeterSlots = [
    { x: 100, y: 85 }, { x: 660, y: 85 }, { x: 100, y: 415 }, { x: 660, y: 415 },
    { x: 285, y: 85 }, { x: 475, y: 85 }, { x: 285, y: 415 }, { x: 475, y: 415 },
    { x: 100, y: 210 }, { x: 660, y: 210 }, { x: 100, y: 340 }, { x: 660, y: 340 },
  ]
  const perimeter = characterList.filter(character => character.publicId !== hub.publicId)
  const nodes = [
    { ...hub, x: 380, y: 250, focus: hub.publicId === selected.publicId },
    ...perimeter.map((character, index) => ({
      ...character,
      ...perimeterSlots[index],
      focus: character.publicId === selected.publicId,
    })),
  ]

  return { nodes, edges }
}

function cleanEvidenceText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || text.toLowerCase() === '[object object]') return ''
  return text
}

function normalizeAppearanceEvidence(appearance) {
  const episode = Number(appearance?.episode)
  if (!Number.isInteger(episode) || episode <= 0) return null

  const details = asArray(appearance?.evidence).map(item => {
    if (typeof item === 'string') return cleanEvidenceText(item)
    if (!item || typeof item !== 'object') return ''
    const scene = cleanEvidenceText(item.scene)
    const detail = cleanEvidenceText(item.detail)
    return scene && detail ? `${scene} · ${detail}` : detail || scene
  }).filter(Boolean)

  return details.length ? { episode, details } : null
}

export {
  buildGlobalRelationshipGraph,
  buildPrimaryRegistryView,
  normalizeAppearanceEvidence,
}
