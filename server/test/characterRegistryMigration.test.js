const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const sql = readFileSync(path.join(__dirname, '../database/migrations/008_character_registry.sql'), 'utf8')

test('character registry migration creates project-scoped identities and evidence tables', () => {
  for (const table of ['characters', 'character_aliases', 'character_appearances', 'character_relationships']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  }
  assert.match(sql, /UNIQUE KEY uq_characters_project_public \(project_id, public_id\)/)
  assert.match(sql, /UNIQUE KEY uq_character_appearances_file_local \(file_id, local_id\)/)
  assert.match(sql, /evidence_file_id INT NOT NULL/)
  assert.match(sql, /FOREIGN KEY \(project_id\) REFERENCES projects\(id\) ON DELETE CASCADE/)
})
