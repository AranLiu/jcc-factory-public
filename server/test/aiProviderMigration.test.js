const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const sql = fs.readFileSync(
  path.join(__dirname, '../database/migrations/006_ai_providers.sql'),
  'utf8'
)

test('provider migration stores encrypted credentials and explicit text routes', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_providers/i)
  assert.match(sql, /api_key_ciphertext\s+TEXT\s+NOT NULL/i)
  assert.match(sql, /provider_type\s+VARCHAR\(32\)/i)
  assert.match(sql, /capabilities_json\s+JSON/i)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_task_routes/i)
  assert.match(sql, /task_type\s+VARCHAR\(64\)\s+PRIMARY KEY/i)
  assert.doesNotMatch(sql, /sk-[A-Za-z0-9]/)
})
