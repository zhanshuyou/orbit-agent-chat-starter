# agent-chat-starter

把 AI Agent 的对话转交给 Orbit 人工客服的最小可运行示例：

- **backend/** — Python (FastAPI) + [`orbit-agent-chat`](https://pypi.org/project/orbit-agent-chat/)，持有 Orbit API token
- **frontend/** — Next.js + [`@zilliz/orbit-agent-chat`](https://www.npmjs.com/package/@zilliz/orbit-agent-chat)，用短期 chat token 直连 Orbit 实时流

```
浏览器 (Next.js)                         Python backend (FastAPI)              Orbit
 ├─ /api/backend/* ──(Next rewrite)──▶  OrbitAgentChatClient ──Bearer API token──▶ /api/agent-chats/...
 └─ connectAgentChat ───────────── AgentChat <chat token> ─────────────────────────▶ /stream, /messages
```

## 覆盖的 Orbit Agent Chat 接口

| Orbit 接口 | 凭证 | 在本项目中 |
| --- | --- | --- |
| `POST /api/agent-chats` 创建会话（含 history / note / payload / requesterEmail / 幂等键） | API token | 后端 `POST /api/chats` → `create_chat`；前端「New handoff」表单 |
| `POST /api/agent-chats/{id}/tokens` 签发 chat token | API token | 后端 `POST /api/chats/{id}/token` → `issue_token`；前端 SDK 的 `getToken` |
| `POST /api/agent-chats/{id}/close` 关闭会话 | API token | 后端 `POST /api/chats/{id}/close` → `close_chat`；前端「Close chat」 |
| `GET /api/agent-chats/{id}/messages` 读历史 | API token / chat token | 后端 `GET /api/chats/{id}/messages` → `list_messages`；前端「Reload (API token)」/「Reload (chat token)」→ `fetchHistory` |
| `POST /api/agent-chats/{id}/messages` 发客户消息 | API token / chat token | 后端 `POST /api/chats/{id}/messages` → `send_message`；前端输入框（可选 via browser / via backend） |
| `GET /api/agent-chats/{id}/stream` 实时推送 (SSE) | chat token | 前端 `connectAgentChat`：自动重连、token 续期、断点续传 |

Orbit 没有「列出会话」接口，后端把自己创建过的会话记在 `backend/data/chats.json`（侧边栏列表），生产环境请换成你自己的数据库。

## 配置

```bash
cp .env.example .env
```

在**仓库根目录**的 `.env` 里填写（前后端共用这一个文件）：

| 变量 | 说明 |
| --- | --- |
| `ORBIT_BASE_URL` | Orbit 地址，如 `https://support.example.com`。后端 SDK 和浏览器 SDK 都用它 |
| `ORBIT_API_TOKEN` | Orbit API token：控制台 **API tokens**（`/internal/api-tokens`）新建，类型 **API Client**，只勾 `agent_chat:write`。只在后端使用，不会下发到浏览器 |
| `ORBIT_BROWSER_PROXY` | `false`（默认）：浏览器直连 Orbit，需管理员在 **CORS Origins**（`/internal/cors-origins`）把前端 origin 加为 *Agent chat* 用途。`true`：经 Next.js 的 `/orbit/*` 代理，本地开发免配 CORS |
| `BACKEND_URL` / `BACKEND_PORT` | 前端代理到的后端地址，默认 `http://127.0.0.1:8000` |
| `FRONTEND_ORIGIN` | 后端 CORS 放行的前端 origin（默认 `http://localhost:3000`） |

> 更换 token 的 secret 请在 Orbit 控制台对原 token 点 **Rotate**；新建一个 token 会被视为新的集成，已有会话将全部失效。

## 运行

需要 Python 3.10+ 与 [uv](https://docs.astral.sh/uv/)、Node 18+ 与 pnpm（或 npm）。

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && pnpm install && pnpm dev
```

打开 http://localhost:3000 → **+ New handoff** 填写并创建 → 在 Orbit 控制台对应工单里回复，客服消息会实时出现在页面上。

## 目录

```
backend/app/main.py       FastAPI 路由，全部通过 AsyncOrbitAgentChatClient 调 Orbit
backend/app/config.py     读取根目录 .env
backend/app/store.py      本地会话索引（JSON 文件）
frontend/next.config.ts   读取根目录 .env；/api/backend/* 与可选 /orbit/* 代理
frontend/lib/backend.ts   调后端的封装；orbitBaseUrl()
frontend/components/      ChatApp（列表）、NewChatForm（创建）、ChatPanel（实时会话）
```

## 错误处理要点

- 后端把 Orbit 的 HTTP 状态码与 `{ error: { code, message, requestId, details, retryAfter } }` 原样透传（网络错误映射为 502）。
- `getToken` 遇到 401 / 403 / 404 抛出 `fatal` 的 `AgentChatError`，SDK 停止重连并通过 `onError` 报告；其他失败按退避自动重试。
- `send_message` 只在 429 时重试，避免重复发消息；遇到 `network_error` 可先 Reload 确认是否已送达。
