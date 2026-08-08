const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('provider routes are mounted and every script integration uses the neutral dispatcher', () => {
  const index = read('index.js')
  const ai = read('routes/ai.js')
  const scriptUnits = read('routes/scriptUnits.js')

  assert.match(index, /app\.use\('\/api\/ai-providers', require\('\.\/routes\/aiProviders'\)\)/)
  assert.match(ai, /getTextGenerationService\(\)\.integrateScript/)
  assert.doesNotMatch(ai, /geminiService\.integrateScript/)
  assert.ok((scriptUnits.match(/getTextGenerationService\(\)\.integrateScript/g) || []).length >= 3)
  assert.doesNotMatch(scriptUnits, /geminiService\.integrateScript/)
})
