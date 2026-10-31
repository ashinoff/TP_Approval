# TP_Approval

Система согласования актов технологического присоединения для Сочинского ПЭС.

Состояние на 31.10.2026: архитектура утверждена, реализовано минимальное ядро Express/React/PostgreSQL с RLS и JWT. Полная система ещё в разработке.

**Локальная проверка без боевого Keycloak:** `npm.cmd run demo`, затем http://127.0.0.1:5173. Девять синтетических пользователей выбираются на тестовом экране. [Пошаговая инструкция](docs/LOCAL_BROWSER_GUIDE.md). Реальный headless Chrome/Playwright прошёл полный цикл и проверку сохранности после перезапуска. Production-данные не использовать.

В карточке акта доступна [матрица согласования](docs/APPROVAL_MATRIX.md): реальные статусы четырёх подразделений, версия/цикл, история, ФИО, сроки, замечания и автообновление.

Запуск, действующие API, результаты проверок и ограничения: [CORE_STATUS](docs/CORE_STATUS.md). Команды: `npm.cmd ci`, `npm.cmd run db:migrate`, `npm.cmd run dev:api`, `npm.cmd run dev:web`; перед запуском заполнить .env, привязать реальные учётные записи Keycloak и загрузить календарь по инструкции. Проверки: `npm.cmd run build`, `npm.cmd test`, `npm.cmd run test:integration`.

- [Постоянные инструкции](AGENTS.md)
- [Контекст и предлагаемая архитектура](docs/PROJECT_CONTEXT.md)
- [Исследование SUE_system](docs/SUE_SYSTEM_REVIEW.md)
- [Модель данных](docs/DATA_MODEL.md)
- [Проект API](docs/API_CONTRACTS.md)
- [Проверка архитектуры](docs/ARCHITECTURE_REVIEW.md)
- [План](docs/IMPLEMENTATION_PLAN.md)
- [Решения](docs/DECISIONS.md)
- [Прогресс](docs/PROGRESS.md)

Исходный репозиторий: https://github.com/ashinoff/TP_Approval. Никакие реальные документы и персональные данные в репозитории не хранить.
