# Quantum

FastAPI service that receives MT5 heartbeats, keeps in-memory history per terminal, and serves frontend-ready summaries.

API reference: `API_ENDPOINTS.md`

## What it does

- Receives signed heartbeat payloads from `Pusher.mq5`.
- Validates API key and timestamp drift.
- Stores latest heartbeat + history per `terminal_id` in memory.
- Exposes frontend endpoints for `day/week/month` summaries and chart curves.
- Computes risk metrics (`max_deposit_load`, `maximum_drawdown`) from heartbeat history on the backend.
- Exposes realtime backend host metrics (CPU/RAM) for frontend monitoring.

## Requirements

- Python 3.11+
- `pip`

## Local run

```bash
cd /path/to/Quantum
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

Set environment variables (example):

```bash
export MT5_API_KEY="replace-with-strong-secret"
export MT5_MAX_TS_DRIFT_SEC=300
export MT5_LOG_HEARTBEAT=1
export MT5_HISTORY_RETENTION_SEC=$((45*24*60*60))
export MT5_HISTORY_MAX_POINTS_PER_TERMINAL=10000
export SYSTEM_MONITOR_MIN_REFRESH_SEC=1.0
```

Run API:

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --log-level info
```

## Environment variables

| Variable | Default | Description |
|---|---:|---|
| `MT5_API_KEY` | `therng` | Primary API key for `POST /mt5/heartbeat`. |
| `MT5_API_KEYS` | empty | Optional comma-separated additional API keys. |
| `MT5_MAX_TS_DRIFT_SEC` | `300` | Max allowed timestamp drift in seconds. |
| `MT5_LOG_HEARTBEAT` | `1` | Log each accepted heartbeat (`1/true/yes/on` = enabled). |
| `MT5_HISTORY_RETENTION_SEC` | `3888000` | History retention window in memory (seconds). |
| `MT5_HISTORY_MAX_POINTS_PER_TERMINAL` | `10000` | Max stored heartbeat points per terminal. |
| `SYSTEM_MONITOR_MIN_REFRESH_SEC` | `1.0` | Min refresh interval for realtime CPU/RAM monitor endpoint. |
| `APP_HOST` | `0.0.0.0` | Host used when running `python app.py`. |
| `APP_PORT` | `8000` | Port used when running `python app.py`. |
| `APP_LOG_LEVEL` | `info` | Uvicorn log level. |
| `APP_RELOAD` | `0` | Enable auto reload (`1/true/yes/on`). |

## MT5 EA design (light + accurate)

- `Pusher.mq5` computes trade stats in a **single 30-day history scan** and aggregates to day/week/month.
- EA sends:
- required identity/status/timestamp
- account snapshot (`balance/equity/margin/...`)
- period trade metrics (`day_*`, `week_*`, `month_*`)
- current `deposit_load`
- Backend computes period `max_deposit_load` and `maximum_drawdown` from heartbeat curve.

## Frontend-oriented endpoints

- `GET /mt5/heartbeat/overview`
- latest card data for all terminals (good for list page)
- `GET /mt5/heartbeat/dashboard/{terminal_id}`
- one call returns latest payload + day/week/month summaries
- `GET /mt5/heartbeat/summary/{terminal_id}/{period}`
- period-specific normalized summary (`period=day|week|month`)
- `GET /mt5/heartbeat/curve/{terminal_id}?period=week&limit=300`
- compact curve data for charts
- `GET /mt5/heartbeat/growth/{terminal_id}?period=week&value_source=equity&trade_window=day&limit=300`
- graph-ready points for `growth_pct` and `trades`
- `GET /mt5/heartbeat/history/{terminal_id}?period=day&limit=200`
- raw stored heartbeat records for debugging
- `GET /monitor/system/realtime`
- realtime backend host monitor (CPU %, memory %, process resource use)

## API quick check

Health:

```bash
curl -s http://127.0.0.1:8000/health
```

Send heartbeat:

```bash
curl -s -X POST http://127.0.0.1:8000/mt5/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: replace-with-strong-secret" \
  -d '{
    "login": 12345678,
    "server": "Broker-Demo",
    "terminal_id": "MT5-A1",
    "terminal_active": true,
    "algo_active": true,
    "ts": '"$(date +%s)"',
    "balance": 10000.0,
    "equity": 9975.2,
    "margin": 1100.0,
    "deposit_load": 11.0,
    "day_trades": 3,
    "week_trades": 12,
    "month_trades": 44
  }'
```

Dashboard and curve:

```bash
curl -s http://127.0.0.1:8000/monitor/system/realtime
curl -s 'http://127.0.0.1:8000/monitor/system/realtime?force=true'
curl -s http://127.0.0.1:8000/mt5/heartbeat/overview
curl -s http://127.0.0.1:8000/mt5/heartbeat/dashboard/MT5-A1
curl -s http://127.0.0.1:8000/mt5/heartbeat/summary/MT5-A1/week
curl -s 'http://127.0.0.1:8000/mt5/heartbeat/curve/MT5-A1?period=week&limit=300'
curl -s 'http://127.0.0.1:8000/mt5/heartbeat/growth/MT5-A1?period=week&value_source=equity&trade_window=day&limit=300'
```

## MT5 notes

- Whitelist API URL in MT5: `Tools > Options > Expert Advisors > Allow WebRequest`.
- `ts` must be Unix seconds in UTC (`TimeGMT()` in MQL5).
