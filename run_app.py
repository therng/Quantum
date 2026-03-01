import os

import uvicorn


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return int(raw)
    except ValueError:
        return default


if __name__ == "__main__":
    host = os.getenv("APP_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = _int_env("APP_PORT", 8000)
    log_level = os.getenv("APP_LOG_LEVEL", "info").strip() or "info"
    reload_enabled = os.getenv("APP_RELOAD", "0").strip().lower() in {"1", "true", "yes"}

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        log_level=log_level,
        reload=reload_enabled,
    )
