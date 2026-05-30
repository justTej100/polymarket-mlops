# polymarket-mlops Makefile
# make run  — full bootstrap: venv, deps, Docker, supervisor (see docs/CODEBASE.md)
.PHONY: up down test lint start install setup run venv venv-reset env help urls

VENV ?= .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

help:
	@echo "polymarket-mlops — common targets:"
	@echo "  make run         Create/use .venv, install deps, copy .env, start Docker, run app"
	@echo "  make setup       venv + pip install + .env (no Docker, no app)"
	@echo "  make start       setup + run supervisor (Docker must already be up)"
	@echo "  make up / down   Start / stop Docker infrastructure"
	@echo "  make urls        Print service URLs (API, Grafana, MLflow, Prometheus)"
	@echo "  make venv-reset  Delete .venv and recreate from scratch"
	@echo "  make test        Run pytest (auto-uses .venv)"
	@echo "  make lint        Ruff check (auto-uses .venv)"

# Create .venv if missing (Make treats this as a file target).
$(VENV)/bin/python:
	@echo ">> Creating virtual environment in $(VENV)..."
	python3 -m venv $(VENV)

venv: $(VENV)/bin/python

venv-reset:
	rm -rf $(VENV)
	$(MAKE) venv

env:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo ">> Created .env from .env.example"; \
	fi

install: venv
	@echo ">> Installing dependencies into $(VENV)..."
	$(PIP) install -e ".[dev]"

setup: install env
	@echo ">> Setup complete (.venv ready, deps installed, .env present)."

up:
	docker compose up -d

down:
	docker compose down

urls: setup
	@$(PYTHON) -c "from src.startup import print_service_urls; print_service_urls()"

start: setup
	@echo ">> Starting application (Ctrl+C to stop)..."
	$(PYTHON) -m src.supervisor

run: setup up
	@echo ">> Docker infrastructure is up. Starting application..."
	@echo ">> Service URLs will print below once the API is ready."
	@echo ""
	$(PYTHON) -m src.supervisor

test: install
	$(VENV)/bin/pytest tests/ -v

lint: install
	$(VENV)/bin/ruff check src tests
	$(VENV)/bin/ruff format --check src tests
