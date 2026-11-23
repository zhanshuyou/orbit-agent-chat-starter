"""Agent backend: wraps every Orbit Agent Chat API call that needs the API token.

Orbit endpoint (API token)                      ->  this backend
POST /api/agent-chats                           ->  POST /api/chats
POST /api/agent-chats/{id}/tokens               ->  POST /api/chats/{id}/token
POST /api/agent-chats/{id}/close                ->  POST /api/chats/{id}/close
GET  /api/agent-chats/{id}/messages             ->  GET  /api/chats/{id}/messages
POST /api/agent-chats/{id}/messages             ->  POST /api/chats/{id}/messages
GET  /api/agent-chats/{id}/stream               ->  browser, via @zilliz/orbit-agent-chat (chat token)

The browser never sees ORBIT_API_TOKEN: it only gets 15-minute chat tokens from /token.
"""
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from orbit_agent_chat import AsyncOrbitAgentChatClient, HistoryItem, OrbitAgentChatError
from pydantic import BaseModel, Field

from .config import load_settings
from .store import ChatStore

settings = load_settings()
store = ChatStore(settings.data_dir)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncOrbitAgentChatClient(settings.orbit_base_url, settings.orbit_api_token) as client:
        app.state.orbit = client
        yield


app = FastAPI(title="agent-chat-starter backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


def camel(data: Dict[str, Any]) -> Dict[str, Any]:
    """snake_case SDK dataclasses -> the camelCase shape the browser SDK uses."""
    def key(k: str) -> str:
        head, *rest = k.split("_")
        return head + "".join(w.title() for w in rest)

    return {key(k): v for k, v in data.items()}


def orbit(request: Request) -> AsyncOrbitAgentChatClient:
    return request.app.state.orbit


@app.exception_handler(OrbitAgentChatError)
async def orbit_error_handler(_: Request, exc: OrbitAgentChatError) -> JSONResponse:
    # Pass Orbit's status through (the frontend's getToken relies on 401/403/404 being fatal);
    # a network failure (status 0) becomes 502.
    status = exc.status or 502
    headers = {"retry-after": str(int(exc.retry_after))} if exc.retry_after else None
    return JSONResponse(
        status_code=status,
        headers=headers,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "requestId": exc.request_id,
                "details": exc.details,
                "retryAfter": exc.retry_after,
            }
        },
    )


# ---------- request bodies ----------


class HistoryItemIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: Optional[str] = None


class CreateChatIn(BaseModel):
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    uuid: str = Field(min_length=1)
    idempotency_key: Optional[str] = None
    requester_email: Optional[str] = None
    history: Optional[List[HistoryItemIn]] = None
    note: Optional[str] = Field(default=None, max_length=2000)
    payload: Optional[Dict[str, Any]] = None


class SendMessageIn(BaseModel):
    body: str = Field(min_length=1)


# ---------- routes ----------


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "orbitBaseUrl": settings.orbit_base_url}


@app.get("/api/chats")
async def list_chats() -> Dict[str, Any]:
    """Chats this backend created (local index; Orbit has no list endpoint)."""
    return {"chats": [camel(c) for c in store.list()]}


@app.post("/api/chats", status_code=201)
async def create_chat(body: CreateChatIn, request: Request) -> Dict[str, Any]:
    result = await orbit(request).create_chat(
        title=body.title,
        description=body.description,
        session_id=body.session_id,
        uuid=body.uuid,
        idempotency_key=body.idempotency_key or None,
        requester_email=body.requester_email or None,
        history=[HistoryItem(h.role, h.content, h.created_at) for h in body.history] if body.history else None,
        note=body.note or None,
        payload=body.payload,
    )
    record = store.upsert(result.chat, title=body.title, requester_email=body.requester_email)
    return {"chat": camel(record), "replayed": result.replayed}


@app.post("/api/chats/{chat_id}/token")
async def issue_token(chat_id: str, request: Request) -> Dict[str, Any]:
    """A fresh 15-minute chat token for the browser. Never cached: the SDK asks again on expiry."""
    token = await orbit(request).issue_token(chat_id)
    return {"token": token.token, "expiresAt": token.expires_at}


@app.post("/api/chats/{chat_id}/close")
async def close_chat(chat_id: str, request: Request) -> Dict[str, Any]:
    chat = await orbit(request).close_chat(chat_id)
    return {"chat": camel(store.upsert(chat))}


@app.get("/api/chats/{chat_id}/messages")
async def list_messages(
    chat_id: str,
    request: Request,
    after: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
) -> Dict[str, Any]:
    page = await orbit(request).list_messages(chat_id, after=after, limit=limit)
    record = store.upsert(page.chat) if store.get(chat_id) else asdict(page.chat)
    return {"chat": camel(record), "messages": [camel(asdict(m)) for m in page.messages]}


@app.post("/api/chats/{chat_id}/messages", status_code=201)
async def send_message(chat_id: str, body: SendMessageIn, request: Request) -> Dict[str, Any]:
    """Posts a customer message from the Agent backend (e.g. your Agent relaying the user)."""
    message = await orbit(request).send_message(chat_id, body.body)
    return {"message": camel(asdict(message))}


@app.delete("/api/chats/{chat_id}")
async def forget_chat(chat_id: str) -> Dict[str, Any]:
    """Removes the chat from the local index only; the Orbit chat and ticket are untouched."""
    if not store.remove(chat_id):
        raise HTTPException(status_code=404, detail="chat not in local index")
    return {"ok": True}
