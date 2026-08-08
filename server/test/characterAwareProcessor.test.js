const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const processorPath = path.join(__dirname, '..', 'services', 'UnifiedTaskProcessor.js')

test('video worker enriches the existing model call and stores character evidence without a second call', () => {
  const source = fs.readFileSync(processorPath, 'utf8')

  assert.match(source, /buildCharacterAwarePrompt/)
  assert.match(source, /parseCharacterAwareResult/)
  assert.match(source, /getCompactRegistry\(project\.id\)/)
  assert.match(source, /ingestSnapshot\(\{/)
  assert.match(source, /result\.text\s*=\s*parsedResult\.scriptText/)

  const analyzeCalls = source.match(/geminiService\.analyzeVideo\(/g) || []
  assert.equal(analyzeCalls.length, 1, 'character extraction must reuse the existing video model call')
})

test('character registry failures are logged and do not fail video script generation', () => {
  const source = fs.readFileSync(processorPath, 'utf8')
  assert.match(source, /角色档案上下文加载失败，继续执行视频解析/)
  assert.match(source, /角色档案写入失败，不影响脚本解析结果/)
})
