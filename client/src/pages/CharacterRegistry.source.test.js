import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const src = path.resolve(process.cwd(), 'src')

describe('character registry desktop experience', () => {
  it('uses a stable global relationship map and never renders raw evidence objects', () => {
    const page = fs.readFileSync(path.join(src, 'pages', 'CharacterRegistry.jsx'), 'utf8')
    const styles = fs.readFileSync(path.join(src, 'pages', 'CharacterRegistry.css'), 'utf8')
    expect(page).toContain('buildPrimaryRegistryView')
    expect(page).toContain('buildGlobalRelationshipGraph')
    expect(page).toContain('固定展示全部主线人物和核心关系')
    expect(page).not.toContain('map-focus-chip')
    expect(page).toContain('normalizeAppearanceEvidence')
    expect(page).not.toContain('buildMapLayout')
    expect(page).not.toContain('appearance.evidence?.join')
    expect(page).toMatch(
      /<linearGradient[^>]*gradientUnits="userSpaceOnUse"[^>]*x2="760"[^>]*y2="500"/,
    )
    const selectedRule = styles.match(/\.relationship-node\.is-focus\s*\{([^}]*)\}/)?.[1] || ''
    expect(selectedRule).not.toMatch(/\bwidth\s*:|\bmin-height\s*:/)
  })

  it('provides a protected project route and API client', () => {
    const app = fs.readFileSync(path.join(src, 'App.jsx'), 'utf8')
    const api = fs.readFileSync(path.join(src, 'services', 'api.js'), 'utf8')
    expect(app).toContain('CharacterRegistry')
    expect(app).toContain('/project/:id/characters')
    expect(api).toContain('export const characterRegistryAPI')
  })

  it('exposes a project-level character dossier entry', () => {
    const detail = fs.readFileSync(path.join(src, 'pages', 'ProjectDetail.jsx'), 'utf8')
    expect(detail).toContain('角色档案中心')
    expect(detail).toContain("navigate(`/project/${id}/characters`)")
  })

  it('renders registry summary, relationship map, dossiers and a useful empty state', () => {
    const page = fs.readFileSync(path.join(src, 'pages', 'CharacterRegistry.jsx'), 'utf8')
    expect(page).toContain('全局角色档案')
    expect(page).toContain('关系地图')
    expect(page).toContain('角色卷宗')
    expect(page).toContain('重新解析')
  })
})
