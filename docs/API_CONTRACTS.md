# Проект API

## Реализованное дополнение DOCX — 01.11.2026
GET `/api/v1/error-categories`; POST `/api/v1/admin/error-categories` (TECH_ADMIN); GET `/api/v1/acts/{id}/versions/{versionId}/preview`; POST `/api/v1/acts/{id}/comments`; GET `/api/v1/acts/{id}/compare?from=uuid&to=uuid`. Действующая модель, точный payload anchor/комментария, ограничения и коды семантических ошибок — [DOCX_PROTOTYPE](DOCX_PROTOTYPE.md), Zod-схемы — apps/api/src/documents.ts. Все требуют Bearer JWT; POST также Idempotency-Key. Якорь не соответствует байтам/цитате: 409 ANCHOR_MISMATCH; нет своей открытой задачи: 403 ACTIVE_REVIEW_REQUIRED; чужой документ/версия: 404; обратный порядок сравнения: 422 VERSION_ORDER_REQUIRED. Печатающего API нет; UI-печать недоступна. Прежние `/comments/{id}/events` и командный маршрут продолжают работать; APPROVE собственной текущей версии с визуальными замечаниями возвращает 409 CURRENT_REMARKS_REQUIRE_RETURN.

Статус: целевые контракты. Архитектура утверждена; **часть методов реализована**, точный текущий список/отличия — в [CORE_STATUS](CORE_STATUS.md) и apps/api/src/app.ts. Не считать весь документ реализацией. OpenAPI, внешний lookup и service JWT ещё впереди. Базовый бизнес-префикс `/api/v1`; совместимый с платформой `/api/platform/badge` без версии. В текущем ядре expectedRevision используется для создания/подачи версии; решение защищено идентификатором неизменяемой задачи, блокировкой и Idempotency-Key, без If-Match.

## Общие правила

Реализован GET `/api/v1/acts/{id}/approval-matrix?cycleId={uuid}`: read-only модель из фактических таблиц, четыре строки, история циклов, длительности/замечания/общий итог. Проверяет права РЭС через RLS, чужие акт/цикл — 404. Полный формат и правила — [APPROVAL_MATRIX](APPROVAL_MATRIX.md).
HTTPS, Bearer JWT; локальная учётная запись активна и имеет внутренние права. Пользовательский JWT требует realm-роли `tp-approval-user`, фиксированного issuer/JWKS, допустимого alg, exp/nbf, audience и/или согласованной azp-политики. Роль Keycloak admin сама по себе прав не даёт. Проверку issuer/audience не отключать ради интеграции: при необходимости согласовать mapper в Keycloak отдельной задачей.

Сервисный JWT: отдельная audience TP_Approval external API, клиент зарегистрирован, scope `contracts:read`, ограничения РЭС и квоты. Не принимает пользовательский JWT вместо service token в lookup.

UUID в идентификаторах, ISO 8601 UTC во времени, YYYY-MM-DD в датах договора. Списки: cursor pagination, максимальный limit, разрешённая сортировка, фильтры строго валидируются. Номер договора — строка, сохраняющая нули и значимые символы. Чужие ID возвращают 404 без раскрытия наличия, недопустимое действие над доступным объектом — 403. Ошибки: `{error:{code,message,requestId,details?}}` без stack/секретов/ПДн.

Команды подать/решить/вернуть и другие повторяемые операции принимают Idempotency-Key; одинаковые principal/route/key и payload возвращают тот же результат, иной payload — 409. Параллельное выполнение защищается уникальным ключом и транзакцией. `If-Match`/expectedRevision обязательно для изменений, устаревшее состояние — 412, недопустимый переход — 409; 422 для ошибок данных, 413 размера, 415 типа, 429 квот. Сервер игнорирует/отклоняет actor_id/роль/РЭС из клиентских полей, когда они назначаются автоматически.

## Пользовательские ресурсы
| Метод и путь | Назначение и ограничения |
|---|---|
| GET /api/v1/me | Личность, внутренние роли/РЭС, доступные действия |
| GET /api/v1/acts | Реестр с фильтрами из контекста; только доступные акты |
| POST /api/v1/acts | Карточка РИРУ: contract number/date, actNumber, applicant, address; РЭС из области доступа |
| GET /api/v1/acts/{id} | Карточка, этап, четыре решения, сроки, ссылки на версии |
| PATCH /api/v1/acts/{id}/draft | Разрешённые реквизиты черновика с If-Match; не статус |
| POST /api/v1/acts/{id}/files | Multipart: kind=ACT_DOCX/TU, file; карантин, ответ 202 с fileId/jobId |
| GET /api/v1/files/{id}/status | Статус проверки только в области доступного акта |
| GET /api/v1/files/{id}/download | Повторная проверка прав, attachment/safe content type, без открытого bucket |
| POST /api/v1/acts/{id}/versions | Подготовить новую версию из READY файла, реквизитов, ТУ и точек; без автоматической подачи |
| POST /api/v1/acts/{id}/submit | versionId, expectedRevision; атомарный цикл и задача РЭС, 201 |
| GET /api/v1/acts/{id}/cycles | История циклов/задач/решений со снимками исполнителей |
| GET /api/v1/tasks/mine | Персональные активные approval/rework задачи, дедупликация актов отдельно |
| POST /api/v1/tasks/{id}/decision | decision=APPROVE/RETURN, versionId, expectedRevision; RETURN требует замечания |
| POST /api/v1/tasks/{id}/comments | categoryId, text, originalValue, suggestedValue, anchor; только своя активная задача |
| GET /api/v1/acts/{id}/comments | По версиям/статусу, авторство/категория/история |
| POST /api/v1/comments/{id}/events | REPORTED_FIXED/VERIFIED/REOPENED, targetVersionId, explanation; права по утверждённой политике |
| POST /api/v1/versions/{id}/editor-sessions | Подписанная конфигурация, только доступный mode и производная копия |
| POST /api/internal/office/callback/{sessionId} | Отдельный office JWT; не пользовательская авторизация; проверка ключа, сессии, URL и повторов |
| POST /api/v1/acts/{id}/comparisons | versionA/versionB своего акта, ответ 202, результат через job |
| GET /api/v1/notifications | Только персональные, read/unread, pagination |
| POST /api/v1/notifications/{id}/read | Идемпотентно установить read_at собственному уведомлению |
| POST /api/v1/releases/{id}/print-packages | Идемпотентная генерация по утверждённой версии, 202 |
| GET /api/v1/jobs/{id} | Статус доступного задания, без чужих input/output |
| GET /api/v1/contracts | Реестр договоров в области пользователя; не внешний lookup |
| GET /api/v1/analytics | Агрегаты в области доступа; чёткая метрика/период |
| POST /api/v1/reports | Excel, 202; ограничения диапазона и формул в строковых данных |
| POST /api/v1/versions/{id}/tu-checks | Запуск проверки снимка версии с выбранными ТУ, 202 |
| GET /api/v1/admin/* | Настройки/пользователи/назначения/категории/нормативы/календари; операции отдельными строгими схемами |

Административные изменения аудируются, не подменяют решения согласующих. DELETE истории/версии не предоставляется. Полный контракт админ-команд и editor bridge уточнить после соответствующих бизнес-решений.

## Badge
`GET /api/platform/badge`, `Authorization: Bearer <Keycloak JWT>` → 200 `{"count":7}`. Count — неотрицательное целое, персональное. Предложение: COUNT(DISTINCT act_id) доступных актов с активной задачей текущего пользователя, включая доработку; подтвердить смысл с пользователем. Не использовать общий счётчик. Отдельно notifications.unreadCount в UI.

Точный CORS origin платформы; OPTIONS разрешает GET и Authorization; Vary: Origin, Cache-Control: no-store. 401 при недействительном токене, 403 при отсутствии роли/внутреннего доступа. Не возвращать успешный ноль для ошибки авторизации. Сама оболочка при ошибке скрывает бейдж.

## Внешний lookup — предварительная схема
`GET /api/v1/contracts/lookup?number=...&date=YYYY-MM-DD&resCode=...`
Параметр number обязателен, date/resCode сужают неоднозначность. Точная нормализация и область уникальности договора подлежат согласованию. Только service JWT.

```json
{
  "schemaVersion": "1.0",
  "contract": {
    "id": "uuid", "number": "000123/ТП", "date": "2026-01-15",
    "res": {"code": "ADLER", "name": "Адлерский РЭС"}
  },
  "approvedActs": [{
    "actId": "uuid", "actNumber": "А-1", "releaseId": "uuid",
    "status": "APPROVED", "approvedAt": "2026-10-31T10:00:00Z",
    "documentVersion": 2,
    "applicant": "Синтетический заявитель", "address": "Тестовый адрес",
    "connectionPoints": [{
      "id": "uuid", "maximumPower": {"value": "15.000", "unit": "kW"},
      "voltage": {"value": "0.400", "unit": "kV"},
      "supplyCenter": "Тестовый ПЦ", "substation": "ТП-ТЕСТ",
      "feeder": null, "connectionPoint": "Тестовая точка", "poleNumber": "1"
    }]
  }]
}
```

Это иллюстрация формы, а не валидный пример UUID или реальный ответ. Значения отсутствующих технических полей — null, не выдуманное значение. Несколько актов одного однозначно найденного договора допустимы и представлены массивом. Для каждого акта выбирается действующая утверждённая публикация; политика переутверждения пока не определена и команды переутверждения не реализуются. Черновики, нерешённые циклы и неутверждённые данные не выдаются.

404 CONTRACT_NOT_FOUND — нет доступного утверждённого совпадения, без раскрытия черновиков/чужой области. 409 CONTRACT_AMBIGUOUS — несколько доступных договоров; запросить date/resCode, без массовой выдачи заявителей. 429 с Retry-After. Запрос и статус записать в integration_requests, содержимое ответа и JWT не логировать. Ограничить длину поиска, размер ответа, частоту и объём за период по client_id; выгрузка всех договоров этим методом не разрешена.

Будущие webhook: eventId, schemaVersion, releaseId, минимальный payload, HMAC/подпись, время, защита replay, retry/backoff/dead-letter. Доставку включать только после отдельного контракта и проверки URL от SSRF. Формат учёта ПУ ещё не исследован, окончательная схема не утверждена.
