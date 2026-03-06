# Quantum Agent Guide

## Scope
- This repository is a Python FastAPI backend for MT5 heartbeat ingestion and monitoring.
- Runtime code lives primarily in `main.py`, with platform-specific monitoring in `windows_monitor.py` and MT5 client code in `api.mq5`.
- Storage is in-memory. Do not assume persistent storage exists unless the task explicitly adds it.

## References
- `fastapi.md` is the primary implementation reference for FastAPI, Pydantic, route design, and dependency patterns.
- `nodejs.md` is a secondary reference for general backend architecture ideas only. Do not introduce Node.js code, tooling, or dependencies unless explicitly requested.

## Working Rules
- Prefer incremental changes in the current code layout. Do not force a large domain-based refactor unless the task requires it.
- Keep `README.md` and `ENDPOINTS.md` aligned with endpoint, auth, or runtime behavior changes.
- Preserve the current auth model around `X-API-Key` and environment-driven configuration unless the task is specifically about changing auth.
- For FastAPI routes, avoid blocking work inside `async def` handlers. Use sync routes or threadpool handoff when needed.

## Run Commands
- Development: `uvicorn main:app --host 0.0.0.0 --port 5000 --log-level info`
- Production: `gunicorn --bind=0.0.0.0:5000 --reuse-port --workers=1 main:app`

## API Notes
- `/` returns lightweight API metadata and points clients to `/health`.
- Protected endpoints use the `X-API-Key` header.
- `ENDPOINTS.md` is the quick reference for the current HTTP surface.
