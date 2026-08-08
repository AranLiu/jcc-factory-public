import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(fileURLToPath(new URL('./FirstRunSetup.jsx', import.meta.url)), 'utf8')
const userManagementSource = fs.readFileSync(
  fileURLToPath(new URL('./UserManagement.jsx', import.meta.url)),
  'utf8'
)

describe('first-run setup form contract', () => {
  it('asks only for a username and an 8 to 128 character password', () => {
    expect(source).not.toContain('name="email"')
    expect(source).not.toContain('MailOutlined')
    expect(source).toMatch(/min:\s*8,\s*max:\s*128/)
  })
})

describe('administrator user creation form contract', () => {
  it('marks email as optional and uses the same password minimum', () => {
    expect(userManagementSource).toMatch(/name="email"[\s\S]{0,100}label="邮箱（可选）"/)
    expect(userManagementSource).toMatch(/name="password"[\s\S]{0,300}min:\s*8/)
  })
})
