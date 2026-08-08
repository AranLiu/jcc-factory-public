const path = require('node:path')

function extractEpisodeNumber(fileName) {
  const baseName = path.parse(String(fileName || '')).name
  const explicit = baseName.match(/第\s*(\d{1,4})\s*集/i)
  const numeric = explicit || baseName.match(/(?:^|\D)(\d{1,4})(?:\D|$)/)
  const episode = Number(numeric?.[1])
  return Number.isInteger(episode) && episode > 0 ? episode : null
}

function buildCharacterGraphSegments(rows = []) {
  const latestByFile = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const fileId = Number(row?.file_id)
    const content = String(row?.result || '').trim()
    if (!Number.isInteger(fileId) || fileId <= 0 || !content || latestByFile.has(fileId)) continue
    latestByFile.set(fileId, { ...row, content })
  }

  const usedIds = new Set()
  return [...latestByFile.values()]
    .map(row => ({ ...row, episode: extractEpisodeNumber(row.original_name) }))
    .sort((left, right) => {
      if (left.episode !== null && right.episode !== null) return left.episode - right.episode
      if (left.episode !== null) return -1
      if (right.episode !== null) return 1
      return Number(left.file_id) - Number(right.file_id)
    })
    .map(row => {
      const baseId = row.episode ? `episode_${row.episode}` : `file_${row.file_id}`
      const id = usedIds.has(baseId) ? `${baseId}_file_${row.file_id}` : baseId
      usedIds.add(id)
      return {
        id,
        episode: row.episode,
        title: row.episode ? `第${row.episode}集` : String(row.original_name || `文件 ${row.file_id}`),
        content: row.content,
        fileId: Number(row.file_id),
        fileName: String(row.original_name || ''),
        sourceTaskId: Number(row.id),
      }
    })
}

function serializeIntegration(task) {
  const content = String(task?.result || '')
  return {
    id: task.id,
    content,
    preview: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
    createdAt: task.created_at,
    updatedAt: task.completed_at || task.created_at,
    taskType: task.task_type,
    sourceType: task.task_type === 'character_integration' ? 'AI整合结果' : '手动录入内容',
  }
}

async function getStep3CharacterSources(pool, projectId) {
  const [integrationRows] = await pool.execute(
    `SELECT id, result, created_at, completed_at, task_type
       FROM ai_tasks
      WHERE project_id = ?
        AND task_type IN ('character_integration', 'global_character_content')
        AND status = 'completed'
      ORDER BY created_at DESC`,
    [projectId]
  )
  const [graphRows] = await pool.execute(
    `SELECT at.id, at.file_id, at.result, at.created_at, f.original_name
       FROM ai_tasks at
       JOIN files f ON f.id = at.file_id AND f.project_id = at.project_id
      WHERE at.project_id = ?
        AND at.task_type = 'character_graph'
        AND at.status = 'completed'
        AND at.result IS NOT NULL
      ORDER BY at.created_at DESC, at.id DESC`,
    [projectId]
  )

  return {
    integrations: integrationRows.map(serializeIntegration).filter(item => item.content.trim()),
    segments: buildCharacterGraphSegments(graphRows),
  }
}

module.exports = {
  buildCharacterGraphSegments,
  extractEpisodeNumber,
  getStep3CharacterSources,
}
