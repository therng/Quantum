# MT5 Heartbeat API — OpenAPI-style Endpoint Table

| Method | Path | Auth | Description | Key Params / Body |
|------|------|------|------|------|
| GET | / | none | Redirect to admin dashboard | — |
| GET | /admin | none | Serve admin HTML dashboard | — |
| GET | /health | none | Backend health check and stats | — |
| GET | /monitor/system/realtime | Read API Key | Windows system metrics | query: force |
| GET | /mt5/heartbeat/latest/{terminal_id} | Read API Key | Latest heartbeat of a terminal | path: terminal_id |
| GET | /mt5/heartbeat/terminals | Read API Key | List all tracked terminals | — |
| GET | /mt5/heartbeat/overview | Read API Key | Overview of all terminals | — |
| GET | /mt5/heartbeat/summary/{terminal_id}/{period} | Read API Key | Summary metrics for period | path: terminal_id, period(day|week|month) |
| GET | /mt5/heartbeat/dashboard/{terminal_id} | Read API Key | Full dashboard metrics | path: terminal_id |
| GET | /mt5/heartbeat/history/{terminal_id} | Read API Key | Raw heartbeat history | query: period, limit |
| GET | /mt5/heartbeat/curve/{terminal_id} | Read API Key | Equity/balance time-series | query: period, limit |
| GET | /mt5/heartbeat/growth/{terminal_id} | Read API Key | Growth analytics series | query: period, value_source, trade_window, limit |
| GET | /mt5/public-url | Read API Key | Get ngrok public URL | — |
| POST | /mt5/heartbeat | Write API Key | Receive MT5 heartbeat payload | body: HeartbeatPayload |

---

## Query Parameter Reference

| Name | Type | Default | Description |
|-----|-----|-----|-----|
| period | string | day | Time window: day, week, month, all |
| limit | int | varies | Max points returned |
| value_source | string | equity | Growth base metric (equity/balance) |
| trade_window | string | day | Trade aggregation window |
| force | bool | false | Force refresh system metrics |

---

## Auth Headers

| Header | Description |
|------|------|
| X-API-Key | Required for protected endpoints |

---

## Main Data Model

### HeartbeatPayload

| Field | Type | Description |
|------|------|------|
| login | int | MT5 account login |
| server | string | Broker server |
| terminal_id | string | Unique terminal name |
| terminal_active | bool | Terminal running state |
| algo_active | bool | Algo trading enabled |
| ts | int | MT5 timestamp |
| latency_ms | int | Ping latency |
| connected | bool | Broker connection state |
| balance | float | Account balance |
| equity | float | Account equity |
| margin | float | Used margin |
| free_margin | float | Free margin |
| margin_level | float | Margin level |
| deposit_load | float | Margin / balance % |
| positions_total | int | Open positions |
| orders_total | int | Pending orders |
| floating_pl | float | Floating profit/loss |

Additional fields may include trading statistics for day/week/month windows.

---

## Response Models

| Model | Purpose |
|------|------|
| HeartbeatAck | Confirmation of heartbeat receipt |
| StoredHeartbeat | Raw stored heartbeat record |
| PeriodSummary | Aggregated statistics |
| CurvePoint | Time-series equity/balance point |
| GrowthPoint | Growth analytics point |
| GrowthSeriesResponse | Growth series wrapper |
| TerminalOverview | Compact terminal status |
| HealthResponse | Backend health status |
| SystemRealtimeResponse | System monitor metrics |

---

## Typical Usage Flow

| Step | Endpoint |
|-----|-----|
| 1 | POST /mt5/heartbeat (MT5 sends data) |
| 2 | GET /mt5/heartbeat/overview (dashboard list) |
| 3 | GET /mt5/heartbeat/dashboard/{terminal_id} |
| 4 | GET /mt5/heartbeat/curve/{terminal_id} |
| 5 | GET /mt5/heartbeat/growth/{terminal_id} |
