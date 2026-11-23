"""Settings, read from the repository-root .env (shared with the Next.js frontend)."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    orbit_base_url: str
    orbit_api_token: str
    frontend_origin: str
    data_dir: Path


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value or value == "replace-me":
        raise RuntimeError(f"{name} is not set; copy .env.example to .env and fill it in")
    return value


def load_settings() -> Settings:
    return Settings(
        orbit_base_url=_required("ORBIT_BASE_URL").rstrip("/"),
        orbit_api_token=_required("ORBIT_API_TOKEN"),
        frontend_origin=os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000"),
        data_dir=Path(os.environ.get("DATA_DIR", ROOT_DIR / "backend" / "data")),
    )
