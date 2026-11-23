"""A tiny local index of the chats this backend created.

Orbit's Agent Chat API has no "list chats" endpoint, so the starter remembers the chats it
created (id, title, status ...) in a JSON file. Swap this for your own database in production.
"""
import json
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from orbit_agent_chat import Chat


class ChatStore:
    def __init__(self, data_dir: Path) -> None:
        self._path = data_dir / "chats.json"
        self._lock = threading.Lock()
        data_dir.mkdir(parents=True, exist_ok=True)

    def _read(self) -> Dict[str, Dict[str, Any]]:
        if not self._path.exists():
            return {}
        try:
            return json.loads(self._path.read_text("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _write(self, data: Dict[str, Dict[str, Any]]) -> None:
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
        tmp.replace(self._path)

    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            items = list(self._read().values())
        return sorted(items, key=lambda c: c.get("created_at", ""), reverse=True)

    def get(self, chat_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._read().get(chat_id)

    def upsert(self, chat: Chat, **extra: Any) -> Dict[str, Any]:
        with self._lock:
            data = self._read()
            record = {**data.get(chat.id, {}), **asdict(chat), **{k: v for k, v in extra.items() if v is not None}}
            data[chat.id] = record
            self._write(data)
            return record

    def remove(self, chat_id: str) -> bool:
        with self._lock:
            data = self._read()
            existed = data.pop(chat_id, None) is not None
            if existed:
                self._write(data)
            return existed
