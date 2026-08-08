function normalizeDirectSegments(value) {
  if (!Array.isArray(value)) return []
  return value.map(segment => ({
    id: String(segment?.id || '').trim(),
    episode: Number.isInteger(Number(segment?.episode)) ? Number(segment.episode) : null,
    title: String(segment?.title || '').trim(),
    content: String(segment?.content || '').trim(),
    fileId: Number(segment?.fileId) || null,
    fileName: String(segment?.fileName || '').trim(),
  })).filter(segment => segment.id && segment.title && segment.content)
}

function resolveCharacterEpisodeSegments(response, parseFallback) {
  const directSegments = normalizeDirectSegments(response?.segments)
  if (directSegments.length > 0) return directSegments

  const latestIntegration = Array.isArray(response?.data) ? response.data[0] : null
  if (!latestIntegration?.content || typeof parseFallback !== 'function') return []
  return parseFallback(latestIntegration.content)
}

export { resolveCharacterEpisodeSegments }
