const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const migrationPath = path.join(__dirname, '../database/migrations/007_short_drama_workflow_prompts.sql')

test('short-drama defaults cover the five active runtime prompts only', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  for (const key of [
    'video_analysis_prompt',
    'character_knowledge_graph_prompt',
    'character_integration_prompt',
    'script_integration_prompt',
    'character_prompt',
  ]) {
    assert.match(sql, new RegExp(key))
  }

  assert.doesNotMatch(sql, /full_script_review_prompt/)
  assert.match(sql, /严禁脑补/)
  assert.match(sql, /第\[x\]集关系快照/)
  assert.match(sql, /严禁替换角色名/)
  assert.match(sql, /\*\*\[司父\]\*\*/)
  assert.doesNotMatch(sql, /\*\*司辛\*\*：爸，您终于来了/)
  assert.match(sql, /ON DUPLICATE KEY UPDATE/)
  assert.match(sql, /IF\(\s*system_config\.config_value IN/)
})
