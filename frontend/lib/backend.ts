// Calls to the Python backend (proxied by Next.js at /api/backend/*). The backend holds the
// Orbit API token; the browser only ever receives short-lived chat tokens.
import { AgentChatError, type AgentChat, type AgentChatMessage } from '@zilliz/orbit-agent-chat'

export interface ChatRecord extends AgentChat {
  title?: string
  requesterEmail?: string
}

export interface HistoryItemInput {
  role: 'user' | 'assistant'
  content: string
}

export interface CreateChatInput {
  title: string
  description: string
  session_id: string
  uuid: string
  idempotency_key?: string
  requester_email?: string
  history?: HistoryItemInput[]
  note?: string
  payload?: Record<string, unknown>
}

const BASE = '/api/backend'

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    throw new AgentChatError({ status: 0, code: 'network_error', message: String(cause) })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = data?.error ?? {}
    const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? '')
    throw new AgentChatError({
      status: res.status,
      code: err.code ?? `http_${res.status}`,
      message: err.message ?? detail ?? res.statusText,
      requestId: err.requestId,
      details: err.details,
      // Lets the browser SDK treat a refused token request as fatal.
      fatal: res.status === 401 || res.status === 403 || res.status === 404,
    })
  }
  return data as T
}

export const backend = {
  listChats: () => call<{ chats: ChatRecord[] }>('GET', '/chats'),
  createChat: (input: CreateChatInput) => call<{ chat: ChatRecord; replayed: boolean }>('POST', '/chats', input),
  issueToken: (chatId: string) =>
    call<{ token: string; expiresAt: string }>('POST', `/chats/${encodeURIComponent(chatId)}/token`),
  closeChat: (chatId: string) => call<{ chat: ChatRecord }>('POST', `/chats/${encodeURIComponent(chatId)}/close`),
  listMessages: (chatId: string, after = 0, limit = 100) =>
    call<{ chat: ChatRecord; messages: AgentChatMessage[] }>(
      'GET',
      `/chats/${encodeURIComponent(chatId)}/messages?after=${after}&limit=${limit}`,
    ),
  sendMessage: (chatId: string, body: string) =>
    call<{ message: AgentChatMessage }>('POST', `/chats/${encodeURIComponent(chatId)}/messages`, { body }),
  forgetChat: (chatId: string) => call<{ ok: true }>('DELETE', `/chats/${encodeURIComponent(chatId)}`),
}

/** The Orbit base URL for the browser SDK, from ORBIT_BASE_URL in the root .env. */
export function orbitBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_ORBIT_BROWSER_PROXY === 'true') return `${window.location.origin}/orbit`
  return process.env.NEXT_PUBLIC_ORBIT_BASE_URL ?? ''
}
