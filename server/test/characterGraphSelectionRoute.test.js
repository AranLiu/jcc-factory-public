const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'scriptUnits.js'), 'utf8')

test('step3 character integrations route returns structured per-file graph segments', () => {
  assert.match(source, /getStep3CharacterSources/)
  assert.match(source, /segments\s*:\s*sources\.segments/)
  assert.doesNotMatch(source, /SELECT id, result, created_at, updated_at, task_type/)
})
