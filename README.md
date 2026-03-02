# Quantum

FastAPI service that receives MT5 heartbeats and stores the latest payload per `terminal_id` in memory.

API reference: `API_ENDPOINTS.md`

## What it does

- Receives signed heartbeat payloads from MT5 EAs (`Pusher.mq5`, `EA.mq5`).
- Validates API key and timestamp drift.
- Stores latest heartbeat only (in-memory).
- Exposes health and query endpoints.

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
| `APP_HOST` | `0.0.0.0` | Host used when running `python app.py`. |
| `APP_PORT` | `8000` | Port used when running `python app.py`. |
| `APP_LOG_LEVEL` | `info` | Uvicorn log level. |
| `APP_RELOAD` | `0` | Enable auto reload (`1/true/yes/on`). |

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
    "day_trades": 2,
    "week_trades": 9,
    "month_trades": 31,
    "day_profit_total": 80.25,
    "week_profit_total": 220.10,
    "month_profit_total": 640.90
  }'
```

List terminals:

```bash
curl -s http://127.0.0.1:8000/mt5/heartbeat/terminals
```

Get latest heartbeat:

```bash
curl -s http://127.0.0.1:8000/mt5/heartbeat/latest/MT5-A1
```

## MT5 notes

- Whitelist API URL in MT5: `Tools > Options > Expert Advisors > Allow WebRequest`.
- `Pusher.mq5` sends day/week/month trading metrics plus account/exposure fields.
- `ts` must be Unix seconds in UTC (`TimeGMT()` in MQL5).
