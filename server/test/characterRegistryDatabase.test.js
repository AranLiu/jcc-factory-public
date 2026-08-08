const test = require('node:test')
const assert = require('node:assert/strict')

const enabled = process.env.JCC_DB_INTEGRATION === '1'

test('character registry persists and reuses one identity across episodes', { skip: !enabled }, async () => {
  const { pool } = require('../config/database')
  const { CharacterRegistryService } = require('../services/characterRegistryService')
  let projectId = null

  try {
    const [[user]] = await pool.execute('SELECT id FROM users ORDER BY id LIMIT 1')
    assert.ok(user, 'a local user is required for the database integration test')
    const [projectInsert] = await pool.execute(
      "INSERT INTO projects (name, user_id, type, status) VALUES (?, ?, 'video', 'created')",
      ['__character_registry_integration__', user.id]
    )
    projectId = projectInsert.insertId

    const insertFile = async originalName => {
      const [result] = await pool.execute(
        `INSERT INTO files
         (project_id, filename, original_name, file_path, file_size, mime_type, storage_type)
         VALUES (?, ?, ?, ?, 1, 'video/mp4', 'local')`,
        [projectId, originalName, originalName, `integration/${originalName}`]
      )
      return result.insertId
    }

    const service = new CharacterRegistryService({ pool })
    const firstFileId = await insertFile('第1集.mp4')
    await service.ingestSnapshot({
      projectId,
      fileId: firstFileId,
      episodeNumber: 1,
      snapshot: {
        characters: [
          { localId: 'lead', canonicalName: '司念', nameExplicit: true, aliases: ['念念'], roleDescription: '女主角', confidence: 0.96, evidence: [{ scene: '1-1', detail: '字幕点名' }] },
          { localId: 'man', canonicalName: '', nameExplicit: false, aliases: ['顾总'], visualDescription: '黑色西装', confidence: 0.78, evidence: [] },
        ],
        relationships: [{ sourceLocalId: 'lead', targetLocalId: 'man', relationshipType: '夫妻', confidence: 0.9, evidence: '对白' }],
      },
    })

    const firstRegistry = await service.getProjectRegistry(projectId)
    assert.equal(firstRegistry.characters.length, 2)
    assert.equal(firstRegistry.relationships.length, 1)
    const lead = firstRegistry.characters.find(character => character.canonicalName === '司念')
    assert.ok(lead)

    const secondFileId = await insertFile('第2集.mp4')
    await service.ingestSnapshot({
      projectId,
      fileId: secondFileId,
      episodeNumber: 2,
      snapshot: {
        characters: [{ localId: 'lead-2', matchedCharacterId: lead.publicId, canonicalName: '司念', nameExplicit: true, aliases: ['念念'], confidence: 0.97, evidence: [] }],
        relationships: [],
      },
    })

    const secondRegistry = await service.getProjectRegistry(projectId)
    assert.equal(secondRegistry.characters.length, 2)
    assert.equal(secondRegistry.characters.find(character => character.publicId === lead.publicId).appearances.length, 2)

    await service.ingestSnapshot({
      projectId,
      fileId: firstFileId,
      episodeNumber: 1,
      snapshot: {
        characters: [{ localId: 'lead', matchedCharacterId: lead.publicId, canonicalName: '司念', nameExplicit: true, aliases: ['念念'], confidence: 0.98, evidence: [] }],
        relationships: [],
      },
    })
    const reprocessedRegistry = await service.getProjectRegistry(projectId)
    assert.equal(reprocessedRegistry.characters.length, 1, 'reprocessing removes identities that no longer have evidence')
    assert.equal(reprocessedRegistry.relationships.length, 0)
    assert.equal(reprocessedRegistry.characters[0].appearances.length, 2)
  } finally {
    if (projectId) await pool.execute('DELETE FROM projects WHERE id = ?', [projectId])
    await pool.end()
  }
})
