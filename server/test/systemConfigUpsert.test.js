const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('system configuration writes create missing keys instead of silently updating zero rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/systemConfigService.js'), 'utf8')

  assert.match(source, /INSERT INTO system_config/)
  assert.match(source, /ON DUPLICATE KEY UPDATE/)
  assert.match(source, /updated_by\s*=\s*VALUES\(updated_by\)/)
})
