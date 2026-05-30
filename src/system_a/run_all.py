"""Spawn enabled System A strategies as independent subprocesses.

Reads ``RUN_STRAT1`` … ``RUN_STRAT9`` from env. Each enabled strategy runs as
its own Python process (``python -m src.system_a.strategy_N_*``).

If a strategy process exits, it is automatically restarted every 5 seconds.

Environment:
  - ``RUN_SYSTEM_A`` — master toggle for all of System A
  - ``RUN_STRAT1`` … ``RUN_STRAT9`` — per-strategy toggles
  - ``DRY_RUN`` — passed through to child processes
"""

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

ROOT = Path(__file__).resolve().parents[2]

STRATEGY_MODULES = {
    1: "src.system_a.strategy_1_penny_buy",
    2: "src.system_a.strategy_2_sniper",
    3: "src.system_a.strategy_3_dual_reversion",
    4: "src.system_a.strategy_4_preorder",
    5: "src.system_a.strategy_5_cross_market",
    6: "src.system_a.strategy_6_martingale",
    7: "src.system_a.strategy_7_fibonacci",
    8: "src.system_a.strategy_8_momentum",
    9: "src.system_a.strategy_9_dump_hedge",
}

# All nine strategies implemented
IMPLEMENTED = set(STRATEGY_MODULES.keys())


def enabled_strategies() -> list[int]:
    """Return strategy ids with ``RUN_STRAT{n}=true`` and an implemented module."""
    enabled: list[int] = []
    for strat_id in STRATEGY_MODULES:
        flag = os.getenv(f"RUN_STRAT{strat_id}", "false").lower() == "true"
        if flag and strat_id in IMPLEMENTED:
            enabled.append(strat_id)
    return enabled


def spawn_strategy(strat_id: int, dry_run: bool = True) -> subprocess.Popen:
    """Start ``python -m src.system_a.strategy_N_*`` as a subprocess."""
    module = STRATEGY_MODULES[strat_id]
    env = os.environ.copy()
    env["DRY_RUN"] = "true" if dry_run else "false"
    cmd = [sys.executable, "-m", module.replace("/", ".")]
    logger.info("Spawning strategy %s: %s", strat_id, " ".join(cmd))
    return subprocess.Popen(cmd, cwd=ROOT, env=env)


def run_all(dry_run: bool = True) -> None:
    if os.getenv("RUN_SYSTEM_A", "true").lower() != "true":
        logger.info("RUN_SYSTEM_A=false — skipping System A")
        return

    procs: dict[int, subprocess.Popen] = {}
    for strat_id in enabled_strategies():
        procs[strat_id] = spawn_strategy(strat_id, dry_run=dry_run)

    if not procs:
        logger.warning("No strategies enabled")
        return

    def _shutdown(_signum, _frame) -> None:
        for proc in procs.values():
            proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while True:
        for strat_id, proc in list(procs.items()):
            code = proc.poll()
            if code is not None:
                logger.warning("Strategy %s exited (%s) — restarting", strat_id, code)
                procs[strat_id] = spawn_strategy(strat_id, dry_run=dry_run)
        time.sleep(5)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    dry_run = "--dry-run" in sys.argv or os.getenv("DRY_RUN", "true").lower() == "true"
    run_all(dry_run=dry_run)


if __name__ == "__main__":
    main()
