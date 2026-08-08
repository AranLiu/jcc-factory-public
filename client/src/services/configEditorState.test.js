import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as editorState from './configEditorState'

const { closeEditor, openWriteOnlySecretEditor } = editorState

describe('system configuration editor state', () => {
  it('functionally removes both editing and temporary state after a successful save', () => {
    const previous = {
      editing: { gemini_api_key: true, gemini_default_model: true },
      tempValues: { gemini_api_key: 'replacement-secret', gemini_default_model: 'model-v2' },
    }
    const next = closeEditor(previous.editing, previous.tempValues, 'gemini_api_key')

    expect(next).toEqual({
      editing: { gemini_api_key: false, gemini_default_model: true },
      tempValues: { gemini_default_model: 'model-v2' },
    })
    expect(previous.editing.gemini_api_key).toBe(true)
    expect(previous.tempValues.gemini_api_key).toBe('replacement-secret')
  })

  it('opens write-only secret editors with an empty replacement draft', () => {
    expect(openWriteOnlySecretEditor(
      { gemini_api_key: false, proxy_service_auth_token: false },
      { gemini_api_key: '[REDACTED]', proxy_service_auth_token: 'old-draft' },
      'gemini_api_key'
    )).toEqual({
      editing: { gemini_api_key: true, proxy_service_auth_token: false },
      tempValues: { gemini_api_key: '', proxy_service_auth_token: 'old-draft' },
    })
  })

  it('clears each plaintext secret immediately after its server save succeeds and is used by SystemConfig', async () => {
    expect(typeof editorState.saveAndCloseEditor).toBe('function')

    for (const key of ['gemini_api_key', 'proxy_service_auth_token']) {
      const secret = `replacement-${key}`
      const events = []
      let editing = { [key]: true, unrelated: true }
      let tempValues = { [key]: secret, unrelated: 'keep' }

      await editorState.saveAndCloseEditor({
        key,
        save: async () => { events.push('server-success') },
        setEditing: update => {
          editing = update(editing)
          events.push('editing-cleared')
        },
        setTempValues: update => {
          tempValues = update(tempValues)
          events.push('plaintext-removed')
        },
      })

      expect(events).toEqual(['server-success', 'editing-cleared', 'plaintext-removed'])
      expect(editing).toEqual({ [key]: false, unrelated: true })
      expect(tempValues).toEqual({ unrelated: 'keep' })
    }

    const componentSource = readFileSync(new URL('../pages/SystemConfig.jsx', import.meta.url), 'utf8')
    expect(componentSource).toContain("setGeminiKeyDraft('')")
    expect(componentSource).toContain("setRelayDraft(current => ({ ...current, token: '' }))")
    expect(componentSource).toContain('autoComplete="new-password"')
  })
})
