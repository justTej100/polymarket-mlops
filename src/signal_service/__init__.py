"""FastAPI signal service — paper trading hub for Systems A, B, and C.

Hosts the central API (uvicorn ``src.signal_service.main:app``): ingests strategy
and copytrade signals, simulates orders, tracks benchmark PnL, and serves
meta-learner weights plus Prometheus metrics.

Submodules:
    main — HTTP routes and app wiring.
    paper_trader — DRY_RUN execution and session risk caps.
    benchmark — per-system trade log and stats persistence.
    meta_learner — A/B/C weight learning from resolved outcomes.
    feature_builder — Redis + benchmark features for the meta model.
    schemas — Pydantic OpenAPI response models.
"""
