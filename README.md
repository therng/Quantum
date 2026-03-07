# MT5 Heartbeat API

## Overview
A FastAPI backend that receives and stores heartbeat data from MetaTrader 5 (MT5) trading terminals. It tracks terminal state, system metrics, and trade history in memory.

This repository also contains a separate dashboard app in `App/` built with React, Vite, Express, and Drizzle.

## Architecture
- **Language**: Python 3.12
- **Framework**: FastAPI + Uvicorn
- **Dashboard app**: `App/` contains a separate TypeScript frontend/server app
- **Storage**: In-memory (no persistent database)

## Key Files
- `main.py` - Main FastAPI application (~1043 lines)
- `windows_monitor.py` - Windows system monitor abstraction
- `requirements.txt` - Python dependencies
- `api.mq5` - MetaTrader 5 EA/script file (not Python)
- `App/` - Dashboard app and local Express API

## Running the App
- **Development**: `uvicorn main:app --host 0.0.0.0 --port 5000 --log-level info`
- **Production**: `gunicorn --bind=0.0.0.0:5000 --reuse-port --workers=1 main:app`

## Dashboard App (`App/`)

### Environment
Copy `App/.env.example` to `App/.env` and set:

- `DATABASE_URL` - Required for the local Express/Drizzle app
- `PORT` - Optional local app port, defaults to `5000`
- `VITE_API_BASE_URL` - Optional FastAPI base URL for MT5 read endpoints
- `VITE_MT5_READ_API_KEY` - Optional read key for protected MT5 endpoints

### Install

```bash
cd App
npm install
```

### Run In Development

```bash
cd App
npm run dev
```

This starts the local Express server and serves the Vite client.

### Build

```bash
cd App
npm run build
```

### Run Production Build

```bash
cd App
npm run start
```

### Type Check

```bash
cd App
npm run check
```

## Configuration (Environment Variables)
- `APP_HOST` - Bind host (default: `0.0.0.0`)
- `APP_PORT` - Port (set to `5000` for Replit)
- `APP_LOG_LEVEL` - Log level (default: `info`)
- `MT5_API_KEY` - Write API key for authentication
- `MT5_READ_API_KEY` - Read-only API key (falls back to write key if empty)
- `MT5_MAX_TS_DRIFT_SEC` - Max timestamp drift allowed (default: 300s)
- `CORS_ALLOW_ORIGINS` - CORS origins (default: `*`)

## Deployment
- Target: `vm` (always-running, stateful in-memory storage)
- Port: 5000

## API Endpoints
See `ENDPOINTS.md` for full documentation.
