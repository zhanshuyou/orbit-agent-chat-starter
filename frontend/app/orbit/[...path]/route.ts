// Same-origin proxy to Orbit for the browser SDK (enabled by ORBIT_BROWSER_PROXY=true), so local
// development works without adding a CORS origin in Orbit. Streams the response body as-is, which
// keeps the SSE stream (GET /api/agent-chats/{id}/stream) live. Only Agent Chat paths are forwarded,
// and only the browser's own chat token: the API token never passes through here.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FORWARD_REQUEST_HEADERS = ['authorization', 'accept', 'content-type', 'last-event-id', 'idempotency-key']
const FORWARD_RESPONSE_HEADERS = ['content-type', 'retry-after', 'x-request-id']

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (process.env.NEXT_PUBLIC_ORBIT_BROWSER_PROXY !== 'true') {
    return Response.json({ error: { code: 'proxy_disabled', message: 'Set ORBIT_BROWSER_PROXY=true' } }, { status: 404 })
  }
  const { path } = await params
  if (path[0] !== 'api' || path[1] !== 'agent-chats') {
    return Response.json({ error: { code: 'not_found', message: 'Only /api/agent-chats is proxied' } }, { status: 404 })
  }

  const target = new URL(`${process.env.NEXT_PUBLIC_ORBIT_BASE_URL}/${path.map(encodeURIComponent).join('/')}`)
  target.search = new URL(request.url).search

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      signal: request.signal, // closing the browser stream closes the upstream one
      cache: 'no-store',
    })
  } catch (cause) {
    return Response.json(
      { error: { code: 'orbit_unreachable', message: cause instanceof Error ? cause.message : String(cause) } },
      { status: 502 },
    )
  }

  const out = new Headers()
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) out.set(name, value)
  }
  if (out.get('content-type')?.includes('text/event-stream')) {
    out.set('cache-control', 'no-cache, no-transform')
    out.set('x-accel-buffering', 'no')
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export { proxy as GET, proxy as POST }
