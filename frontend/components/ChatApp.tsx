'use client'

import { useCallback, useEffect, useState } from 'react'
import { backend, type ChatRecord } from '@/lib/backend'
import { ChatPanel } from './ChatPanel'
import { NewChatForm } from './NewChatForm'

export function ChatApp() {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { chats } = await backend.listChats()
      setChats(chats)
      setError(null)
    } catch (err) {
      setError(`Backend unreachable: ${(err as Error).message}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const replace = (chat: ChatRecord) =>
    setChats((list) => {
      const rest = list.filter((c) => c.id !== chat.id)
      const prev = list.find((c) => c.id === chat.id)
      return [{ ...prev, ...chat }, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    })

  const forget = async (id: string) => {
    if (!confirm('Remove this chat from the local list? The Orbit ticket is not touched.')) return
    await backend.forgetChat(id).catch(() => undefined)
    if (selected === id) setSelected(null)
    void refresh()
  }

  const current = chats.find((c) => c.id === selected) ?? null

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" /> agent-chat-starter
        </div>
        <button className="new" onClick={() => { setCreating(true); setSelected(null) }}>
          + New handoff
        </button>
        {error && <p className="error small">{error}</p>}
        <ul className="chat-list">
          {chats.length === 0 && !error && <li className="muted small pad">No chats yet.</li>}
          {chats.map((c) => (
            <li key={c.id} className={c.id === selected ? 'active' : ''}>
              <button className="item" onClick={() => { setSelected(c.id); setCreating(false) }}>
                <span className="title">{c.title ?? c.id}</span>
                <span className="muted small">
                  #{c.ticketNumber} · <span className={`pill ${c.status}`}>{c.status}</span>
                </span>
              </button>
              <button className="forget" title="Remove from list" onClick={() => forget(c.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="main">
        {creating ? (
          <NewChatForm
            onCancel={() => setCreating(false)}
            onCreated={(chat) => {
              replace(chat)
              setCreating(false)
              setSelected(chat.id)
            }}
          />
        ) : current ? (
          <ChatPanel key={current.id} chat={current} onChatChanged={replace} />
        ) : (
          <div className="placeholder">
            <h1>Hand AI conversations to human support</h1>
            <p className="muted">
              Create a handoff to open an Orbit ticket with an Agent chat. Staff replies stream in live through{' '}
              <code>@zilliz/orbit-agent-chat</code>; the backend uses <code>orbit-agent-chat</code> with your API token.
            </p>
            <button onClick={() => setCreating(true)}>+ New handoff</button>
          </div>
        )}
      </main>
    </div>
  )
}
