'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AgentChatError,
  connectAgentChat,
  type AgentChatConnection,
  type AgentChatMessage,
  type AgentChatStatus,
} from '@zilliz/orbit-agent-chat'
import { backend, orbitBaseUrl, type ChatRecord } from '@/lib/backend'

type SendVia = 'browser' | 'backend'

const ERROR_HINTS: Record<string, string> = {
  agent_chat_closed: 'The chat or its ticket is closed.',
  agent_chat_not_found: 'The chat does not exist or belongs to another API client.',
  agent_chat_stream_limit: 'Too many streams open on this chat (max 5).',
  token_request_failed: 'The backend refused to issue a chat token.',
  network_error: 'No response reached the client (check CORS origins in Orbit, or set ORBIT_BROWSER_PROXY=true).',
}

function describe(err: unknown): string {
  if (err instanceof AgentChatError) {
    const hint = ERROR_HINTS[err.code]
    return `${err.code} (${err.status})${hint ? ` — ${hint}` : `: ${err.message}`}${err.retryAfter ? ` Retry in ${err.retryAfter}s.` : ''}`
  }
  return err instanceof Error ? err.message : String(err)
}

function upsert(list: AgentChatMessage[], incoming: AgentChatMessage[]): AgentChatMessage[] {
  const bySeq = new Map(list.map((m) => [m.seq, m]))
  for (const m of incoming) bySeq.set(m.seq, m)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export function ChatPanel({ chat, onChatChanged }: { chat: ChatRecord; onChatChanged: (chat: ChatRecord) => void }) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([])
  const [status, setStatus] = useState<AgentChatStatus>(chat.status)
  const [fatal, setFatal] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sendVia, setSendVia] = useState<SendVia>('browser')
  const [busy, setBusy] = useState(false)
  const [connKey, setConnKey] = useState(0)
  const connection = useRef<AgentChatConnection | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)

  // Realtime stream: GET /api/agent-chats/{id}/stream with a chat token, straight from the browser.
  useEffect(() => {
    setMessages([])
    setFatal(null)
    setActionError(null)
    const conn = connectAgentChat({
      baseUrl: orbitBaseUrl(),
      chatId: chat.id,
      // Must return a *fresh* token every call: POST /api/agent-chats/{id}/tokens via our backend.
      getToken: async () => {
        const { token, expiresAt } = await backend.issueToken(chat.id)
        setTokenExpiresAt(expiresAt)
        return token
      },
      onMessage: (m) => setMessages((list) => upsert(list, [m])),
      onStatus: setStatus,
      onError: (e) => setFatal(describe(e)),
    })
    connection.current = conn
    return () => {
      conn.close()
      connection.current = null
    }
  }, [chat.id, connKey])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError(describe(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    void run(async () => {
      if (sendVia === 'browser') {
        // POST /api/agent-chats/{id}/messages with the chat token; reaches onMessage once.
        const conn = connection.current
        if (!conn) throw new Error('not connected')
        await conn.sendMessage(body)
      } else {
        // Same endpoint with the API token, via the Python SDK; arrives here over the stream.
        const { message } = await backend.sendMessage(chat.id, body)
        setMessages((list) => upsert(list, [message]))
      }
      setDraft('')
    })
  }

  const closeChat = () =>
    run(async () => {
      if (!confirm('Close this chat? The customer can no longer post messages.')) return
      const { chat: updated } = await backend.closeChat(chat.id)
      setStatus(updated.status)
      onChatChanged(updated)
    })

  const reloadHistory = (via: SendVia) =>
    run(async () => {
      const page =
        via === 'browser'
          ? await connection.current!.fetchHistory({ after: 0, limit: 200 })
          : await backend.listMessages(chat.id, 0, 200)
      setMessages((list) => upsert(list, page.messages))
      setStatus(page.chat.status)
      if (via === 'backend') onChatChanged(page.chat as ChatRecord)
    })

  const closed = status === 'closed'

  return (
    <section className="panel chat">
      <header className="panel-head chat-head">
        <div>
          <h2>{chat.title ?? `Chat ${chat.id.slice(0, 8)}`}</h2>
          <p className="muted meta">
            Ticket #{chat.ticketNumber} · chat <code>{chat.id}</code> · session <code>{chat.sessionId}</code> · user{' '}
            <code>{chat.uuid}</code>
          </p>
        </div>
        <span className={`badge ${closed ? 'closed' : 'open'}`}>{status}</span>
      </header>

      <div className="toolbar">
        <button className="ghost" disabled={busy || !connection.current} onClick={() => reloadHistory('browser')}>
          Reload (chat token)
        </button>
        <button className="ghost" disabled={busy} onClick={() => reloadHistory('backend')}>
          Reload (API token)
        </button>
        <button className="ghost" disabled={busy} onClick={() => setConnKey((k) => k + 1)}>
          Reconnect stream
        </button>
        <span className="spacer" />
        {tokenExpiresAt && <span className="muted small">chat token until {new Date(tokenExpiresAt).toLocaleTimeString()}</span>}
        <button className="danger" disabled={busy || closed} onClick={closeChat}>
          Close chat
        </button>
      </div>

      {fatal && <p className="error">Stream stopped: {fatal}</p>}
      {actionError && <p className="error">{actionError}</p>}

      <ol className="messages">
        {messages.length === 0 && <li className="empty muted">Waiting for messages…</li>}
        {messages.map((m) => (
          <li key={m.seq} className={`msg ${m.role}`}>
            <div className="bubble">
              <div className="who">
                {m.role === 'staff' ? (m.authorName ?? 'Support') : m.role === 'history' ? 'History' : 'Customer'}
                <span className="muted small"> · #{m.seq} · {new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="body">{m.body}</div>
            </div>
          </li>
        ))}
        <div ref={bottom} />
      </ol>

      <form className="composer" onSubmit={send}>
        <textarea
          rows={2}
          value={draft}
          disabled={closed}
          placeholder={closed ? 'This chat is closed.' : 'Message support… (Enter to send, Shift+Enter for newline)'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <div className="composer-side">
          <select value={sendVia} onChange={(e) => setSendVia(e.target.value as SendVia)} title="Which credential posts the message">
            <option value="browser">via browser (chat token)</option>
            <option value="backend">via backend (API token)</option>
          </select>
          <button type="submit" disabled={busy || closed || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  )
}
