const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const express = require('express')
const { createCharactersRouter } = require('../routes/characters')

async function requestRouter(router, pathname = '/api/characters/project/11') {
  const app = express()
  app.use('/api/characters', router)
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    return await fetch(`http://127.0.0.1:${address.port}${pathname}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('character registry route is authenticated and project scoped', () => {
  const routePath = path.join(__dirname, '..', 'routes', 'characters.js')
  assert.equal(fs.existsSync(routePath), true)
  const source = fs.readFileSync(routePath, 'utf8')
  assert.match(source, /router\.use\(authenticate\)/)
  assert.match(source, /canReadResource\(req\.user, project\.user_id\)/)
  assert.match(source, /router\.get\('\/project\/:projectId'/)
  assert.match(source, /getProjectRegistry\(projectId\)/)
})

test('server mounts the character registry under an API namespace', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.match(source, /app\.use\('\/api\/characters', require\('\.\/routes\/characters'\)\)/)
})

test('character registry enforces authentication and project-level read access', async () => {
  const databasePool = { execute: async () => [[{ id: 11, user_id: 7 }]] }
  const registryService = { getProjectRegistry: async () => ({ summary: { total: 1 }, characters: [], relationships: [] }) }

  const anonymous = createCharactersRouter({
    authenticate: (_req, res) => res.status(401).json({ message: '未认证' }),
    databasePool,
    registryService,
  })
  assert.equal((await requestRouter(anonymous)).status, 401)

  const forbidden = createCharactersRouter({
    authenticate: (req, _res, next) => { req.user = { id: 8, role: 'user', permission: 'personal' }; next() },
    databasePool,
    registryService,
  })
  assert.equal((await requestRouter(forbidden)).status, 403)

  const owner = createCharactersRouter({
    authenticate: (req, _res, next) => { req.user = { id: 7, role: 'user', permission: 'personal' }; next() },
    databasePool,
    registryService,
  })
  const ownerResponse = await requestRouter(owner)
  assert.equal(ownerResponse.status, 200)
  assert.equal((await ownerResponse.json()).data.summary.total, 1)
})
