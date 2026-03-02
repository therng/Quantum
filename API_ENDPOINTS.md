# API Endpoints

Base URL:

- `http://<host>:<port>`
- Local default is usually `http://127.0.0.1:8000` (or your configured uvicorn port).

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

## Endpoints

### GET `/health`

Returns service health and runtime metadata.

Success `200`:

```json
{
  "ok": true,
  "uptime_sec": 1234,
  "tracked_terminals": 2,
  "max_ts_drift_sec": 300
}
```

### POST `/mt5/heartbeat`

Accepts a heartbeat payload and stores the latest value per `terminal_id`.

Headers:

- `Content-Type: application/json`
- `X-API-Key: <your-api-key>`

Required JSON fields:

- `login` (integer)
- `server` (string, 1..128)
- `terminal_id` (string, 1..128)
- `terminal_active` (boolean)
- `algo_active` (boolean)
- `ts` (integer unix timestamp)

Optional JSON fields:

- `account_name` (string, max 256)
- `latency_ms` (integer, >= 0)
- `trades_last_3d` (integer, >= 0)
- `volume_last_3d` (number)
- `profit_last_3d` (number)
- `trades_last_7d` (integer, >= 0)
- `volume_last_7d` (number)
- `profit_last_7d` (number)
- `connected` (boolean)
- `build` (integer, >= 0)
- `balance` (number)
- `equity` (number)
- `margin` (number)
- `free_margin` (number)
- `margin_level` (number)
- `positions_total` (integer, >= 0)
- `orders_total` (integer, >= 0)
- `floating_pl` (number)
- `last_error` (integer)

Notes:

- Unknown extra fields are ignored.
- Data is stored in memory only (not persisted across restart).

Success `200`:

```json
{
  "ok": true,
  "received_at": 1700000000,
  "terminal_id": "MT5-A1"
}
```

Error `401` (missing/invalid key):

```json
{
  "detail": "Invalid API key"
}
```

Error `422` (timestamp drift too large):

```json
{
  "detail": "Timestamp drift exceeds MT5_MAX_TS_DRIFT_SEC (300s)"
}
```

### GET `/mt5/heartbeat/terminals`

Returns tracked terminal IDs in ascending order.

Success `200`:

```json
[
  "MT5-A1",
  "MT5-B2"
]
```

### GET `/mt5/heartbeat/latest/{terminal_id}`

Returns latest heartbeat for one terminal.

Path parameter:

- `terminal_id` (string)

Success `200`:

```json
{
  "received_at": 1700000000,
  "payload": {
    "login": 12345678,
    "server": "Broker-Demo",
    "terminal_id": "MT5-A1",
    "terminal_active": true,
    "algo_active": true,
    "ts": 1700000000
  }
}
```

Error `404`:

```json
{
  "detail": "No heartbeat found for terminal_id=MT5-A1"
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
    "ts": 1700000000
  }'
```

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/mt5/heartbeat/terminals
curl -s http://127.0.0.1:8000/mt5/heartbeat/latest/MT5-A1
```


