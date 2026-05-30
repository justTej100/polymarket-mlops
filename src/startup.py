"""Wait for dependent services before starting workers."""

from __future__ import annotations

import logging
import os
import sys
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


def service_urls() -> dict[str, str]:
    """Resolved URLs for UI and API endpoints (from env or defaults)."""
    signal = os.getenv("SIGNAL_SERVICE_URL", "http://localhost:8000").rstrip("/")
    return {
        "api_docs": f"{signal}/docs",
        "benchmark": f"{signal}/benchmark",
        "meta_weights": f"{signal}/meta/weights",
        "health": f"{signal}/health",
        "metrics": f"{signal}/metrics",
        "grafana": os.getenv("GRAFANA_URL", "http://localhost:3000").rstrip("/"),
        "mlflow": os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000").rstrip("/"),
        "prometheus": os.getenv("PROMETHEUS_URL", "http://localhost:9090").rstrip("/"),
        "prometheus_targets": f"{os.getenv('PROMETHEUS_URL', 'http://localhost:9090').rstrip('/')}/targets",
    }


def print_service_urls(*, file=None) -> None:
    """Print a banner of URLs to open in the browser (stdout by default)."""
    urls = service_urls()
    lines = [
        "",
        "══════════════════════════════════════════════════════════════",
        "  polymarket-mlops — open in your browser",
        "══════════════════════════════════════════════════════════════",
        "  Backend (FastAPI)",
        f"    API docs:      {urls['api_docs']}",
        f"    Benchmark:     {urls['benchmark']}",
        f"    Meta weights:  {urls['meta_weights']}",
        f"    Health:        {urls['health']}",
        "",
        "  Dashboards & observability (Docker)",
        f"    Grafana:       {urls['grafana']}  (login: admin / admin)",
        f"    MLflow:        {urls['mlflow']}",
        f"    Prometheus:    {urls['prometheus_targets']}",
        "══════════════════════════════════════════════════════════════",
        "  Ctrl+C in this terminal to stop the application",
        "",
    ]
    out = file if file is not None else sys.stdout
    for line in lines:
        print(line, file=out, flush=True)


def wait_for_http_health(
    base_url: str,
    *,
    path: str = "/health",
    timeout_seconds: float = 60.0,
    poll_interval_seconds: float = 0.5,
) -> bool:
    """Poll until GET base_url+path returns HTTP 200, or timeout."""
    url = base_url.rstrip("/") + path
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    logger.info("Service ready at %s", url)
                    return True
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            logger.debug("Waiting for %s: %s", url, exc)
        time.sleep(poll_interval_seconds)
    logger.error("Timed out waiting for %s after %.0fs", url, timeout_seconds)
    return False
