import bisect
import hmac
import logging
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Dict, List, Literal, Optional, Tuple

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from windows_monitor import MonitorUnavailableError, WindowsSystemMonitor

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")


# --- Optional ngrok support ---------------------------------------------------
# Enable by setting:
#   ENABLE_NGROK=1
#   NGROK_AUTHTOKEN=<your token>
# Optional:
#   NGROK_DOMAIN=<your reserved domain>
# When enabled, the app will start an ngrok HTTP tunnel to APP_PORT and print the public URL.
NGROK_PUBLIC_URL: Optional[str] = None


def _maybe_start_ngrok(port: int) -> Optional[str]:
    if not _parse_bool_env("ENABLE_NGROK", False):
        return None

    try:
        from pyngrok import ngrok  # type: ignore
    except Exception as exc:
        logger.warning("ENABLE_NGROK=1 but pyngrok is not installed (%s). Install: pip install pyngrok", exc)
        return None

    authtoken = os.getenv("NGROK_AUTHTOKEN", "").strip()
    if not authtoken:
        logger.warning("ENABLE_NGROK=1 but NGROK_AUTHTOKEN is empty. Skipping ngrok startup.")
        return None

    # Configure auth
    try:
        ngrok.set_auth_token(authtoken)
    except Exception as exc:
        logger.warning("Failed to set NGROK_AUTHTOKEN (%s). Skipping ngrok startup.", exc)
        return None

    # Start tunnel
    domain = os.getenv("NGROK_DOMAIN", "").strip()
    try:
        if domain:
            tunnel = ngrok.connect(addr=port, proto="http", bind_tls=True, domain=domain)
        else:
            tunnel = ngrok.connect(addr=port, proto="http", bind_tls=True)
        public_url = tunnel.public_url
        return public_url
    except Exception as exc:
        logger.warning("Failed to start ngrok tunnel (%s).", exc)
        return None
# -----------------------------------------------------------------------------



def _parse_api_keys() -> Tuple[str, ...]:
    keys_csv = os.getenv("MT5_API_KEYS", "")
    keys = [item.strip() for item in keys_csv.split(",") if item.strip()]
    single_key = os.getenv("MT5_API_KEY", "therng").strip()
    if single_key and single_key not in keys:
        keys.append(single_key)
    return tuple(keys)


def _parse_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return int(raw)
    except ValueError:
        return default


def _parse_float_env(name: str, default: float) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        return float(raw)
    except ValueError:
        return default


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, "1" if default else "0").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _parse_port_env(name: str, default: int) -> int:
    port = _parse_int_env(name, default)
    if 1 <= port <= 65535:
        return port
    return default


class AppConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    api_keys: Tuple[str, ...]
    read_api_keys: Tuple[str, ...]
    max_ts_drift_sec: int
    log_heartbeats: bool
    history_retention_sec: int
    history_max_points_per_terminal: int
    system_monitor_min_refresh_sec: float


def _parse_read_api_keys() -> Tuple[str, ...]:
    keys_csv = os.getenv("MT5_READ_API_KEYS", "")
    keys = [item.strip() for item in keys_csv.split(",") if item.strip()]
    single_key = os.getenv("MT5_READ_API_KEY", "").strip()
    if single_key and single_key not in keys:
        keys.append(single_key)
    return tuple(keys)


_WRITE_API_KEYS = _parse_api_keys()
_READ_API_KEYS = _parse_read_api_keys() or _WRITE_API_KEYS

CONFIG = AppConfig(
    api_keys=_WRITE_API_KEYS,
    read_api_keys=_READ_API_KEYS,
    max_ts_drift_sec=max(0, _parse_int_env("MT5_MAX_TS_DRIFT_SEC", 300)),
    log_heartbeats=_parse_bool_env("MT5_LOG_HEARTBEAT", True),
    history_retention_sec=max(3600, _parse_int_env("MT5_HISTORY_RETENTION_SEC", 45 * 24 * 60 * 60)),
    history_max_points_per_terminal=max(100, _parse_int_env("MT5_HISTORY_MAX_POINTS_PER_TERMINAL", 10000)),
    system_monitor_min_refresh_sec=max(0.2, _parse_float_env("SYSTEM_MONITOR_MIN_REFRESH_SEC", 1.0)),
)

logger = logging.getLogger("mt5_heartbeat")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="MT5 Heartbeat API", version="3.0.0")

@app.get("/", include_in_schema=False)
def root() -> dict[str, object]:
    return {
        "ok": True,
        "service": app.title,
        "version": app.version,
        "health": "/health",
    }


def _parse_cors_allow_origins() -> List[str]:
    raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if not raw:
        return []
    if raw == "*":
        return ["*"]
    return [item.strip() for item in raw.split(",") if item.strip()]


_cors_origins = _parse_cors_allow_origins()
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key", "Accept"],
        allow_credentials=False,
        max_age=600,
    )

STARTED_MONOTONIC = time.monotonic()
_latest_heartbeats: Dict[str, "StoredHeartbeatRecord"] = {}
_sorted_terminal_ids: List[str] = []
_heartbeat_history: Dict[str, List["StoredHeartbeatRecord"]] = {}
_history_points_total = 0
_store_lock = Lock()
_system_monitor = WindowsSystemMonitor(CONFIG.system_monitor_min_refresh_sec)

_PERIOD_WINDOWS = {
    "day": 24 * 60 * 60,
    "week": 7 * 24 * 60 * 60,
    "month": 30 * 24 * 60 * 60,
}

_PERIOD_DAYS = {
    "day": 1,
    "week": 7,
    "month": 30,
}


@dataclass(slots=True)
class StoredHeartbeatRecord:
    received_at: int
    payload: "HeartbeatPayload"


class HeartbeatPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    login: int = Field(description="MT5 account login ID")
    server: str = Field(min_length=1, max_length=128)
    terminal_id: str = Field(min_length=1, max_length=128)
    terminal_active: bool
    algo_active: bool
    ts: int = Field(description="Unix timestamp generated by MT5")
    account_name: Optional[str] = Field(default=None, max_length=256)
    latency_ms: Optional[int] = Field(default=None, ge=0)
    trades_last_3d: Optional[int] = Field(default=None, ge=0)
    volume_last_3d: Optional[float] = None
    profit_last_3d: Optional[float] = None
    trades_last_7d: Optional[int] = Field(default=None, ge=0)
    volume_last_7d: Optional[float] = None
    profit_last_7d: Optional[float] = None
    day_trades: Optional[int] = Field(default=None, ge=0)
    day_trades_long: Optional[int] = Field(default=None, ge=0)
    day_trades_short: Optional[int] = Field(default=None, ge=0)
    day_profit_total: Optional[float] = None
    day_volume_lot: Optional[float] = Field(default=None, ge=0)
    day_profit_trades: Optional[int] = Field(default=None, ge=0)
    day_loss_trades: Optional[int] = Field(default=None, ge=0)
    day_profit_trade_rate: Optional[float] = Field(default=None, ge=0, le=100)
    day_loss_trade_rate: Optional[float] = Field(default=None, ge=0, le=100)
    day_trading_activity: Optional[float] = Field(default=None, ge=0, le=100)
    day_max_deposit_load: Optional[float] = Field(default=None, ge=0)
    day_maximum_drawdown: Optional[float] = Field(default=None, ge=0)
    day_maximum_drawdown_pct: Optional[float] = Field(default=None, ge=0)
    week_trades: Optional[int] = Field(default=None, ge=0)
    week_trades_long: Optional[int] = Field(default=None, ge=0)
    week_trades_short: Optional[int] = Field(default=None, ge=0)
    week_profit_total: Optional[float] = None
    week_volume_lot: Optional[float] = Field(default=None, ge=0)
    week_profit_trades: Optional[int] = Field(default=None, ge=0)
    week_loss_trades: Optional[int] = Field(default=None, ge=0)
    week_profit_trade_rate: Optional[float] = Field(default=None, ge=0, le=100)
    week_loss_trade_rate: Optional[float] = Field(default=None, ge=0, le=100)
    week_trading_activity: Optional[float] = Field(default=None, ge=0, le=100)
    week_max_deposit_load: Optional[float] = Field(default=None, ge=0)
    week_maximum_drawdown: Optional[float] = Field(default=None, ge=0)
    week_maximum_drawdown_pct: Optional[float] = Field(default=None, ge=0)
    month_trades: Optional[int] = Field(default=None, ge=0)
    month_trades_long: Optional[int] = Field(default=None, ge=0)
    month_trades_short: Optional[int] = Field(default=None, ge=0)
    month_profit_total: Optional[float] = None
    month_volume_lot: Optional[float] = Field(default=None, ge=0)
    month_profit_trades: Optional[int] = Field(default=None, ge=0)
    month_loss_trades: Optional[int] = Field(default=None, ge=0)
    month_profit_trade_rate: Optional[float] = Field(default=None, ge=0, le=100)
    month_loss_trade_rate: Optional[float] = Field(default=None, ge=0, le=100)
    month_trading_activity: Optional[float] = Field(default=None, ge=0, le=100)
    month_max_deposit_load: Optional[float] = Field(default=None, ge=0)
    month_maximum_drawdown: Optional[float] = Field(default=None, ge=0)
    month_maximum_drawdown_pct: Optional[float] = Field(default=None, ge=0)
    connected: Optional[bool] = None
    balance: Optional[float] = None
    equity: Optional[float] = None
    margin: Optional[float] = None
    free_margin: Optional[float] = None
    margin_level: Optional[float] = None
    deposit_load: Optional[float] = Field(default=None, ge=0)
    positions_total: Optional[int] = Field(default=None, ge=0)
    orders_total: Optional[int] = Field(default=None, ge=0)
    floating_pl: Optional[float] = None
    last_error: Optional[int] = None


class HeartbeatAck(BaseModel):
    ok: bool
    received_at: int
    terminal_id: str


class StoredHeartbeat(BaseModel):
    received_at: int
    payload: HeartbeatPayload


class CurvePoint(BaseModel):
    received_at: int
    ts: int
    balance: Optional[float] = None
    equity: Optional[float] = None
    margin: Optional[float] = None
    deposit_load: Optional[float] = None


class GrowthPoint(BaseModel):
    received_at: int
    ts: int
    value: Optional[float] = None
    growth_pct: Optional[float] = None
    trades: Optional[int] = None
    trades_long: Optional[int] = None
    trades_short: Optional[int] = None


class GrowthSeriesResponse(BaseModel):
    terminal_id: str
    period: Literal["day", "week", "month", "all"]
    value_source: Literal["equity", "balance"]
    trade_window: Literal["day", "week", "month"]
    from_ts: int
    to_ts: int
    baseline_value: Optional[float] = None
    latest_value: Optional[float] = None
    latest_growth_pct: Optional[float] = None
    points: List[GrowthPoint]


class PeriodSummary(BaseModel):
    period: Literal["day", "week", "month"]
    from_ts: int
    to_ts: int
    window_sec: int
    samples: int
    trades: Optional[int] = None
    trades_long: Optional[int] = None
    trades_short: Optional[int] = None
    profit_total: Optional[float] = None
    volume_lot: Optional[float] = None
    profit_trades: Optional[int] = None
    loss_trades: Optional[int] = None
    profit_trade_rate: Optional[float] = None
    loss_trade_rate: Optional[float] = None
    trading_activity: Optional[float] = None
    algo_trading_pct: Optional[float] = None
    max_deposit_load: Optional[float] = None
    maximum_drawdown: Optional[float] = None
    maximum_drawdown_pct: Optional[float] = None


class HeartbeatDashboard(BaseModel):
    terminal_id: str
    received_at: int
    payload: HeartbeatPayload
    day: PeriodSummary
    week: PeriodSummary
    month: PeriodSummary


class TerminalOverview(BaseModel):
    terminal_id: str
    received_at: int
    login: int
    server: str
    terminal_active: bool
    algo_active: bool
    connected: Optional[bool] = None
    balance: Optional[float] = None
    equity: Optional[float] = None
    margin: Optional[float] = None
    deposit_load: Optional[float] = None
    day_trades: Optional[int] = None
    week_trades: Optional[int] = None
    month_trades: Optional[int] = None
    day_profit_total: Optional[float] = None
    week_profit_total: Optional[float] = None
    month_profit_total: Optional[float] = None


class HealthResponse(BaseModel):
    ok: bool
    uptime_sec: int
    tracked_terminals: int
    total_history_points: int
    max_ts_drift_sec: int
    history_retention_sec: int
    history_max_points_per_terminal: int


class SystemRealtimeResponse(BaseModel):
    collected_at: int
    host: str
    os: str
    is_windows: bool
    cpu_percent: float
    cpu_logical_cores: int
    cpu_physical_cores: int
    memory_percent: float
    memory_total_mb: float
    memory_used_mb: float
    memory_available_mb: float
    swap_percent: float
    swap_total_mb: float
    swap_used_mb: float
    backend_pid: int
    backend_process_cpu_percent: Optional[float] = None
    backend_process_memory_percent: Optional[float] = None
    backend_process_memory_rss_mb: Optional[float] = None
    backend_open_files: Optional[int] = None
    backend_thread_count: Optional[int] = None
    refresh_interval_sec: float


def _is_authorized(x_api_key: Optional[str]) -> bool:
    if not x_api_key:
        return False
    candidate = x_api_key.strip()
    if not candidate:
        return False
    for key in CONFIG.api_keys:
        if hmac.compare_digest(candidate, key):
            return True
    return False


def _is_read_authorized(x_api_key: Optional[str]) -> bool:
    if not x_api_key:
        return False
    candidate = x_api_key.strip()
    if not candidate:
        return False
    for key in CONFIG.read_api_keys:
        if hmac.compare_digest(candidate, key):
            return True
    return False


def _require_read_api_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    if not _is_read_authorized(x_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


def _validate_timestamp(ts: int, now: int) -> None:
    if abs(now - ts) > CONFIG.max_ts_drift_sec:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Timestamp drift exceeds MT5_MAX_TS_DRIFT_SEC "
                f"({CONFIG.max_ts_drift_sec}s)"
            ),
        )


def _history_window(period: str) -> int:
    return _PERIOD_WINDOWS[period]


def _value_from_payload(payload: HeartbeatPayload, source: Literal["equity", "balance"]) -> Optional[float]:
    if source == "equity":
        return payload.equity
    return payload.balance


def _period_field(payload: HeartbeatPayload, period: str, name: str) -> Optional[float]:
    value = getattr(payload, f"{period}_{name}", None)
    if value is not None:
        return value

    if period == "week":
        if name == "trades":
            return payload.trades_last_7d
        if name == "volume_lot":
            return payload.volume_last_7d
        if name == "profit_total":
            return payload.profit_last_7d

    if period == "day":
        if name == "trades" and payload.trades_last_3d is not None:
            return payload.trades_last_3d / 3.0
        if name == "volume_lot" and payload.volume_last_3d is not None:
            return payload.volume_last_3d / 3.0
        if name == "profit_total" and payload.profit_last_3d is not None:
            return payload.profit_last_3d / 3.0

    return None


def _deposit_load_from_payload(payload: HeartbeatPayload) -> Optional[float]:
    if payload.deposit_load is not None:
        return payload.deposit_load

    margin = payload.margin
    balance = payload.balance
    equity = payload.equity

    if margin is None:
        return None

    base = balance if balance and balance > 0 else equity
    if base is None or base <= 0:
        return None

    return (margin / base) * 100.0


def _curve_metrics(records: List[StoredHeartbeatRecord]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    max_deposit_load: Optional[float] = None
    peak_equity: Optional[float] = None
    max_drawdown: Optional[float] = None
    max_drawdown_pct: Optional[float] = None

    for record in records:
        payload = record.payload

        load = _deposit_load_from_payload(payload)
        if load is not None:
            max_deposit_load = load if max_deposit_load is None else max(max_deposit_load, load)

        equity = payload.equity
        if equity is None:
            continue

        if peak_equity is None or equity > peak_equity:
            peak_equity = equity
            continue

        if peak_equity <= 0:
            continue

        drawdown = peak_equity - equity
        drawdown_pct = (drawdown / peak_equity) * 100.0

        max_drawdown = drawdown if max_drawdown is None else max(max_drawdown, drawdown)
        max_drawdown_pct = drawdown_pct if max_drawdown_pct is None else max(max_drawdown_pct, drawdown_pct)

    return max_deposit_load, max_drawdown, max_drawdown_pct


def _coerce_trade_count(value: Optional[float]) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, float) and value > 0 and not value.is_integer():
        return int(math.ceil(value))
    return int(value)


def _estimate_activity_from_records(records: List[StoredHeartbeatRecord], period_days: int) -> Optional[float]:
    if not records:
        return None

    active_days = {
        int((record.payload.ts if record.payload.ts else record.received_at) / (24 * 60 * 60))
        for record in records
    }
    return (100.0 * len(active_days)) / float(period_days)


def _estimate_algo_trading_pct(records: List[StoredHeartbeatRecord]) -> Optional[float]:
    if not records:
        return None

    enabled = sum(1 for record in records if record.payload.algo_active)
    return round((100.0 * enabled) / float(len(records)), 2)


def _summary_from_payload_and_records(
    payload: HeartbeatPayload,
    records: List[StoredHeartbeatRecord],
    period: Literal["day", "week", "month"],
    from_ts: int,
    to_ts: int,
) -> PeriodSummary:
    trades = _period_field(payload, period, "trades")
    trades_long = _period_field(payload, period, "trades_long")
    trades_short = _period_field(payload, period, "trades_short")
    profit_total = _period_field(payload, period, "profit_total")
    volume_lot = _period_field(payload, period, "volume_lot")
    profit_trades = _period_field(payload, period, "profit_trades")
    loss_trades = _period_field(payload, period, "loss_trades")
    profit_trade_rate = _period_field(payload, period, "profit_trade_rate")
    loss_trade_rate = _period_field(payload, period, "loss_trade_rate")
    trading_activity = _period_field(payload, period, "trading_activity")

    trades = _coerce_trade_count(trades)
    if trades_long is not None:
        trades_long = int(trades_long)
    if trades_short is not None:
        trades_short = int(trades_short)
    if profit_trades is not None:
        profit_trades = int(profit_trades)
    if loss_trades is not None:
        loss_trades = int(loss_trades)

    if profit_trade_rate is None and trades and profit_trades is not None and trades > 0:
        profit_trade_rate = (100.0 * profit_trades) / float(trades)
    if loss_trade_rate is None and trades and loss_trades is not None and trades > 0:
        loss_trade_rate = (100.0 * loss_trades) / float(trades)

    if trading_activity is None:
        trading_activity = _estimate_activity_from_records(records, _PERIOD_DAYS[period])

    algo_trading_pct = _estimate_algo_trading_pct(records)
    max_deposit_load, max_drawdown, max_drawdown_pct = _curve_metrics(records)

    if max_deposit_load is None:
        max_deposit_load = _period_field(payload, period, "max_deposit_load")
    if max_drawdown is None:
        max_drawdown = _period_field(payload, period, "maximum_drawdown")
    if max_drawdown_pct is None:
        max_drawdown_pct = _period_field(payload, period, "maximum_drawdown_pct")

    return PeriodSummary(
        period=period,
        from_ts=from_ts,
        to_ts=to_ts,
        window_sec=_history_window(period),
        samples=len(records),
        trades=trades,
        trades_long=trades_long,
        trades_short=trades_short,
        profit_total=profit_total,
        volume_lot=volume_lot,
        profit_trades=profit_trades,
        loss_trades=loss_trades,
        profit_trade_rate=profit_trade_rate,
        loss_trade_rate=loss_trade_rate,
        trading_activity=trading_activity,
        algo_trading_pct=algo_trading_pct,
        max_deposit_load=max_deposit_load,
        maximum_drawdown=max_drawdown,
        maximum_drawdown_pct=max_drawdown_pct,
    )


def _not_found_terminal(terminal_id: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"No heartbeat found for terminal_id={terminal_id}",
    )


def _get_latest_record(terminal_id: str) -> StoredHeartbeatRecord:
    with _store_lock:
        latest = _latest_heartbeats.get(terminal_id)

    if latest is None:
        raise _not_found_terminal(terminal_id)

    return latest


def _get_terminal_state(terminal_id: str) -> Tuple[StoredHeartbeatRecord, List[StoredHeartbeatRecord]]:
    with _store_lock:
        latest = _latest_heartbeats.get(terminal_id)
        history = _heartbeat_history.get(terminal_id, []).copy()

    if latest is None:
        raise _not_found_terminal(terminal_id)

    return latest, history


def _first_record_index(records: List[StoredHeartbeatRecord], cutoff: int) -> int:
    left = 0
    right = len(records)

    while left < right:
        mid = (left + right) // 2
        if records[mid].received_at < cutoff:
            left = mid + 1
        else:
            right = mid

    return left


def _period_records(records: List[StoredHeartbeatRecord], period: Literal["day", "week", "month"], now_ts: int) -> List[StoredHeartbeatRecord]:
    cutoff = now_ts - _history_window(period)
    return records[_first_record_index(records, cutoff):]


def _build_period_summary(terminal_id: str, period: Literal["day", "week", "month"]) -> PeriodSummary:
    latest, history = _get_terminal_state(terminal_id)
    now_ts = int(time.time())
    from_ts = now_ts - _history_window(period)
    records = _period_records(history, period, now_ts)
    return _summary_from_payload_and_records(latest.payload, records, period, from_ts, now_ts)


def _build_growth_series(
    terminal_id: str,
    period: Literal["day", "week", "month", "all"],
    value_source: Literal["equity", "balance"],
    trade_window: Literal["day", "week", "month"],
    limit: int,
) -> GrowthSeriesResponse:
    latest, history = _get_terminal_state(terminal_id)
    now_ts = int(time.time())

    if period != "all":
        from_ts = now_ts - _history_window(period)
        history = _period_records(history, period, now_ts)
    else:
        from_ts = history[0].received_at if history else now_ts

    if len(history) > limit:
        history = history[-limit:]
        if history:
            from_ts = history[0].received_at

    baseline_value: Optional[float] = None
    for record in history:
        probe = _value_from_payload(record.payload, value_source)
        if probe is not None and probe > 0:
            baseline_value = probe
            break

    points: List[GrowthPoint] = []
    for record in history:
        payload = record.payload
        value = _value_from_payload(payload, value_source)
        growth_pct = None
        if baseline_value is not None and baseline_value > 0 and value is not None:
            growth_pct = ((value - baseline_value) / baseline_value) * 100.0

        trades = _period_field(payload, trade_window, "trades")
        trades_long = _period_field(payload, trade_window, "trades_long")
        trades_short = _period_field(payload, trade_window, "trades_short")

        points.append(
            GrowthPoint(
                received_at=record.received_at,
                ts=payload.ts,
                value=value,
                growth_pct=None if growth_pct is None else round(growth_pct, 4),
                trades=_coerce_trade_count(trades),
                trades_long=None if trades_long is None else int(trades_long),
                trades_short=None if trades_short is None else int(trades_short),
            )
        )

    latest_value = _value_from_payload(latest.payload, value_source)
    latest_growth = None
    if baseline_value is not None and baseline_value > 0 and latest_value is not None:
        latest_growth = ((latest_value - baseline_value) / baseline_value) * 100.0

    return GrowthSeriesResponse(
        terminal_id=terminal_id,
        period=period,
        value_source=value_source,
        trade_window=trade_window,
        from_ts=from_ts,
        to_ts=now_ts,
        baseline_value=baseline_value,
        latest_value=latest_value,
        latest_growth_pct=None if latest_growth is None else round(latest_growth, 4),
        points=points,
    )


def _store_heartbeat(record: StoredHeartbeatRecord) -> None:
    terminal_id = record.payload.terminal_id
    received_at = record.received_at

    global _history_points_total
    with _store_lock:
        if terminal_id not in _latest_heartbeats:
            bisect.insort(_sorted_terminal_ids, terminal_id)

        _latest_heartbeats[terminal_id] = record

        history = _heartbeat_history.setdefault(terminal_id, [])
        history.append(record)
        _history_points_total += 1

        cutoff = received_at - CONFIG.history_retention_sec
        trimmed = _first_record_index(history, cutoff)
        if trimmed > 0:
            del history[:trimmed]
            _history_points_total -= trimmed

        overflow = len(history) - CONFIG.history_max_points_per_terminal
        if overflow > 0:
            del history[:overflow]
            _history_points_total -= overflow


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    with _store_lock:
        tracked = len(_latest_heartbeats)
        points = _history_points_total

    return HealthResponse.model_construct(
        ok=True,
        uptime_sec=max(0, int(time.monotonic() - STARTED_MONOTONIC)),
        tracked_terminals=tracked,
        total_history_points=points,
        max_ts_drift_sec=CONFIG.max_ts_drift_sec,
        history_retention_sec=CONFIG.history_retention_sec,
        history_max_points_per_terminal=CONFIG.history_max_points_per_terminal,
    )


@app.get(
    "/monitor/system/realtime",
    response_model=SystemRealtimeResponse,
    dependencies=[Depends(_require_read_api_key)],
)
def monitor_system_realtime(force: bool = Query(default=False)) -> SystemRealtimeResponse:
    try:
        data = _system_monitor.snapshot(force=force)
    except MonitorUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return SystemRealtimeResponse.model_validate(data)


@app.get(
    "/mt5/heartbeat/latest/{terminal_id}",
    response_model=StoredHeartbeat,
    dependencies=[Depends(_require_read_api_key)],
)
def get_latest_heartbeat(terminal_id: str) -> StoredHeartbeat:
    latest = _get_latest_record(terminal_id)
    return StoredHeartbeat.model_construct(received_at=latest.received_at, payload=latest.payload)


@app.get(
    "/mt5/heartbeat/terminals",
    response_model=List[str],
    dependencies=[Depends(_require_read_api_key)],
)
def list_terminals() -> List[str]:
    with _store_lock:
        terminal_ids = _sorted_terminal_ids.copy()
    return terminal_ids


@app.get(
    "/mt5/heartbeat/overview",
    response_model=List[TerminalOverview],
    dependencies=[Depends(_require_read_api_key)],
)
def get_overview() -> List[TerminalOverview]:
    with _store_lock:
        terminal_ids = _sorted_terminal_ids.copy()
        latest_items = [(terminal_id, _latest_heartbeats.get(terminal_id)) for terminal_id in terminal_ids]

    overview: List[TerminalOverview] = []
    for terminal_id, latest in latest_items:
        if latest is None:
            continue
        payload = latest.payload
        overview.append(
            TerminalOverview(
                terminal_id=terminal_id,
                received_at=latest.received_at,
                login=payload.login,
                server=payload.server,
                terminal_active=payload.terminal_active,
                algo_active=payload.algo_active,
                connected=payload.connected,
                balance=payload.balance,
                equity=payload.equity,
                margin=payload.margin,
                deposit_load=_deposit_load_from_payload(payload),
                day_trades=payload.day_trades,
                week_trades=payload.week_trades,
                month_trades=payload.month_trades,
                day_profit_total=payload.day_profit_total,
                week_profit_total=payload.week_profit_total,
                month_profit_total=payload.month_profit_total,
            )
        )
    return overview


@app.get(
    "/mt5/heartbeat/summary/{terminal_id}/{period}",
    response_model=PeriodSummary,
    dependencies=[Depends(_require_read_api_key)],
)
def get_period_summary(terminal_id: str, period: Literal["day", "week", "month"]) -> PeriodSummary:
    return _build_period_summary(terminal_id, period)


@app.get(
    "/mt5/heartbeat/dashboard/{terminal_id}",
    response_model=HeartbeatDashboard,
    dependencies=[Depends(_require_read_api_key)],
)
def get_dashboard(terminal_id: str) -> HeartbeatDashboard:
    latest, history = _get_terminal_state(terminal_id)
    now_ts = int(time.time())

    day = _summary_from_payload_and_records(
        latest.payload,
        _period_records(history, "day", now_ts),
        "day",
        now_ts - _history_window("day"),
        now_ts,
    )
    week = _summary_from_payload_and_records(
        latest.payload,
        _period_records(history, "week", now_ts),
        "week",
        now_ts - _history_window("week"),
        now_ts,
    )
    month = _summary_from_payload_and_records(
        latest.payload,
        _period_records(history, "month", now_ts),
        "month",
        now_ts - _history_window("month"),
        now_ts,
    )

    return HeartbeatDashboard.model_construct(
        terminal_id=terminal_id,
        received_at=latest.received_at,
        payload=latest.payload,
        day=day,
        week=week,
        month=month,
    )


@app.get(
    "/mt5/heartbeat/history/{terminal_id}",
    response_model=List[StoredHeartbeat],
    dependencies=[Depends(_require_read_api_key)],
)
def get_history(
    terminal_id: str,
    period: Literal["day", "week", "month", "all"] = Query(default="week"),
    limit: int = Query(default=200, ge=1, le=5000),
) -> List[StoredHeartbeat]:
    latest, history = _get_terminal_state(terminal_id)
    _ = latest

    now_ts = int(time.time())
    if period != "all":
        history = _period_records(history, period, now_ts)

    if len(history) > limit:
        history = history[-limit:]

    return [
        StoredHeartbeat.model_construct(received_at=record.received_at, payload=record.payload)
        for record in history
    ]


@app.get(
    "/mt5/heartbeat/curve/{terminal_id}",
    response_model=List[CurvePoint],
    dependencies=[Depends(_require_read_api_key)],
)
def get_curve(
    terminal_id: str,
    period: Literal["day", "week", "month", "all"] = Query(default="month"),
    limit: int = Query(default=500, ge=1, le=5000),
) -> List[CurvePoint]:
    latest, history = _get_terminal_state(terminal_id)
    _ = latest

    now_ts = int(time.time())
    if period != "all":
        history = _period_records(history, period, now_ts)

    if len(history) > limit:
        history = history[-limit:]

    points: List[CurvePoint] = []
    for record in history:
        payload = record.payload
        points.append(
            CurvePoint(
                received_at=record.received_at,
                ts=payload.ts,
                balance=payload.balance,
                equity=payload.equity,
                margin=payload.margin,
                deposit_load=_deposit_load_from_payload(payload),
            )
        )
    return points


@app.get(
    "/mt5/heartbeat/growth/{terminal_id}",
    response_model=GrowthSeriesResponse,
    dependencies=[Depends(_require_read_api_key)],
)
def get_growth(
    terminal_id: str,
    period: Literal["day", "week", "month", "all"] = Query(default="all"),
    value_source: Literal["equity", "balance"] = Query(default="balance"),
    trade_window: Literal["day", "week", "month"] = Query(default="day"),
    limit: int = Query(default=500, ge=1, le=5000),
) -> GrowthSeriesResponse:
    return _build_growth_series(terminal_id, period, value_source, trade_window, limit)



@app.get(
    "/mt5/public-url",
    response_model=dict,
    dependencies=[Depends(_require_read_api_key)],
)
def get_public_url() -> dict:
    """Returns the current public base URL if ngrok is enabled."""
    return {"public_url": NGROK_PUBLIC_URL}


@app.post("/mt5/heartbeat", response_model=HeartbeatAck)
def mt5_heartbeat(
    payload: HeartbeatPayload,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> HeartbeatAck:
    if not _is_authorized(x_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    received_at = int(time.time())
    _validate_timestamp(payload.ts, received_at)
    stored = StoredHeartbeatRecord(received_at=received_at, payload=payload)
    _store_heartbeat(stored)

    if CONFIG.log_heartbeats:
        logger.info(
            "Heartbeat terminal_id=%s login=%s server=%s algo_active=%s latency_ms=%s",
            payload.terminal_id,
            payload.login,
            payload.server,
            payload.algo_active,
            payload.latency_ms,
        )

    return HeartbeatAck.model_construct(
        ok=True,
        received_at=received_at,
        terminal_id=payload.terminal_id,
    )


def _run() -> None:
    import uvicorn

    host = os.getenv("APP_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = _parse_port_env("APP_PORT", 8000)
    global NGROK_PUBLIC_URL
    NGROK_PUBLIC_URL = _maybe_start_ngrok(port)
    if NGROK_PUBLIC_URL:
        logger.info("ngrok public URL: %s", NGROK_PUBLIC_URL)

    log_level = os.getenv("APP_LOG_LEVEL", "info").strip().lower() or "info"
    reload_enabled = _parse_bool_env("APP_RELOAD", False)

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        log_level=log_level,
        reload=reload_enabled,
    )


if __name__ == "__main__":
    _run()
