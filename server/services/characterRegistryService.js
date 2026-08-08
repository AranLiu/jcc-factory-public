const { randomUUID } = require('node:crypto')

const GENERIC_ALIASES = new Set([
  '爸', '爸爸', '父亲', '妈', '妈妈', '母亲', '哥', '哥哥', '姐', '姐姐', '弟', '弟弟', '妹', '妹妹',
  '老公', '老婆', '丈夫', '妻子', '老板', '总裁', '经理', '先生', '女士', '医生', '护士', '老师',
])

function normalizeIdentityLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\[\]【】()（）\s\-_.,，。:：'"“”‘’]/g, '')
    .slice(0, 120)
}

function isPlaceholderName(value) {
  const text = String(value || '').trim()
  return !text || /^待识别角色(?:\s|$)/.test(text) || /^unknown[_-]/i.test(text) || /^\[.*\]$/.test(text) || /^【.*】$/.test(text)
}

function isGenericAlias(value) {
  return GENERIC_ALIASES.has(normalizeIdentityLabel(value))
}

function buildCharacterIndexes(characters = [], aliases = []) {
  const byPublicId = new Map()
  const byCanonicalName = new Map()
  const byAlias = new Map()
  for (const character of characters) {
    if (character.public_id) byPublicId.set(character.public_id, character)
    const normalized = character.normalized_name || normalizeIdentityLabel(character.canonical_name)
    if (normalized && !isPlaceholderName(character.canonical_name)) {
      if (byCanonicalName.has(normalized)) byCanonicalName.set(normalized, null)
      else byCanonicalName.set(normalized, character)
    }
  }
  for (const alias of aliases) {
    const normalized = alias.normalized_alias || normalizeIdentityLabel(alias.alias)
    if (!normalized || isGenericAlias(normalized)) continue
    const character = characters.find(item => Number(item.id) === Number(alias.character_id))
    if (!character) continue
    if (byAlias.has(normalized) && Number(byAlias.get(normalized)?.id) !== Number(character.id)) byAlias.set(normalized, null)
    else if (!byAlias.has(normalized)) byAlias.set(normalized, character)
  }
  return { byPublicId, byCanonicalName, byAlias }
}

function chooseCharacterCandidate(observation = {}, indexes) {
  const confidence = Number(observation.confidence || 0)
  if (observation.matchedCharacterId && confidence >= 0.75) {
    const matched = indexes.byPublicId.get(observation.matchedCharacterId)
    if (matched) return matched
  }
  const canonical = normalizeIdentityLabel(observation.canonicalName)
  if (observation.nameExplicit === true && confidence >= 0.75 && canonical && indexes.byCanonicalName.get(canonical)) {
    return indexes.byCanonicalName.get(canonical)
  }
  if (confidence >= 0.75 && Array.isArray(observation.aliases)) {
    for (const alias of observation.aliases) {
      const normalized = normalizeIdentityLabel(alias)
      if (!normalized || isGenericAlias(normalized)) continue
      const matched = indexes.byAlias.get(normalized)
      if (matched) return matched
    }
  }
  return null
}

function publicCharacterId() {
  return `char_${randomUUID().replaceAll('-', '')}`
}

function observedDisplayName(observation, episodeNumber, index) {
  if (String(observation.canonicalName || '').trim()) return String(observation.canonicalName).trim().slice(0, 120)
  const alias = Array.isArray(observation.aliases) && observation.aliases.find(value => String(value || '').trim())
  if (alias) return `[${String(alias).trim().slice(0, 116)}]`
  if (String(observation.visualDescription || '').trim()) {
    return `[${String(observation.visualDescription).trim().slice(0, 48)}]`
  }
  return `待识别角色 ${episodeNumber || 'x'}-${index + 1}`
}

function characterStatus(observation, name) {
  if (observation.nameExplicit === true && !isPlaceholderName(name) && Number(observation.confidence || 0) >= 0.85) return 'resolved'
  if (!isPlaceholderName(name) || String(observation.visualDescription || '').trim()) return 'provisional'
  return 'unresolved'
}

function safeJson(value) {
  try { return JSON.stringify(value ?? []) } catch { return '[]' }
}

function parseEvidenceJson(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

class CharacterRegistryService {
  constructor({ pool } = {}) {
    this.pool = pool || require('../config/database').pool
  }

  async getCompactRegistry(projectId, limit = 24) {
    const boundedLimit = Math.max(1, Math.min(24, Number(limit) || 24))
    const [characters] = await this.pool.execute(
      `SELECT id, public_id, canonical_name, role_description, visual_description, status,
              last_seen_episode, confidence
       FROM characters WHERE project_id = ?
       ORDER BY status = 'resolved' DESC, last_seen_episode DESC, id ASC LIMIT ${boundedLimit}`,
      [projectId]
    )
    if (characters.length === 0) return []
    const ids = characters.map(item => item.id)
    const [aliases] = await this.pool.execute(
      `SELECT character_id, alias FROM character_aliases WHERE character_id IN (${ids.map(() => '?').join(',')})
       ORDER BY confidence DESC, id ASC`,
      ids
    )
    return characters.map(character => ({
      publicId: character.public_id,
      canonicalName: character.canonical_name,
      aliases: aliases.filter(alias => Number(alias.character_id) === Number(character.id)).map(alias => alias.alias).slice(0, 12),
      roleDescription: character.role_description || '',
      visualDescription: character.visual_description || '',
      lastSeenEpisode: character.last_seen_episode,
      status: character.status,
      confidence: Number(character.confidence || 0),
    }))
  }

  async ingestSnapshot({ projectId, fileId, episodeNumber, snapshot }) {
    if (!Number.isInteger(Number(projectId)) || !Number.isInteger(Number(fileId))) throw new TypeError('projectId and fileId are required')
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute('DELETE FROM character_relationships WHERE evidence_file_id = ?', [fileId])
      await connection.execute('DELETE FROM character_appearances WHERE file_id = ?', [fileId])

      const [characters] = await connection.execute(
        'SELECT * FROM characters WHERE project_id = ? FOR UPDATE',
        [projectId]
      )
      const [aliases] = await connection.execute(
        `SELECT ca.* FROM character_aliases ca JOIN characters c ON c.id = ca.character_id
         WHERE c.project_id = ? FOR UPDATE`,
        [projectId]
      )
      const indexes = buildCharacterIndexes(characters, aliases)
      const localCharacters = new Map()
      const observations = Array.isArray(snapshot?.characters) ? snapshot.characters : []
      const resolvedEpisode = Number.isInteger(Number(snapshot?.episode)) ? Number(snapshot.episode) : (Number(episodeNumber) || null)

      for (let index = 0; index < observations.length; index += 1) {
        const observation = observations[index]
        let character = chooseCharacterCandidate(observation, indexes)
        const displayName = observedDisplayName(observation, resolvedEpisode, index)
        const confidence = Math.max(0, Math.min(1, Number(observation.confidence || 0)))
        if (!character) {
          const status = characterStatus(observation, displayName)
          const publicId = publicCharacterId()
          const [insert] = await connection.execute(
            `INSERT INTO characters
             (project_id, public_id, canonical_name, normalized_name, status, role_description,
              visual_description, confidence, first_seen_episode, last_seen_episode, created_from_file_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [projectId, publicId, displayName, normalizeIdentityLabel(displayName), status,
              observation.roleDescription || null, observation.visualDescription || null, confidence,
              resolvedEpisode, resolvedEpisode, fileId]
          )
          character = {
            id: insert.insertId,
            project_id: Number(projectId),
            public_id: publicId,
            canonical_name: displayName,
            normalized_name: normalizeIdentityLabel(displayName),
            status,
          }
          characters.push(character)
          indexes.byPublicId.set(publicId, character)
          if (status === 'resolved') indexes.byCanonicalName.set(character.normalized_name, character)
        } else {
          const canPromote = observation.nameExplicit === true
            && confidence >= 0.85
            && !isPlaceholderName(displayName)
            && (character.status !== 'resolved' || isPlaceholderName(character.canonical_name))
          if (canPromote) {
            await connection.execute(
              `UPDATE characters SET canonical_name = ?, normalized_name = ?, status = 'resolved',
               confidence = GREATEST(confidence, ?), role_description = COALESCE(NULLIF(?, ''), role_description),
               visual_description = COALESCE(NULLIF(?, ''), visual_description),
               first_seen_episode = COALESCE(LEAST(first_seen_episode, ?), first_seen_episode, ?),
               last_seen_episode = GREATEST(COALESCE(last_seen_episode, ?), ?)
               WHERE id = ?`,
              [displayName, normalizeIdentityLabel(displayName), confidence,
                observation.roleDescription || '', observation.visualDescription || '', resolvedEpisode, resolvedEpisode,
                resolvedEpisode, resolvedEpisode, character.id]
            )
            character.canonical_name = displayName
            character.normalized_name = normalizeIdentityLabel(displayName)
            character.status = 'resolved'
            indexes.byCanonicalName.set(character.normalized_name, character)
          } else {
            await connection.execute(
              `UPDATE characters SET confidence = GREATEST(confidence, ?),
               role_description = COALESCE(NULLIF(?, ''), role_description),
               visual_description = COALESCE(NULLIF(?, ''), visual_description),
               first_seen_episode = COALESCE(LEAST(first_seen_episode, ?), first_seen_episode, ?),
               last_seen_episode = GREATEST(COALESCE(last_seen_episode, ?), ?)
               WHERE id = ?`,
              [confidence, observation.roleDescription || '', observation.visualDescription || '',
                resolvedEpisode, resolvedEpisode, resolvedEpisode, resolvedEpisode, character.id]
            )
          }
        }

        const aliasValues = [observation.canonicalName, ...(Array.isArray(observation.aliases) ? observation.aliases : [])]
        for (const aliasValue of [...new Set(aliasValues.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 12)) {
          const normalizedAlias = normalizeIdentityLabel(aliasValue)
          if (!normalizedAlias) continue
          await connection.execute(
            `INSERT INTO character_aliases
             (character_id, alias, normalized_alias, first_seen_episode, last_seen_episode, confidence)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE first_seen_episode = COALESCE(LEAST(first_seen_episode, VALUES(first_seen_episode)), first_seen_episode, VALUES(first_seen_episode)),
             last_seen_episode = GREATEST(COALESCE(last_seen_episode, VALUES(last_seen_episode)), VALUES(last_seen_episode)),
             confidence = GREATEST(confidence, VALUES(confidence))`,
            [character.id, aliasValue.slice(0, 120), normalizedAlias, resolvedEpisode, resolvedEpisode, confidence]
          )
          if (!isGenericAlias(normalizedAlias)) {
            const existingAlias = indexes.byAlias.get(normalizedAlias)
            if (!indexes.byAlias.has(normalizedAlias)) indexes.byAlias.set(normalizedAlias, character)
            else if (existingAlias && Number(existingAlias.id) !== Number(character.id)) indexes.byAlias.set(normalizedAlias, null)
          }
        }

        await connection.execute(
          `INSERT INTO character_appearances
           (character_id, project_id, file_id, episode_number, local_id, display_label, confidence,
            visual_description, role_description, evidence_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [character.id, projectId, fileId, resolvedEpisode, String(observation.localId || `local_${index + 1}`).slice(0, 80),
            displayName, confidence, observation.visualDescription || null, observation.roleDescription || null,
            safeJson(observation.evidence)]
        )
        localCharacters.set(String(observation.localId || `local_${index + 1}`), character)
      }

      const relationships = Array.isArray(snapshot?.relationships) ? snapshot.relationships : []
      for (const relationship of relationships) {
        const source = localCharacters.get(String(relationship.sourceLocalId || ''))
        const target = localCharacters.get(String(relationship.targetLocalId || ''))
        const type = String(relationship.relationshipType || '').trim().slice(0, 120)
        if (!source || !target || source.id === target.id || !type) continue
        await connection.execute(
          `INSERT INTO character_relationships
           (project_id, source_character_id, target_character_id, relationship_type, confidence,
            evidence, evidence_file_id, first_episode, last_episode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE confidence = VALUES(confidence), evidence = VALUES(evidence),
           first_episode = VALUES(first_episode), last_episode = VALUES(last_episode)`,
          [projectId, source.id, target.id, type, Math.max(0, Math.min(1, Number(relationship.confidence || 0))),
            String(relationship.evidence || '').slice(0, 500) || null, fileId, resolvedEpisode, resolvedEpisode]
        )
      }

      // 重跑某一集后移除已经没有任何出场依据的孤立档案，避免旧识别结果累积。
      await connection.execute(
        `DELETE c FROM characters c
         LEFT JOIN character_appearances ca ON ca.character_id = c.id
         WHERE c.project_id = ? AND ca.id IS NULL`,
        [projectId]
      )

      await connection.commit()
      return { characters: observations.length, relationships: relationships.length }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async getProjectRegistry(projectId) {
    const [characters] = await this.pool.execute(
      `SELECT id, public_id, canonical_name, status, role_description, visual_description,
              confidence, first_seen_episode, last_seen_episode
       FROM characters WHERE project_id = ? ORDER BY status = 'resolved' DESC, first_seen_episode ASC, id ASC`,
      [projectId]
    )
    if (characters.length === 0) {
      return { summary: { total: 0, resolved: 0, provisional: 0, unresolved: 0, relationships: 0 }, characters: [], relationships: [] }
    }
    const ids = characters.map(character => character.id)
    const placeholders = ids.map(() => '?').join(',')
    const [aliases] = await this.pool.execute(
      `SELECT character_id, alias, confidence, first_seen_episode, last_seen_episode
       FROM character_aliases WHERE character_id IN (${placeholders}) ORDER BY confidence DESC, id ASC`, ids
    )
    const [appearances] = await this.pool.execute(
      `SELECT character_id, file_id, episode_number, display_label, confidence, evidence_json,
              visual_description, role_description
       FROM character_appearances WHERE character_id IN (${placeholders}) ORDER BY episode_number ASC, id ASC`, ids
    )
    const [relationships] = await this.pool.execute(
      `SELECT cr.id, cr.relationship_type, cr.confidence, cr.evidence, cr.first_episode, cr.last_episode,
              source.public_id AS source_public_id, source.canonical_name AS source_name,
              target.public_id AS target_public_id, target.canonical_name AS target_name
       FROM character_relationships cr
       JOIN characters source ON source.id = cr.source_character_id
       JOIN characters target ON target.id = cr.target_character_id
       WHERE cr.project_id = ? ORDER BY cr.confidence DESC, cr.id ASC`, [projectId]
    )
    const serialized = characters.map(character => ({
      publicId: character.public_id,
      canonicalName: character.canonical_name,
      status: character.status,
      roleDescription: character.role_description || '',
      visualDescription: character.visual_description || '',
      confidence: Number(character.confidence || 0),
      firstSeenEpisode: character.first_seen_episode,
      lastSeenEpisode: character.last_seen_episode,
      aliases: aliases.filter(alias => Number(alias.character_id) === Number(character.id)).map(alias => ({
        name: alias.alias,
        confidence: Number(alias.confidence || 0),
        firstSeenEpisode: alias.first_seen_episode,
        lastSeenEpisode: alias.last_seen_episode,
      })),
      appearances: appearances.filter(item => Number(item.character_id) === Number(character.id)).map(item => ({
        fileId: item.file_id,
        episode: item.episode_number,
        displayLabel: item.display_label,
        confidence: Number(item.confidence || 0),
        evidence: parseEvidenceJson(item.evidence_json),
        visualDescription: item.visual_description || '',
        roleDescription: item.role_description || '',
      })),
    }))
    const count = status => serialized.filter(character => character.status === status).length
    return {
      summary: {
        total: serialized.length,
        resolved: count('resolved'),
        provisional: count('provisional'),
        unresolved: count('unresolved'),
        relationships: relationships.length,
      },
      characters: serialized,
      relationships: relationships.map(item => ({
        id: item.id,
        sourceId: item.source_public_id,
        sourceName: item.source_name,
        targetId: item.target_public_id,
        targetName: item.target_name,
        type: item.relationship_type,
        confidence: Number(item.confidence || 0),
        evidence: item.evidence || '',
        firstEpisode: item.first_episode,
        lastEpisode: item.last_episode,
      })),
    }
  }
}

let singleton
function getCharacterRegistryService() {
  if (!singleton) singleton = new CharacterRegistryService()
  return singleton
}

module.exports = {
  CharacterRegistryService,
  buildCharacterIndexes,
  chooseCharacterCandidate,
  getCharacterRegistryService,
  isPlaceholderName,
  normalizeIdentityLabel,
  parseEvidenceJson,
}
