import hmac
import logging
import os
import time
from pathlib import Path
from threading import Lock
from typing import Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")


def _parse_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return int(raw)
    except ValueError:
        return default


API_KEY = os.getenv("MT5_API_KEY", "therng").strip()
ALIVE_WINDOW_SEC = max(1, _parse_int_env("ALIVE_WINDOW_SEC", 120))
REPORTS_DIR = Path(os.getenv("REPORTS_DIR", Path(__file__).resolve().parent / "reports")).resolve()
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("quantum_api")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Quantum Alive API", version="1.0.0")


class AlivePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tid: str = Field(min_length=1, max_length=128)
    trade_allow: bool
    algo_allow: bool
    uptime_algo: int = Field(ge=0)
    latency_ms: Optional[int] = Field(default=None, ge=0)


class AliveRecord(BaseModel):
    received_at: int
    payload: AlivePayload


class AliveAck(BaseModel):
    ok: bool
    terminal_id: str
    received_at: int


_latest_alive: Dict[str, AliveRecord] = {}
_store_lock = Lock()


def _is_authorized(x_api_key: Optional[str]) -> bool:
    if not API_KEY:
        return True
    if not x_api_key:
        return False
    return hmac.compare_digest(x_api_key.strip(), API_KEY)


def _require_api_key(x_api_key: Optional[str]) -> None:
    if not _is_authorized(x_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


def _alive_terminal_ids(now_epoch: Optional[int] = None) -> list[str]:
    now_epoch = int(time.time()) if now_epoch is None else now_epoch
    threshold = now_epoch - ALIVE_WINDOW_SEC

    with _store_lock:
        return sorted(
            terminal_id
            for terminal_id, record in _latest_alive.items()
            if record.received_at >= threshold
        )


def _history_file_for_terminal(terminal_id: str) -> Path:
    sanitized = terminal_id.strip()
    if not sanitized or "/" in sanitized or "\\" in sanitized or ".." in sanitized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid terminal_id",
        )

    return REPORTS_DIR / f"{sanitized}.html"


@app.get("/", include_in_schema=False)
def root() -> dict[str, object]:
    return {
        "ok": True,
        "service": app.title,
        "version": app.version,
        "alive": "/alive",
        "all": "/all",
        "history_example": "/history/Arisa",
    }


@app.post("/alive", response_model=AliveAck)
def post_alive(
    payload: AlivePayload,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> AliveAck:
    _require_api_key(x_api_key)

    received_at = int(time.time())
    record = AliveRecord(received_at=received_at, payload=payload)

    with _store_lock:
        _latest_alive[payload.tid] = record

    logger.info("alive tid=%s trade_allow=%s algo_allow=%s latency_ms=%s",
                payload.tid,
                payload.trade_allow,
                payload.algo_allow,
                payload.latency_ms)

    return AliveAck(ok=True, terminal_id=payload.tid, received_at=received_at)


@app.get("/alive")
def get_alive() -> dict[str, object]:
    terminal_ids = _alive_terminal_ids()
    return {
        "ok": True,
        "alive_window_sec": ALIVE_WINDOW_SEC,
        "alive_count": len(terminal_ids),
        "terminal_ids": terminal_ids,
    }


@app.get("/all")
def get_all() -> dict[str, object]:
    return {"terminal_ids": _alive_terminal_ids()}


@app.get("/history/{terminal_id}")
def get_history(terminal_id: str) -> FileResponse:
    report_path = _history_file_for_terminal(terminal_id)
    if not report_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Report not found for terminal_id={terminal_id}",
        )

    return FileResponse(
        path=report_path,
        media_type="text/html",
        filename=report_path.name,
    )
