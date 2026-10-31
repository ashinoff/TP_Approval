# Файлы этапа минимального ядра — 31.10.2026

## DOCX-прототип — 01.11.2026
Новые: `db/migrations/007_document_remarks.sql`, `008_category_admin.sql`; `apps/api/src/documents.ts`; `apps/web/src/DocumentViewer.tsx`, `WordWorkspace.tsx`, `word.css`; `scripts/create-document-fixtures.py`; `tests/documents.test.ts`, `documents.integration.ts`, `documents.browser.ts`, `documents-persistence.ts`; `docs/DOCX_PROTOTYPE.md`.

Изменены: `apps/api/src/app.ts`, `files.ts`, `workflow.ts`, `registry.ts`, `timeline.ts`; `apps/web/src/App.tsx`, `Registry.tsx`, `main.tsx`; `tests/matrix.integration.ts`, `registry.browser.ts`; package.json/package-lock.json; AGENTS и PROJECT_CONTEXT/PROGRESS/IMPLEMENTATION_PLAN/DECISIONS/CORE_STATUS/CHANGED_FILES/REGISTRY_UI/APPROVAL_MATRIX. Применённые миграции 001–006 не менялись. Новые зависимости закреплены: docx-preview 0.3.7, DOMPurify 3.4.17, diff 8.0.4 и типы. Синтетические complex-v1/v2 и browser artifacts остаются в `.local` вне Git.

## Реестр, маршрут и timeline — 01.11.2026
Новые: `db/migrations/006_registry_timeline.sql`; `apps/api/src/registry.ts`, `timeline.ts`; `apps/web/src/Registry.tsx`, `Ui.tsx`, `RouteFlow.tsx`, `Timeline.tsx`, `ActDocument.tsx`, `DecisionDialog.tsx`, `registry.css`; `tests/registry.test.ts`, `registry.integration.ts`, `registry.browser.ts`; `docs/REGISTRY_UI.md`.

Изменены: `apps/api/src/app.ts`, `db.ts`; `apps/web/src/App.tsx`, `main.tsx`; `tests/matrix.integration.ts`, `matrix.browser.ts`, `browser.e2e.ts`, `browser-persistence.ts`; `package.json` (test:registry:browser); PROGRESS/PROJECT_CONTEXT/APPROVAL_MATRIX/IMPLEMENTATION_PLAN/DECISIONS/CORE_STATUS/CHANGED_FILES. Прежние миграции, командный workflow, уведомления и badge не менялись. Артефакты Chrome и тестовые документы остаются в игнорируемой `.local`.

## Матрица согласования — 31.10.2026
Новые: db/migrations/005_matrix_history.sql, apps/api/src/matrix.ts, apps/web/src/ApprovalMatrix.tsx, tests/matrix.test.ts, tests/matrix.integration.ts, tests/matrix.browser.ts, docs/APPROVAL_MATRIX.md. Изменены apps/api/src/app.ts (GET route), apps/web/src/App.tsx и style.css, scripts/integration.ts, package.json (test:matrix:browser); обновлены PROJECT_CONTEXT/PROGRESS/CORE_STATUS/API_CONTRACTS/DATA_MODEL/IMPLEMENTATION_PLAN/DECISIONS/LOCAL_BROWSER_GUIDE/CHANGED_FILES/README. Workflow, уведомления и badge не изменены; применённые миграции 001–004 не редактировались. Локальные browser-артефакты — .local/matrix-report, не Git.

## Дополнения локальной браузерной проверки
Новые: apps/web/src/App.tsx; scripts/local-demo.ts, demo-users.ts, create-demo-documents.py; tests/browser.e2e.ts, browser-persistence.ts; docs/LOCAL_BROWSER_GUIDE.md. Обновлены apps/web/src/main.tsx, style.css, apps/api/src/app.ts, package.json/package-lock.json и AGENTS/README/PROJECT_CONTEXT/CORE_STATUS/PROGRESS/IMPLEMENTATION_PLAN/DECISIONS/CHANGED_FILES. Миграции и бизнес-переходы не менялись. Демо-данные, ключи, JWT и screenshots — только .local, вне Git.

Все изменения локальные, без коммита и push. Репозиторий пока без HEAD, поэтому Git показывает файлы как untracked, включая документацию первого этапа.

## Конфигурация и окружение
`.env.example`, `.gitignore`, `.dockerignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.api.json`, `Dockerfile`, `infra/compose.yaml`.

## Сервер
`apps/api/src/app.ts`, `auth.ts`, `db.ts`, `files.ts`, `server.ts`, `workflow.ts`.

## Интерфейс
`apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `style.css`, `env.d.ts`.

## Миграции
`db/migrations/001_core.sql`, `002_admin.sql`, `003_assignment_slots.sql`, `004_deadline_events.sql`.

## Инструменты и тесты
`scripts/migrate.ts`, `bootstrap.ts`, `integration.ts`; `tests/security.test.ts`, `core.integration.ts`, `zip.ts`.

## Документация
Обновлены `AGENTS.md`, `README.md`, `docs/PROJECT_CONTEXT.md`, `PROGRESS.md`, `IMPLEMENTATION_PLAN.md`, `DECISIONS.md`, `API_CONTRACTS.md`, `DATA_MODEL.md`, `ARCHITECTURE_REVIEW.md`. Созданы `docs/CORE_STATUS.md` и этот список. `docs/SUE_SYSTEM_REVIEW.md` сохранён из первого этапа без изменений.
