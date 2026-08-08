import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Spin, Tag, message } from 'antd'
import {
  ArrowLeftOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from '../services/router'
import { characterRegistryAPI, projectAPI } from '../services/api'
import {
  buildGlobalRelationshipGraph,
  buildPrimaryRegistryView,
  normalizeAppearanceEvidence,
} from './characterRegistryViewModel'
import './CharacterRegistry.css'

function roleExcerpt(character, maxLength = 18) {
  const text = String(character?.roleDescription || '').trim()
  if (!text) return '主线人物'
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function RelationshipMap({ characters, relationships, selectedId, onSelect }) {
  const graph = useMemo(
    () => buildGlobalRelationshipGraph(characters, relationships, selectedId),
    [characters, relationships, selectedId]
  )
  const byId = useMemo(() => new Map(graph.nodes.map(node => [node.publicId, node])), [graph.nodes])

  return (
    <div className="character-map-shell">
      <div className="map-heading-row">
        <div>
          <div className="section-kicker"><BranchesOutlined /> 关系脉络</div>
          <div className="map-caption">固定展示全部主线人物和核心关系；点击人物只更新右侧角色卷宗。</div>
        </div>
      </div>

      <div className="relationship-canvas" role="img" aria-label="主要人物关系地图">
        <svg className="relationship-lines" viewBox="0 0 760 500" aria-hidden="true">
          <defs>
            <linearGradient
              id="relationshipStroke"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="760"
              y2="500"
            >
              <stop offset="0" stopColor="#9fb0bd" />
              <stop offset="0.5" stopColor="#d76a4f" />
              <stop offset="1" stopColor="#9fb0bd" />
            </linearGradient>
          </defs>
          {graph.edges.map((relation, index) => {
            const source = byId.get(relation.sourceId)
            const target = byId.get(relation.targetId)
            if (!source || !target) return null
            const midX = Math.round((source.x + target.x) / 2)
            const midY = Math.round((source.y + target.y) / 2)
            const label = String(relation.type || '关联').slice(0, 10)
            const labelWidth = Math.max(52, label.length * 14 + 20)
            const bend = source.y === target.y ? 0 : (target.y - source.y) * 0.12
            return (
              <g key={`${relation.id || index}-${relation.sourceId}-${relation.targetId}`}>
                <path
                  className="relation-path"
                  d={`M ${source.x} ${source.y} C ${midX} ${source.y + bend}, ${midX} ${target.y - bend}, ${target.x} ${target.y}`}
                />
                <g className="relation-label-pill" transform={`translate(${midX} ${midY})`}>
                  <rect x={-labelWidth / 2} y="-13" width={labelWidth} height="26" rx="13" />
                  <text textAnchor="middle" dominantBaseline="central">{label}</text>
                </g>
              </g>
            )
          })}
        </svg>

        {graph.nodes.map(node => (
          <button
            type="button"
            key={node.publicId}
            className={`relationship-node ${node.focus ? 'is-focus' : ''}`}
            style={{ left: `${(node.x / 760) * 100}%`, top: `${(node.y / 500) * 100}%` }}
            onClick={() => onSelect(node.publicId)}
            aria-pressed={node.publicId === selectedId}
          >
            <span className="node-monogram">{node.canonicalName.slice(0, 1)}</span>
            <span className="node-copy">
              <strong>{node.canonicalName}</strong>
              <small>{roleExcerpt(node, 13)}</small>
            </span>
          </button>
        ))}

        {graph.nodes.length > 0 && graph.edges.length === 0 && (
          <div className="relationship-empty-note">当前还没有提取到可信的核心人物关系。</div>
        )}
      </div>
    </div>
  )
}

function CharacterRegistry() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState(null)
  const [registry, setRegistry] = useState({ characters: [], relationships: [] })
  const [selectedId, setSelectedId] = useState(null)

  const primaryRegistry = useMemo(() => buildPrimaryRegistryView(registry), [registry])
  const selected = primaryRegistry.characters.find(item => item.publicId === selectedId) || null
  const selectedRelationships = selected
    ? primaryRegistry.relationships.filter(item => item.sourceId === selected.publicId || item.targetId === selected.publicId)
    : []
  const validEvidence = selected
    ? selected.appearances.map(normalizeAppearanceEvidence).filter(Boolean).slice(-4).reverse()
    : []

  const loadRegistry = async () => {
    setLoading(true)
    try {
      const [projectResponse, registryResponse] = await Promise.all([
        projectAPI.getDetail(id),
        characterRegistryAPI.getProject(id),
      ])
      setProject(projectResponse.project)
      setRegistry(registryResponse.data || { characters: [], relationships: [] })
    } catch (error) {
      message.error(error.response?.data?.message || '角色档案加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRegistry()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    setSelectedId(current => (
      current && primaryRegistry.characters.some(item => item.publicId === current)
        ? current
        : primaryRegistry.characters[0]?.publicId || null
    ))
  }, [primaryRegistry.characters])

  if (loading) {
    return <div className="registry-loading"><Spin size="large" /><span>正在整理主线人物…</span></div>
  }

  return (
    <main className="character-registry-page">
      <header className="registry-header">
        <div className="registry-header-main">
          <Button className="registry-back" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/project/${id}`)}>
            返回项目
          </Button>
          <div>
            <div className="registry-eyebrow">MAIN CAST · 自动归档</div>
            <h1>全局角色档案</h1>
            <p>{project?.name || '当前项目'} · 聚焦身份明确、持续参与主线剧情的人物与关系</p>
          </div>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadRegistry}>刷新档案</Button>
      </header>

      <section className="registry-stats" aria-label="主要人物统计">
        <div className="stat-number"><strong>{primaryRegistry.summary.characters}</strong><span>主线人物</span></div>
        <div className="stat-number"><strong>{primaryRegistry.summary.relationships}</strong><span>核心关系</span></div>
        <div className="stat-policy">
          <SafetyCertificateOutlined />
          <span><strong>仅展示身份已确认</strong><small>临时称谓、群演与背景人物已自动隐藏</small></span>
        </div>
      </section>

      {primaryRegistry.characters.length === 0 ? (
        <section className="registry-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
          <h2>暂未识别出主线人物</h2>
          <p>页面只展示身份已确认、跨集出现或参与主要人物关系的角色。重新解析更多剧集后，符合条件的人物会自动进入档案。</p>
          <Button type="primary" onClick={() => navigate(`/project/${id}`)}>返回项目并重新解析</Button>
        </section>
      ) : (
        <section className="registry-workbench">
          <aside className="character-index">
            <div className="panel-heading">
              <div className="section-kicker"><TeamOutlined /> 主线人物</div>
              <span>{primaryRegistry.characters.length} 人</span>
            </div>
            <div className="index-list">
              {primaryRegistry.characters.map((character, index) => (
                <button
                  type="button"
                  key={character.publicId}
                  className={`index-card ${selectedId === character.publicId ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(character.publicId)}
                >
                  <span className="index-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="index-copy">
                    <strong>{character.canonicalName}</strong>
                    <small>{roleExcerpt(character)}</small>
                  </span>
                  <CheckCircleOutlined className="confirmed-icon" aria-label="身份已确认" />
                </button>
              ))}
            </div>
          </aside>

          <RelationshipMap
            characters={primaryRegistry.characters}
            relationships={primaryRegistry.relationships}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          <aside className="character-dossier">
            <div className="section-kicker"><FileSearchOutlined /> 角色卷宗</div>
            {selected && (
              <>
                <div className="dossier-heading">
                  <span className="dossier-monogram">{selected.canonicalName.slice(0, 1)}</span>
                  <div>
                    <h2>{selected.canonicalName}</h2>
                    <Tag className="registry-tag tag-resolved">身份已确认</Tag>
                  </div>
                </div>
                <dl className="dossier-facts">
                  <div><dt>识别置信度</dt><dd>{Math.round((selected.confidence || 0) * 100)}%</dd></div>
                  <div><dt>主线关系</dt><dd>{selectedRelationships.length} 条</dd></div>
                </dl>
                <div className="dossier-block">
                  <h3>身份与剧情作用</h3>
                  <p>{selected.roleDescription || '暂无稳定的剧情身份描述。'}</p>
                </div>
                {selected.visualDescription && (
                  <div className="dossier-block">
                    <h3>外观识别线索</h3>
                    <p>{selected.visualDescription}</p>
                  </div>
                )}
                {selected.aliases.length > 0 && (
                  <div className="dossier-block">
                    <h3>称呼与别名</h3>
                    <div className="alias-list">
                      {selected.aliases.map(alias => <Tag key={`${alias.name}-${alias.firstSeenEpisode}`}>{alias.name}</Tag>)}
                    </div>
                  </div>
                )}
                {validEvidence.length > 0 && (
                  <div className="dossier-block">
                    <h3>可核验出场线索</h3>
                    <ol className="evidence-list">
                      {validEvidence.map((appearance, index) => (
                        <li key={`${appearance.episode}-${index}`}>
                          <span>第 {appearance.episode} 集</span>
                          <p>{appearance.details.join('；')}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            )}
          </aside>
        </section>
      )}
    </main>
  )
}

export default CharacterRegistry
