# API Endpoints

Base URL:

- `http://<host>:<port>`
- Local default is `http://127.0.0.1:8000`

Content type:

- Requests: `application/json`
- Responses: `application/json`

## Authentication

- `POST /mt5/heartbeat` requires header `X-API-Key`.
- Valid keys come from `MT5_API_KEY` and optional `MT5_API_KEYS` (comma-separated).
- `GET` endpoints do not require API key.

## Timestamp Validation

- Heartbeat payload field `ts` is validated against server time.
- Allowed drift is controlled by `MT5_MAX_TS_DRIFT_SEC` (default `300`).
- If drift is too large, API returns `422`.

## History Model

- Server stores latest heartbeat per `terminal_id` and keeps heartbeat history in memory.
- History retention is controlled by `MT5_HISTORY_RETENTION_SEC` (default `3888000`, 45 days).
- Max points per terminal is controlled by `MT5_HISTORY_MAX_POINTS_PER_TERMINAL` (default `10000`).
- System monitor refresh interval is controlled by `SYSTEM_MONITOR_MIN_REFRESH_SEC` (default `1.0`).

## Endpoints

### GET `/health`

Returns service health and storage metadata.

Success `200`:

```json
{
  "ok": true,
  "uptime_sec": 1234,
  "tracked_terminals": 2,
  "total_history_points": 840,
  "max_ts_drift_sec": 300,
  "history_retention_sec": 3888000,
  "history_max_points_per_terminal": 10000
}
```

### GET `/monitor/system/realtime`

Returns realtime host metrics for backend monitoring (Windows Server 2022 supported).

Query:

- `force` (boolean, default `false`): bypass refresh cache and collect metrics immediately.

Success `200` example:

```json
{
  "collected_at": 1700000000,
  "host": "WIN-SERVER-01",
  "os": "Windows-Server-2022-10.0.20348-SP0",
  "is_windows": true,
  "cpu_percent": 24.8,
  "cpu_logical_cores": 8,
  "cpu_physical_cores": 4,
  "memory_percent": 68.2,
  "memory_total_mb": 32768.0,
  "memory_used_mb": 22354.7,
  "memory_available_mb": 10413.3,
  "swap_percent": 12.4,
  "swap_total_mb": 8192.0,
  "swap_used_mb": 1015.2,
  "backend_pid": 1234,
  "backend_process_cpu_percent": 3.2,
  "backend_process_memory_percent": 0.8,
  "backend_process_memory_rss_mb": 256.4,
  "backend_open_files": 16,
  "backend_thread_count": 18,
  "refresh_interval_sec": 1.0
}
```

### POST `/mt5/heartbeat`

Accepts one heartbeat payload and stores it.

Headers:

- `Content-Type: application/json`
- `X-API-Key: <your-api-key>`

Required JSON fields:

- `login` (integer)
- `server` (string, 1..128)
- `terminal_id` (string, 1..128)
- `terminal_active` (boolean)
- `algo_active` (boolean)
- `ts` (integer unix timestamp, UTC)

Optional JSON fields:

- Identity / status
- `account_name` (string, max 256)
- `latency_ms` (integer, >= 0)
- `connected` (boolean)
- `last_error` (integer)
- Account / exposure snapshot
- `balance` (number)
- `equity` (number)
- `margin` (number)
- `free_margin` (number)
- `margin_level` (number)
- `deposit_load` (number, >= 0)
- `positions_total` (integer, >= 0)
- `orders_total` (integer, >= 0)
- `floating_pl` (number)
- Period trading metrics (from EA)
- `day_trades`, `week_trades`, `month_trades` (integer, >= 0)
- `day_trades_long`, `week_trades_long`, `month_trades_long` (integer, >= 0)
- `day_trades_short`, `week_trades_short`, `month_trades_short` (integer, >= 0)
- `day_profit_total`, `week_profit_total`, `month_profit_total` (number)
- `day_volume_lot`, `week_volume_lot`, `month_volume_lot` (number, >= 0)
- `day_profit_trades`, `week_profit_trades`, `month_profit_trades` (integer, >= 0)
- `day_loss_trades`, `week_loss_trades`, `month_loss_trades` (integer, >= 0)
- `day_profit_trade_rate`, `week_profit_trade_rate`, `month_profit_trade_rate` (number, 0..100)
- `day_loss_trade_rate`, `week_loss_trade_rate`, `month_loss_trade_rate` (number, 0..100)
- `day_trading_activity`, `week_trading_activity`, `month_trading_activity` (number, 0..100)
- Legacy optional stats (still accepted)
- `trades_last_3d`, `volume_last_3d`, `profit_last_3d`
- `trades_last_7d`, `volume_last_7d`, `profit_last_7d`

Notes:

- Unknown extra fields are ignored.
- Data is in-memory only (not persisted across restart).

Success `200`:

```json
{
  "ok": true,
  "received_at": 1700000000,
  "terminal_id": "MT5-A1"
}
```

### GET `/mt5/heartbeat/terminals`

Returns tracked terminal IDs in ascending order.

### GET `/mt5/heartbeat/latest/{terminal_id}`

Returns latest heartbeat payload for one terminal.

### GET `/mt5/heartbeat/overview`

Returns latest lightweight card data for all terminals (useful for list/grid screens).

Each item includes:

- terminal identity/status
- account snapshot (`balance/equity/margin/deposit_load`)
- day/week/month headline stats (`*_trades`, `*_profit_total`)

### GET `/mt5/heartbeat/summary/{terminal_id}/{period}`

Returns normalized summary for `period = day|week|month`.

Summary includes:

- period stats from latest payload (trades/long/short/profit/volume/win-loss)
- `algo_trading_pct` sample-weighted percent of stored heartbeats with `algo_active=true` in that period (null if `samples=0`)
- `max_deposit_load` calculated from stored heartbeat series in that period
- `maximum_drawdown` and `maximum_drawdown_pct` calculated from equity curve in that period

Success `200` example:

```json
{
  "period": "week",
  "from_ts": 1700000000,
  "to_ts": 1700604800,
  "window_sec": 604800,
  "samples": 520,
  "trades": 28,
  "trades_long": 16,
  "trades_short": 12,
  "profit_total": 532.8,
  "volume_lot": 8.5,
  "profit_trades": 18,
  "loss_trades": 10,
  "profit_trade_rate": 64.29,
  "loss_trade_rate": 35.71,
  "trading_activity": 85.71,
  "algo_trading_pct": 92.31,
  "max_deposit_load": 42.3,
  "maximum_drawdown": 310.4,
  "maximum_drawdown_pct": 2.98
}
```

### GET `/mt5/heartbeat/dashboard/{terminal_id}`

Returns one payload for frontend dashboard:

- latest heartbeat payload
- `day`, `week`, `month` summaries in one call

### GET `/mt5/heartbeat/history/{terminal_id}`

Returns heartbeat history points.

Query:

- `period`: `day|week|month|all` (default `day`)
- `limit`: `1..5000` (default `200`)

### GET `/mt5/heartbeat/curve/{terminal_id}`

Returns compact timeseries for charting.

Each point contains:

- `received_at`, `ts`, `balance`, `equity`, `margin`, `deposit_load`

Query:

- `period`: `day|week|month|all` (default `week`)
- `limit`: `1..5000` (default `500`)

### GET `/mt5/heartbeat/growth/{terminal_id}`

Returns graph-ready timeseries for `growth_pct` and `trades`.

Query:

- `period`: `day|week|month|all` (default `week`)
- `value_source`: `equity|balance` (default `equity`)
- `trade_window`: `day|week|month` (default `day`)
- `limit`: `1..5000` (default `500`)

Response fields:

- `baseline_value`: first non-null value in selected period
- `latest_growth_pct`: growth percent from baseline to latest
- `points[]`: each point contains `ts`, `growth_pct`, `trades`, `trades_long`, `trades_short`

Success `200` example:

```json
{
  "terminal_id": "MT5-A1",
  "period": "week",
  "value_source": "equity",
  "trade_window": "day",
  "from_ts": 1700000000,
  "to_ts": 1700604800,
  "baseline_value": 9950.0,
  "latest_value": 10120.0,
  "latest_growth_pct": 1.7085,
  "points": [
    {
      "received_at": 1700000100,
      "ts": 1700000100,
      "value": 9950.0,
      "growth_pct": 0.0,
      "trades": 2,
      "trades_long": 1,
      "trades_short": 1
    },
    {
      "received_at": 1700000200,
      "ts": 1700000200,
      "value": 10030.0,
      "growth_pct": 0.804,
      "trades": 3,
      "trades_long": 2,
      "trades_short": 1
    }
  ]
}
```

## Error Responses

Error `401` (missing/invalid key):

```json
{
  "detail": "Invalid API key"
}
```

Error `404` (terminal not found):

```json
{
  "detail": "No heartbeat found for terminal_id=MT5-A1"
}
```

Error `422` (timestamp drift too large):

```json
{
  "detail": "Timestamp drift exceeds MT5_MAX_TS_DRIFT_SEC (300s)"
}
```

Error `503` (system monitor dependency unavailable):

```json
{
  "detail": "System monitor is unavailable because 'psutil' is not installed"
}
```

## Example cURL

```bash
curl -s -X POST http://127.0.0.1:8000/mt5/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "login": 12345678,
    "server": "Broker-Demo",
    "terminal_id": "MT5-A1",
    "terminal_active": true,
    "algo_active": true,
    "ts": 1700000000,
    "balance": 10000.0,
    "equity": 9920.0,
    "margin": 1200.0,
    "deposit_load": 12.0,
    "day_trades": 3,
    "week_trades": 15,
    "month_trades": 58
  }'
```

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/monitor/system/realtime
curl -s 'http://127.0.0.1:8000/monitor/system/realtime?force=true'
curl -s http://127.0.0.1:8000/mt5/heartbeat/latest/MT5-A1
curl -s http://127.0.0.1:8000/mt5/heartbeat/overview
curl -s http://127.0.0.1:8000/mt5/heartbeat/summary/MT5-A1/day
curl -s http://127.0.0.1:8000/mt5/heartbeat/dashboard/MT5-A1
curl -s 'http://127.0.0.1:8000/mt5/heartbeat/curve/MT5-A1?period=week&limit=300'
curl -s 'http://127.0.0.1:8000/mt5/heartbeat/growth/MT5-A1?period=week&value_source=equity&trade_window=day&limit=300'
