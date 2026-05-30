.PHONY: up down test lint start install

up:
	docker compose up -d

down:
	docker compose down

install:
	pip install -e ".[dev]"

test:
	pytest tests/ -v

lint:
	ruff check src tests
	ruff format --check src tests

start:
	python -m src.supervisor
