# Quantum

FastAPI service that receives and stores MT5 terminal heartbeats in memory.

## What it does

- Accepts signed heartbeat payloads from MT5 EAs.
- Validates API key and timestamp drift.
- Stores only the latest heartbeat per `terminal_id`.
- Exposes health and query endpoints for monitoring.

## Requirements

- Python 3.11+
- `pip`
- (Windows service mode) NSSM in `PATH`
- (Public URL option) `ngrok` installed

## Installation (local development)

```bash
cd /path/to/Quantum
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

## Run locally

```bash
export MT5_API_KEY="replace-with-strong-secret"
python run_app.py
```

Default bind is `0.0.0.0:8000`.

## Environment variables

| Variable | Default | Description |
|---|---:|---|
| `MT5_API_KEY` | `your-secret-key` | Primary API key used by MT5. |
| `MT5_API_KEYS` | empty | Optional comma-separated additional keys. |
| `MT5_MAX_TS_DRIFT_SEC` | `300` | Max allowed heartbeat timestamp drift in seconds. |
| `MT5_LOG_HEARTBEAT` | `1` | Log each accepted heartbeat (`1/true/yes/on` enables). |
| `APP_HOST` | `0.0.0.0` | Uvicorn host. |
| `APP_PORT` | `8000` | Uvicorn port. |
| `APP_LOG_LEVEL` | `info` | Uvicorn log level. |
| `APP_RELOAD` | `0` | Enables auto-reload in development. |

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
    "ts": '"$(date +%s)"'
  }'
```

List terminals:

```bash
curl -s http://127.0.0.1:8000/mt5/heartbeat/terminals
```

Get latest heartbeat by terminal:

```bash
curl -s http://127.0.0.1:8000/mt5/heartbeat/latest/MT5-A1
```

## Windows Server 2022 installation (service mode)

1. Copy project to server, example: `C:\Quantum`
2. Install Python 3.11+
3. Install NSSM and ensure `nssm.exe` is available in `PATH`
4. Open PowerShell as Administrator
5. Run setup and install service

```powershell
cd C:\Quantum
powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install_service.ps1 -ApiKey "replace-with-strong-secret" -Port 8000
```

Verify:

```powershell
Get-Service MT5HeartbeatApi
Invoke-WebRequest http://127.0.0.1:8000/health
```

Service logs:

- `logs\service.stdout.log`
- `logs\service.stderr.log`

Remove service:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\remove_service.ps1
```

## Optional: expose API with ngrok (Windows service)

Install ngrok service:

```powershell
cd C:\Quantum
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install_ngrok_service.ps1 -NgrokAuthtoken "<your-ngrok-authtoken>" -LocalPort 8000
```

Optional flags:

- `-ReservedDomain "your-subdomain.ngrok.app"`
- `-BasicAuth "user:strongpass"`

Verify:

```powershell
Get-Service MT5HeartbeatNgrok
ngrok api tunnels list
```

Then configure MT5 EA:

- `ApiUrl`: `https://<your-ngrok-domain>/mt5/heartbeat`
- `ApiKey`: same key as service `-ApiKey`

Remove ngrok service:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\remove_ngrok_service.ps1
```
