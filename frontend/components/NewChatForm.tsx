'use client'

import { useState } from 'react'
import { backend, type ChatRecord, type HistoryItemInput } from '@/lib/backend'

const rid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()))

export function NewChatForm({ onCreated, onCancel }: { onCreated: (chat: ChatRecord) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sessionId, setSessionId] = useState(() => `sess-${rid().slice(0, 8)}`)
  const [uuid, setUuid] = useState(() => `user-${rid().slice(0, 8)}`)
  const [email, setEmail] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [note, setNote] = useState('')
  const [payload, setPayload] = useState('')
  const [history, setHistory] = useState<HistoryItemInput[]>([
    { role: 'user', content: "I can't log in" },
    { role: 'assistant', content: 'Let me hand you to a human' },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const updateHistory = (i: number, patch: Partial<HistoryItemInput>) =>
    setHistory((h) => h.map((item, j) => (j === i ? { ...item, ...patch } : item)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    let parsedPayload: Record<string, unknown> | undefined
    if (payload.trim()) {
      try {
        parsedPayload = JSON.parse(payload)
        if (typeof parsedPayload !== 'object' || parsedPayload === null || Array.isArray(parsedPayload)) {
          throw new Error('payload must be a JSON object')
        }
      } catch (err) {
        setError(`Payload: ${(err as Error).message}`)
        return
      }
    }
    setBusy(true)
    try {
      const items = history.filter((h) => h.content.trim())
      const { chat, replayed } = await backend.createChat({
        title,
        description,
        session_id: sessionId,
        uuid,
        idempotency_key: idempotencyKey || undefined,
        requester_email: email || undefined,
        history: items.length ? items : undefined,
        note: note || undefined,
        payload: parsedPayload,
      })
      if (replayed) setNotice('Idempotency key seen before: Orbit returned the original chat.')
      onCreated(chat)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setError(`${e.code ?? 'error'}: ${e.message ?? String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <header className="panel-head">
        <h2>Hand off to a human</h2>
        <p className="muted">Creates an Orbit ticket with an Agent chat (POST /api/agent-chats).</p>
      </header>

      <div className="grid2">
        <label>
          Title *
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cannot reset my password" />
        </label>
        <label>
          Requester email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </label>
      </div>
      <label>
        Description *
        <textarea required rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The reset email never arrives." />
      </label>
      <div className="grid2">
        <label>
          Session ID *
          <input required value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
        </label>
        <label>
          End-user UUID *
          <input required value={uuid} onChange={(e) => setUuid(e.target.value)} />
        </label>
      </div>

      <fieldset>
        <legend>Conversation so far (history)</legend>
        {history.map((h, i) => (
          <div className="history-row" key={i}>
            <select value={h.role} onChange={(e) => updateHistory(i, { role: e.target.value as HistoryItemInput['role'] })}>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
            <input value={h.content} onChange={(e) => updateHistory(i, { content: e.target.value })} />
            <button type="button" className="ghost" onClick={() => setHistory((list) => list.filter((_, j) => j !== i))} aria-label="Remove">
              ×
            </button>
          </div>
        ))}
        <button type="button" className="ghost" onClick={() => setHistory((list) => [...list, { role: 'user', content: '' }])}>
          + Add message
        </button>
      </fieldset>

      <details>
        <summary>Staff-only context & idempotency</summary>
        <label>
          Note (≤ 2000 chars, staff only)
          <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label>
          Payload (JSON object, staff only)
          <textarea rows={3} className="mono" value={payload} onChange={(e) => setPayload(e.target.value)} placeholder='{"plan": "pro", "agentState": "..."}' />
        </label>
        <label>
          Idempotency key (blank = SDK generates one)
          <input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} />
        </label>
      </details>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create chat'}
        </button>
      </div>
    </form>
  )
}
