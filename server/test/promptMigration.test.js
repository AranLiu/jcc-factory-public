const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const migrationPath = path.join(__dirname, '../database/migrations/005_repair_legacy_default_prompts.sql')

test('legacy prompt repair is exact, idempotent, and does not overwrite custom prompts', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  assert.match(sql, /请分析这个视频的内容，并提供详细的分析报告。/)
  assert.match(sql, /请基于提供的内容整合出一个完整的脚本。/)
  assert.match(sql, /HEX\(config_value\)\s*=/i)
  assert.match(sql, /config_key\s*=\s*'video_analysis_prompt'/)
  assert.match(sql, /config_key\s*=\s*'script_integration_prompt'/)
  assert.doesNotMatch(sql, /WHERE\s+config_key\s*=\s*'[^']+'\s*;/i)
})
