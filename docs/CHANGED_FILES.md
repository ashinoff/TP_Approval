# Файлы этапа минимального ядра — 31.10.2026

## 04.11.2026 — Рабочее место документа и сверка V4
- API: tu-rules.ts (DOCX_CONTEXT_V4), tu-validation.ts (подтверждения, openBlockers), documents.ts (table/numbering у блоков), tu-import.ts (ФИО без точки), app.ts (маршрут confirm, подтверждения в карточке).
- БД: db/migrations/014_tu_check_confirmations.sql.
- Web: новые ActHeader.tsx, RouteLine.tsx, tokens.css, workspace.css; переписаны WordWorkspace.tsx, ActDocument.tsx (PreparationControls, SendButton), ContractDocuments.tsx (PackagePanel), TuPreflight.tsx; изменены App.tsx, DocumentViewer.tsx, main.tsx; размеры шрифтов в style/registry/practical/engineer/word.css.
- Тесты: tu-rules.test.ts (переписан, синтетический шаблон «Россети Юг»), tu-import.test.ts, engineer.integration.ts (группа подтверждения), engineer.browser.ts (кнопки ТУ).
- Документы: docs/codex/CODEX_PROMPTS.md, docs/design/target-ui.html и снимки, PROGRESS, DECISIONS, ENGINEER_WORKSPACE, IMPLEMENTATION_PLAN, AGENTS.md.

## 03.11.2026 — Исправление 415 и упрощение создания
Новые prepare-tu.ts, prepare-tu.test.ts, миграция 013, SOFTWARE_SUMMARY.md; изменены files.ts (строгий по умолчанию валидатор и специальный режим подготовки), app.ts (подготовка ТУ/nullable date), EngineerUpload/App/Ui (одна кнопка/копия/необязательные реквизиты), package/lock (jszip), engineer integration/browser, README и контекст. Проверки: build, 26 unit, 73 integration, engineer browser7, реальный ТУ в Chrome без сохранения. Пользователь разрешил GitHub push исходников/контекста; реальные документы/секреты исключены.

## 03.11.2026 — Создание документа из ТУ
- API: новый apps/api/src/tu-import.ts; apps/api/src/app.ts — защищённое извлечение; contract-documents.ts — имена выгрузки по договору.
- Web: EngineerUpload.tsx — единая форма/автозаполнение; App.tsx — удаление второй формы и понятная ошибка внешних связей; Registry.tsx — название действия; ContractDocuments.tsx и WordWorkspace.tsx — выбор документа пакета, ТУ без решений/замечаний.
- Проверки: новый tests/tu-import.test.ts; engineer.integration.ts и engineer.browser.ts; contract-documents.integration.ts/browser.ts; browser.e2e.ts и matrix.browser.ts — прежние минимальные legacy-fixtures готовятся API, новый пользовательский импорт проверяется engineer.browser без исключения gate; scripts/create-engineer-fixtures.py — синтетический заявитель. Проверки бизнес-правил не удалялись.
- Контекст: AGENTS.md, PROJECT_CONTEXT, PROGRESS, IMPLEMENTATION_PLAN, DECISIONS, REGISTRY_UI, DOCX_PROTOTYPE, API_CONTRACTS; новый docs/TU_IMPORT.md.
- Локальные диагностические скрипты/копия ТУ/отчёты только в игнорируемой .local; не включать в Git. Прежние незакоммиченные изменения сохранены.

## 03.11.2026 — Меню инженера и проверка ТУ
Новые: db/migrations/012_engineer_preflight.sql; apps/api/src/tu-rules.ts, tu-validation.ts; apps/web/src/EngineerUpload.tsx, document-upload.ts, TuPreflight.tsx, engineer.css; scripts/create-engineer-fixtures.py; tests/tu-rules.test.ts, engineer.integration.ts, engineer.browser.ts, engineer-persistence.ts; docs/ENGINEER_WORKSPACE.md.
Изменены в этом этапе: apps/api/src/app.ts, registry.ts, workflow.ts; apps/web/src/App.tsx, workplace.ts, ActDocument.tsx, WordWorkspace.tsx, main.tsx; package.json; tests/workplace.test.ts, workplace.ui.ts, riru-review.fixture.ts, core.integration.ts, matrix.integration.ts, registry.integration.ts, documents.integration.ts, navigation.integration.ts, contract-documents.integration.ts, riru-review.integration.ts, browser.e2e.ts, matrix.browser.ts, documents.browser.ts, workplace.browser.ts, contract-documents.browser.ts, riru-review.browser.ts; AGENTS.md, PROJECT_CONTEXT, PROGRESS, IMPLEMENTATION_PLAN и связанная документация. Прежние изменения сохранены; миграции 001–011 не изменялись. Фактические проверки и ограничения — начало PROGRESS.md.

## 02.11.2026 — Инженер РИРУ, первый руководитель РИРУ, ТЕХБЛОК
Новые: db/migrations/010_riru_engineer_review.sql, 011_freeze_cycle_route.sql; tests/riru-review.fixture.ts, riru-review.integration.ts, riru-review.browser.ts, riru-review-persistence.ts; docs/ROLES_WORKFLOW.md.
Изменены в этом этапе: apps/api/src/app.ts, workflow.ts, registry.ts, matrix.ts, documents.ts, contract-documents.ts, timeline.ts; apps/web/src/App.tsx, WordWorkspace.tsx, workplace.ts, Ui.tsx, Registry.tsx, ApprovalMatrix.tsx; scripts/demo-users.ts; package.json; tests/core.integration.ts, matrix.integration.ts, registry.integration.ts, documents.integration.ts, navigation.integration.ts, contract-documents.integration.ts, workplace.test.ts, matrix.test.ts, workplace.ui.ts, browser.e2e.ts, browser-persistence.ts, matrix.browser.ts, registry.browser.ts, documents.browser.ts, workplace.browser.ts, contract-documents.browser.ts; AGENTS.md и docs/PROJECT_CONTEXT.md, PROGRESS.md, IMPLEMENTATION_PLAN.md, DECISIONS.md, API_CONTRACTS.md, APPROVAL_MATRIX.md, REGISTRY_UI.md, DOCX_PROTOTYPE.md, LOCAL_BROWSER_GUIDE.md, CONTRACT_DOCUMENTS.md, CORE_STATUS.md, CHANGED_FILES.md.
Прежние незакоммиченные изменения сохранены, миграции 001–009 не менялись. Результаты текущих проверок — начало PROGRESS.md. Исходные документы, опубликованные версии, SUE_system, удалённый Git и инфраструктура не изменялись.

## 02.11.2026 — Типизированная загрузка ТУ / акт ТП / АВТУ
Новые: db/migrations/009_contract_documents.sql; apps/api/src/contract-documents.ts; apps/web/src/ContractDocuments.tsx; tests/contract-documents.integration.ts, contract-documents.browser.ts, contract-documents-persistence.ts.
Изменены в этом этапе: apps/api/src/app.ts, registry.ts; apps/web/src/ActDocument.tsx, App.tsx, Registry.tsx, WordWorkspace.tsx, practical.css; scripts/create-document-fixtures.py; tests/matrix.integration.ts; package.json; AGENTS.md; docs/PROJECT_CONTEXT.md, PROGRESS.md, IMPLEMENTATION_PLAN.md, DECISIONS.md, CONTRACT_DOCUMENTS.md, API_CONTRACTS.md, DOCX_PROTOTYPE.md, REGISTRY_UI.md, CHANGED_FILES.md, LOCAL_BROWSER_GUIDE.md.
Этот перечень отделён от уже существовавшего большого незакоммиченного изменения рабочего места. Миграции 001–008 не редактировались. Реальные примеры/ПДн не переносились в Git или синтетическую БД.
Также обновлён docs/CORE_STATUS.md с указанием реализованной модели документов и сохранённых ограничений.

## 02.11.2026 — Исследование ТУ и АВТУ
Добавлен `docs/CONTRACT_DOCUMENTS.md`; обновлены `.gitignore`, PROJECT_CONTEXT/PROGRESS/IMPLEMENTATION_PLAN/DECISIONS/CHANGED_FILES. В `.local` созданы только локальные исследовательские скрипты и отчёт с исходными фрагментами, они не публикуются. Реальные документы не изменялись и не добавлялись в Git. Исследовательское сравнение не интегрировано в рабочий API/UI, DDL/workflow прежние.

## Упрощение эксплуатации — 01.11.2026
Новые: `apps/web/src/workplace.ts`, `practical.css`; `tests/workplace.test.ts`, `workplace.ui.ts`, `workplace.browser.ts`, `navigation.integration.ts`.

Изменены: `apps/web/src/App.tsx`, `Registry.tsx`, `ActDocument.tsx`, `WordWorkspace.tsx`, `DocumentViewer.tsx`, `DecisionDialog.tsx`, `ApprovalMatrix.tsx`, `Ui.tsx`, `main.tsx`; `apps/api/src/registry.ts`, `app.ts`, `workflow.ts`, `matrix.ts`; `tests/browser.e2e.ts`, `browser-persistence.ts`, `documents.browser.ts`, `documents-persistence.ts`, `documents.integration.ts`, `matrix.browser.ts`, `matrix.integration.ts`, `matrix.test.ts`, `registry.browser.ts`, `registry.integration.ts`; `package.json` (test:workplace:browser). Обновлены AGENTS/README/PROJECT_CONTEXT/PROGRESS/REGISTRY_UI/DOCX_PROTOTYPE/DECISIONS/IMPLEMENTATION_PLAN/CORE_STATUS/API_CONTRACTS/LOCAL_BROWSER_GUIDE/CHANGED_FILES. Применённые миграции не менялись, новых DDL-миграций нет. Точные исходные якоря сохранены; WordWorkspace стабилизирует записи, чтобы polling не перерисовывал неизменившийся документ. DocumentViewer дополнен повторным запросом фокуса того же маркера; ссылка из истории выбирает исходную версию замечания. Push/коммит/деплой и изменения SUE_system не выполняются.

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
