"""One-command supervisor: feature pipeline, signal service, System A, System C."""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
PROCS: list[subprocess.Popen] = []


def _spawn(cmd: list[str], name: str) -> subprocess.Popen:
    logger.info("Starting %s: %s", name, " ".join(cmd))
    proc = subprocess.Popen(cmd, cwd=ROOT, env=os.environ.copy())
    PROCS.append(proc)
    return proc


def _shutdown(_signum=None, _frame=None) -> None:
    logger.info("Shutting down supervisor...")
    for proc in PROCS:
        proc.terminate()
    for proc in PROCS:
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    sys.exit(0)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    use_mock = os.getenv(
        "FEATURE_PIPELINE_MOCK",
        "true" if os.getenv("DRY_RUN", "true") == "true" else "false",
    )
    pipeline_env = os.environ.copy()
    pipeline_env["FEATURE_PIPELINE_MOCK"] = use_mock
    logger.info("Starting feature_pipeline (mock=%s)", use_mock)
    proc = subprocess.Popen(
        [sys.executable, "-m", "src.data.feature_pipeline"],
        cwd=ROOT,
        env=pipeline_env,
    )
    PROCS.append(proc)

    _spawn(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "src.signal_service.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
        ],
        "signal_service",
    )

    time.sleep(2)

    if os.getenv("RUN_SYSTEM_A", "true").lower() == "true":
        _spawn([sys.executable, "-m", "src.system_a.run_all", "--dry-run"], "system_a")

    if os.getenv("RUN_SYSTEM_C", "true").lower() == "true":
        _spawn([sys.executable, "-m", "src.system_c.copytrade"], "system_c")

    logger.info("Supervisor running — FastAPI at http://localhost:8000")

    while True:
        for proc in list(PROCS):
            if proc.poll() is not None:
                logger.error("Process exited with code %s — shutting down", proc.returncode)
                _shutdown()
        time.sleep(5)


if __name__ == "__main__":
    main()
