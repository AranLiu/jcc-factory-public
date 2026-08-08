export const closeEditingState = (editing, key) => ({ ...editing, [key]: false })

export const removeTemporaryValue = (tempValues, key) => {
  const next = { ...tempValues }
  delete next[key]
  return next
}

export const openSecretEditingState = (editing, key) => ({ ...editing, [key]: true })

export const createEmptySecretDraft = (tempValues, key) => ({ ...tempValues, [key]: '' })

export function closeEditor(editing, tempValues, key) {
  return {
    editing: closeEditingState(editing, key),
    tempValues: removeTemporaryValue(tempValues, key),
  }
}

export async function saveAndCloseEditor({ key, save, setEditing, setTempValues }) {
  await save()
  setEditing(current => closeEditingState(current, key))
  setTempValues(current => removeTemporaryValue(current, key))
}

export function openWriteOnlySecretEditor(editing, tempValues, key) {
  return {
    editing: openSecretEditingState(editing, key),
    tempValues: createEmptySecretDraft(tempValues, key),
  }
}
