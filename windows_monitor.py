import os
import platform
import socket
import time
from threading import Lock
from typing import Any, Dict, Optional

try:
    import psutil
except ImportError:  # pragma: no cover - runtime dependency check
    psutil = None


class MonitorUnavailableError(RuntimeError):
    pass


def _to_mb(value: int) -> float:
    return round(float(value) / (1024.0 * 1024.0), 2)


class WindowsSystemMonitor:
    """Collect realtime CPU and memory metrics for Windows Server monitoring."""

    def __init__(self, min_refresh_sec: float = 1.0) -> None:
        self._lock = Lock()
        self._min_refresh_sec = max(0.2, float(min_refresh_sec))
        self._last_collected_monotonic = 0.0
        self._last_snapshot: Optional[Dict[str, Any]] = None

        self._pid = os.getpid()
        self._hostname = socket.gethostname()
        self._os_name = platform.platform()
        self._is_windows = platform.system().lower() == "windows"

        self._process = None
        if psutil is not None:
            self._process = psutil.Process(self._pid)
            # Prime non-blocking counters.
            psutil.cpu_percent(interval=None)
            self._process.cpu_percent(interval=None)

    def _assert_available(self) -> None:
        if psutil is None:
            raise MonitorUnavailableError(
                "System monitor is unavailable because 'psutil' is not installed"
            )

    def _collect(self) -> Dict[str, Any]:
        self._assert_available()

        now_epoch = int(time.time())
        cpu_percent = float(psutil.cpu_percent(interval=None))
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()

        process_cpu_percent = None
        process_memory_percent = None
        process_memory_rss_mb = None
        open_files = None
        thread_count = None

        if self._process is not None:
            try:
                process_cpu_percent = float(self._process.cpu_percent(interval=None))
                process_memory_percent = float(self._process.memory_percent())
                process_memory_rss_mb = _to_mb(self._process.memory_info().rss)
                open_files = len(self._process.open_files())
                thread_count = self._process.num_threads()
            except Exception:
                # Process may terminate or deny metrics; keep API response stable.
                process_cpu_percent = None
                process_memory_percent = None
                process_memory_rss_mb = None
                open_files = None
                thread_count = None

        return {
            "collected_at": now_epoch,
            "host": self._hostname,
            "os": self._os_name,
            "is_windows": self._is_windows,
            "cpu_percent": round(cpu_percent, 2),
            "cpu_logical_cores": int(psutil.cpu_count(logical=True) or 0),
            "cpu_physical_cores": int(psutil.cpu_count(logical=False) or 0),
            "memory_percent": round(float(vm.percent), 2),
            "memory_total_mb": _to_mb(vm.total),
            "memory_used_mb": _to_mb(vm.used),
            "memory_available_mb": _to_mb(vm.available),
            "swap_percent": round(float(swap.percent), 2),
            "swap_total_mb": _to_mb(swap.total),
            "swap_used_mb": _to_mb(swap.used),
            "backend_pid": self._pid,
            "backend_process_cpu_percent": None if process_cpu_percent is None else round(process_cpu_percent, 2),
            "backend_process_memory_percent": None if process_memory_percent is None else round(process_memory_percent, 2),
            "backend_process_memory_rss_mb": process_memory_rss_mb,
            "backend_open_files": open_files,
            "backend_thread_count": thread_count,
            "refresh_interval_sec": self._min_refresh_sec,
        }

    def snapshot(self, force: bool = False) -> Dict[str, Any]:
        now_mono = time.monotonic()

        with self._lock:
            if (
                not force
                and self._last_snapshot is not None
                and (now_mono - self._last_collected_monotonic) < self._min_refresh_sec
            ):
                return self._last_snapshot

            snapshot = self._collect()
            self._last_snapshot = snapshot
            self._last_collected_monotonic = now_mono
            return snapshot
