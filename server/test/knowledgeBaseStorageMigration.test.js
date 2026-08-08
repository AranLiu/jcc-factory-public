const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const migrationPath = path.join(__dirname, '../database/migrations/011_knowledge_base_object_storage.sql')
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const initSql = readFileSync(path.join(__dirname, '../database/init.sql'), 'utf8')

test('ordered migration adds the complete knowledge-base object-storage contract independently', () => {
  for (const column of ['minio_bucket', 'minio_object_name', 'storage_type']) {
    const matchingStatements = migrationSql
      .split(';')
      .filter(statement => new RegExp(`ADD COLUMN ${column}\\b`, 'i').test(statement))
    assert.equal(matchingStatements.length, 1, `${column} must be added by its own recoverable statement`)
    for (const otherColumn of ['minio_bucket', 'minio_object_name', 'storage_type'].filter(value => value !== column)) {
      assert.doesNotMatch(matchingStatements[0], new RegExp(`ADD COLUMN ${otherColumn}\\b`, 'i'))
    }
  }

  for (const index of ['idx_kb_storage_type', 'idx_kb_minio_bucket', 'idx_kb_minio_object_name']) {
    assert.match(migrationSql, new RegExp(`CREATE INDEX ${index}\\b`, 'i'))
  }
  assert.match(migrationSql, /UPDATE knowledge_base SET storage_type = 'local' WHERE storage_type IS NULL/i)
})

test('fresh database schema includes the same knowledge-base object-storage fields and indexes', () => {
  const tableSql = initSql.match(/CREATE TABLE IF NOT EXISTS knowledge_base \([\s\S]*?\n\);/i)?.[0] || ''

  assert.match(tableSql, /minio_bucket VARCHAR\(100\)/i)
  assert.match(tableSql, /minio_object_name VARCHAR\(500\)/i)
  assert.match(tableSql, /storage_type ENUM\('local', 'minio'\) NOT NULL DEFAULT 'local'/i)
  assert.match(tableSql, /INDEX idx_kb_storage_type \(storage_type\)/i)
  assert.match(tableSql, /INDEX idx_kb_minio_bucket \(minio_bucket\)/i)
  assert.match(tableSql, /INDEX idx_kb_minio_object_name \(minio_object_name\)/i)
})
