# Локальная разработка УТЭК. Требуется Docker, Go, Node.js и GNU Make.

.DEFAULT_GOAL := help

.PHONY: help setup infra-up infra-down infra-logs migrate api web test build clean db-shell

help: ## Показать доступные команды
	@powershell -NoProfile -Command "Select-String -Path Makefile -Pattern '^[a-zA-Z_-]+:.*##' | ForEach-Object { if ($$_.Line -match '^([^:]+):.*## (.*)') { '{0,-14} {1}' -f $$matches[1], $$matches[2] } }"

setup: ## Установить зависимости фронтенда
	cd frontend && npm install

infra-up: ## Запустить PostgreSQL и Redis в Docker
	docker compose up -d

infra-down: ## Остановить PostgreSQL и Redis
	docker compose down

infra-logs: ## Смотреть логи PostgreSQL и Redis
	docker compose logs -f

db-shell: ## Открыть консоль PostgreSQL
	docker compose exec postgres psql -U utec -d utec_admissions

migrate: ## Создать или обновить таблицы PostgreSQL
	powershell -NoProfile -Command "Get-Content -Raw backend/migrations/001_initial.sql | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U utec -d utec_admissions"

api: ## Запустить Go API: http://localhost:8080
	cd backend && go run .

web: ## Запустить React-сайт: обычно http://localhost:5173
	cd frontend && npm run dev

test: ## Проверить Go API и production-сборку React
	cd backend && go test ./...
	cd frontend && npm run build

build: ## Собрать React для публикации
	cd frontend && npm run build

clean: ## Удалить локальные контейнеры и тома разработки (данные БД будут удалены)
	docker compose down -v
