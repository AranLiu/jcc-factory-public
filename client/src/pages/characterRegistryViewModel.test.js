import { describe, expect, it } from 'vitest'

import {
  buildGlobalRelationshipGraph,
  buildPrimaryRegistryView,
  normalizeAppearanceEvidence,
} from './characterRegistryViewModel'

const characters = [
  {
    publicId: 'lead',
    canonicalName: '陆仁',
    status: 'resolved',
    confidence: 1,
    roleDescription: '男主角',
    appearances: [{ episode: 1 }, { episode: 2 }],
  },
  {
    publicId: 'partner',
    canonicalName: '舒心',
    status: 'resolved',
    confidence: 1,
    roleDescription: '女主角',
    appearances: [{ episode: 1 }],
  },
  {
    publicId: 'relative',
    canonicalName: '林啸天',
    status: 'resolved',
    confidence: 0.98,
    roleDescription: '关键长辈',
    appearances: [{ episode: 1 }],
  },
  {
    publicId: 'passerby',
    canonicalName: '酒吧老板',
    status: 'resolved',
    confidence: 0.96,
    roleDescription: '递酒的老板',
    appearances: [{ episode: 1 }],
  },
  {
    publicId: 'gangster',
    canonicalName: '[混混老大]',
    status: 'provisional',
    confidence: 0.9,
    roleDescription: '背景人物',
    appearances: [{ episode: 2 }],
  },
]

const relationships = [
  { id: 1, sourceId: 'lead', targetId: 'partner', type: '夫妻', confidence: 0.95 },
  { id: 2, sourceId: 'lead', targetId: 'partner', type: '夫妻', confidence: 0.9 },
  { id: 3, sourceId: 'relative', targetId: 'lead', type: '师徒', confidence: 0.92 },
  { id: 4, sourceId: 'gangster', targetId: 'lead', type: '敌对', confidence: 0.88 },
]

describe('character registry view model', () => {
  it('keeps only confirmed people who participate in the main story', () => {
    const view = buildPrimaryRegistryView({ characters, relationships })

    expect(view.characters.map(character => character.publicId)).toEqual(['lead', 'partner', 'relative'])
    expect(view.characters.some(character => character.canonicalName.includes('混混'))).toBe(false)
    expect(view.characters.some(character => character.publicId === 'passerby')).toBe(false)
    expect(view.relationships).toHaveLength(2)
    expect(view.summary).toEqual({ characters: 3, relationships: 2 })
  })

  it('keeps the global relationship graph stable when the selected dossier changes', () => {
    const view = buildPrimaryRegistryView({ characters, relationships })
    const leadGraph = buildGlobalRelationshipGraph(view.characters, view.relationships, 'lead')
    const partnerGraph = buildGlobalRelationshipGraph(view.characters, view.relationships, 'partner')

    expect(leadGraph.nodes.map(node => node.publicId).sort()).toEqual(['lead', 'partner', 'relative'])
    expect(partnerGraph.nodes.map(node => node.publicId).sort()).toEqual(['lead', 'partner', 'relative'])
    expect(leadGraph.edges).toHaveLength(2)
    expect(partnerGraph.edges).toHaveLength(2)
    expect(partnerGraph.nodes.map(({ publicId, x, y }) => ({ publicId, x, y })))
      .toEqual(leadGraph.nodes.map(({ publicId, x, y }) => ({ publicId, x, y })))
    expect(leadGraph.nodes.find(node => node.publicId === 'lead')?.focus).toBe(true)
    expect(partnerGraph.nodes.find(node => node.publicId === 'partner')?.focus).toBe(true)
  })

  it('balances a five-person global map across the full canvas', () => {
    const layoutCharacters = ['a', 'b', 'c', 'd', 'e'].map(publicId => ({ publicId }))
    const layoutRelationships = ['b', 'c', 'd', 'e'].map((targetId, index) => ({
      id: index,
      sourceId: 'a',
      targetId,
      type: '关联',
    }))
    const graph = buildGlobalRelationshipGraph(layoutCharacters, layoutRelationships, 'a')
    const perimeter = graph.nodes.filter(node => node.publicId !== 'a')

    expect([...new Set(perimeter.map(node => node.x))].sort((a, b) => a - b)).toEqual([100, 660])
    expect([...new Set(perimeter.map(node => node.y))].sort((a, b) => a - b)).toEqual([85, 415])
  })

  it('merges a generic relationship into its more descriptive same-pair relationship', () => {
    const view = buildPrimaryRegistryView({
      characters: [
        {
          publicId: 'person-a',
          canonicalName: 'Person A',
          status: 'resolved',
          confidence: 1,
          roleDescription: 'Main character',
          appearances: [{ episode: 1 }, { episode: 2 }],
        },
        {
          publicId: 'person-b',
          canonicalName: 'Person B',
          status: 'resolved',
          confidence: 1,
          roleDescription: 'Main character',
          appearances: [{ episode: 1 }, { episode: 2 }],
        },
      ],
      relationships: [
        { id: 1, sourceId: 'person-a', targetId: 'person-b', type: 'spouse', confidence: 1 },
        { id: 2, sourceId: 'person-b', targetId: 'person-a', type: 'spouse / matrilocal marriage', confidence: 0.9 },
        { id: 3, sourceId: 'person-a', targetId: 'person-b', type: 'mentor', confidence: 0.8 },
      ],
    })

    expect(view.relationships).toHaveLength(2)
    expect(view.relationships.map(relationship => relationship.type)).toEqual([
      'spouse / matrilocal marriage',
      'mentor',
    ])
    expect(view.relationships[0].confidence).toBe(1)
  })

  it('shows appearance evidence only when episode and readable text are both available', () => {
    expect(normalizeAppearanceEvidence({
      episode: 2,
      evidence: [{ scene: '2-1', detail: '字幕明确称呼陆仁' }],
    })).toEqual({ episode: 2, details: ['2-1 · 字幕明确称呼陆仁'] })

    expect(normalizeAppearanceEvidence({
      episode: null,
      evidence: [{ detail: '缺少集数' }],
    })).toBeNull()
    expect(normalizeAppearanceEvidence({ episode: 3, evidence: [{ value: '对象占位' }] })).toBeNull()
    expect(normalizeAppearanceEvidence({ episode: 3, evidence: ['[object Object]'] })).toBeNull()
  })
})
