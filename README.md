# Quantum

FastAPI service that receives and stores MT5 terminal heartbeats in memory.

API reference: see `API_ENDPOINTS.md`.

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
cp .env.example .env
```

## Run locally

```bash
# edit .env first
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --log-level info
```



