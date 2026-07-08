.PHONY: help install dev worker build start test lint typecheck prisma-generate prisma-migrate clean

help:
	@echo "polymarket-strategies - common targets:"
	@echo "  make install          Install npm dependencies"
	@echo "  make dev              Start the Next.js dev server"
	@echo "  make worker           Start the always-on live market worker"
	@echo "  make build            Build the Next.js app"
	@echo "  make start            Start the production Next.js server"
	@echo "  make test             Run TypeScript checks and strategy/API tests"
	@echo "  make lint             Run configured static checks"
	@echo "  make prisma-generate  Generate the Prisma client"
	@echo "  make prisma-migrate   Run the local Prisma migration flow"
	@echo "  make clean            Remove local build artifacts"
	@echo ""
	@echo "On Windows, run these through WSL, for example:"
	@echo "  wsl bash -lc 'cd /home/tj/pm && make test'"

install:
	npm install

dev:
	npm run dev

worker:
	npm run worker

build:
	npm run build

start:
	npm run start

typecheck:
	npm run typecheck

test:
	npm run typecheck
	npm run test

lint:
	npm run lint

prisma-generate:
	npm run prisma:generate

prisma-migrate:
	npm run prisma:migrate

clean:
	rm -rf .next tsconfig.tsbuildinfo
