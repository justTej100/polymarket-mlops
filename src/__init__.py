"""Top-level package for the Polymarket MLOps trading benchmark.

This repository runs a multi-system paper-trading stack: a Redis-backed data plane,
a FastAPI signal service (Systems A/B/C), rule-based System A strategies, and
System C copytrade. Import ``src`` (or subpackages such as ``src.supervisor``) from
the repo root after installing the project.

Exports:
    __version__: Package version string consumed by tooling and the signal service.

Related entry points:
    ``src.supervisor`` — orchestrates all long-running processes.
    ``src.startup`` — health checks and operator URL banner.
"""

__version__ = "0.1.0"
