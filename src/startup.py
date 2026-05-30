"""Wait for dependent services before starting workers."""

from __future__ import annotations

import logging
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


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
