# Предлагаемая модель PostgreSQL

## Реализовано для DOCX-прототипа — 01.11.2026
Миграции 007_document_remarks.sql и 008_category_admin.sql: error_categories (12 начальных категорий, active, RLS), поля comments category_id/category_name (неизменяемый снимок), anchor jsonb, original_value, suggested_value, discussion, author_snapshot (id/name/role/cycleId). Остались прежние FK act/version/task; cycle и подразделение определяет task. Комментарии и comment_events append-only через triggers. Удаление/изменение исходного замечания не разрешается. Категории меняет только проверенная функция app.admin_error_category, запись в словарь для runtime напрямую отозвана. Технический администратор не получает прав на акты. Файлы/версии не пересохраняются, производных DOCX пока нет. См. DOCX_PROTOTYPE.md.

Реализована миграция 005_matrix_history.sql: tasks.assignment_snapshot/completion_snapshot, trigger фиксации личности и запрета изменений закрытых задач, scoped helper matrix_task_identity. Статусы матрицы вычисляются при чтении из tasks/decisions/cycles/releases; дополнительной таблицы согласований нет. Подробности legacy-истории и API — APPROVAL_MATRIX.md.

Статус: целевая логическая модель. Архитектура утверждена, миграции минимального ядра находятся в db/migrations (001–004); не все таблицы этого документа реализованы. Фактические отличия: роли в app.roles, версии в app.versions, publications в app.releases, календарь в app.calendar_days со снимком в задаче; отдельного contracts и нормализованных connection points пока нет, договорные поля и technicalData находятся в акте/снимке версии. TECH_ADMIN и PROCESS_ADMIN заменяют прежний ADMIN. UUID для ID, timestamptz для событий. Расширение технических numeric-полей/единиц — этап 5.

| Таблица | Основные поля и назначение |
|---|---|
| res_units | id, code unique, name, active; семь РЭС |
| departments | id, code unique (RIRU/RES/SUE/STP/GI), name |
| users | id, name, email, active; внутренняя учётная запись |
| auth_identities | user_id, issuer, subject; unique(issuer,subject) |
| role_assignments | user_id, role, res_id/department_id, valid_from/to; проверки области роли |
| substitutions | исходный/замещающий пользователь, область, период, основание; только после утверждения правил |
| contracts | id, res_id, number_original, number_normalized, contract_date; номер не глобальный unique без подтверждения |
| acts | id, res_id, contract_id, act_number, author_id, responsible_id, current_version_id, active_cycle_id, lock_version, created_at, updated_at |
| file_objects | id, storage_key unique, sha256, size, media_type, purpose, scan_status, created_by; READY только после проверок |
| document_drafts | id, act_id, base_version_id, revision, file_id, created_by; редактируемая рабочая область с историей сохранений |
| act_versions | id, act_id, version_number, source_file_id, metadata_snapshot, created_by, created_at, sealed_at; unique(act_id,version_number) |
| technical_conditions | id, act_id, version_number, file_id, created_by; неизменяемые версии ТУ |
| version_conditions | act_version_id, condition_id; снимок используемых ТУ |
| version_connection_points | id, act_version_id, ordinal, applicant/address, power_value/unit, voltage, supply_center, substation, feeder, pole, connection_point, extra; 1:N |
| approval_cycles | id, act_id, version_id, cycle_number, state, started_at, closed_at; unique(act_id,cycle_number), unique(version_id) для поданных версий |
| approval_tasks | id, cycle_id, stage, department_id, assignee_id, status, received_at, due_at, completed_at, policy_version_id, calendar_version_id, lock_version |
| task_assignment_events | task_id, прежний/новый assignee, основание, actor_id, occurred_at; история замещений |
| approval_decisions | id, task_id unique, cycle_id, version_id, actor_id, actor_snapshot, decision, decided_at; неизменяемые |
| error_categories | id, code unique, name, active; деактивация вместо удаления |
| comments | id, act_id, version_id, cycle_id, task_id, author_id/snapshot, category_id/snapshot, text, original_value, suggested_value, status, created_at |
| document_anchors | id, comment_id, version_id, source_hash, kind, locator jsonb, quote, prefix, suffix, render_id; якорь всегда версии |
| comment_events | id, comment_id, actor_id, event_type, target_version_id, payload, occurred_at; история исправлений/проверок |
| editor_sessions | id, task_id/draft_id, user_id, document_key unique, source_version_id, derived_file_id, status, expires_at |
| editor_artifacts | session_id, callback_key, file_id, created_at; производные копии и дедупликация callback |
| approved_releases | id, act_id, version_id, cycle_id unique, approved_at, structured_snapshot, superseded_by nullable; только из успешного цикла |
| print_packages | id, release_id, template_version, renderer_version, status, created_at, manifest jsonb; файлы через package_files |
| package_files | package_id, file_id, kind (act/approval_sheet/corrections/merged_pdf) |
| calendar_versions | id, timezone, year, source, approved_by/at, status; неизменяемый опубликованный календарь |
| calendar_days | calendar_version_id, date, working_intervals jsonb, kind; unique(version,date) |
| deadline_policy_versions | id, stage, department_id, duration, unit, warning_threshold, escalation_policy, effective_from, approved_by; версия норматива |
| deadline_events | task_id, type, due_at_snapshot, recipient_id, occurred_at; дедупликация warning/overdue/escalation |
| rework_tasks | id, act_id, returned_cycle_id unique, assignee_id, received_at, due_at, completed_at; задачи РИРУ отдельно от решений |
| notifications | id, event_id, recipient_id, act_id, type, safe_payload, created_at, read_at; unique(event_id,recipient_id,type) |
| outbox_events | id, aggregate_id, event_type, payload, created_at, delivered_at, attempt_count; транзакционная доставка |
| background_jobs | id, kind, input_ref, state, attempts, lease_until, next_attempt_at, result_ref; повторяемые задания |
| extraction_runs | id, file_id, extractor/version, status, created_at; отдельно результаты каждого запуска |
| extracted_fields | run_id, field_name, value/unit, confidence, source_anchor; не заменяют утверждённые снимки |
| comparison_runs/results | act_version_id, condition_id, engine_version, field, result, act_anchor_id, condition_anchor_id, explanation |
| service_clients | id, issuer, subject/client_id, active, scopes, allowed_res; секреты в Keycloak, не в таблице |
| integration_requests | id, client_id, request_id, endpoint, result_code, occurred_at, duration; без полных ответов/токенов |
| audit_events | id, actor_id/service_id, action, entity_type/id, occurred_at, request_id, safe_metadata; INSERT-only для runtime |
| idempotency_keys | principal_id, route, key, request_hash, response_ref, expires_at; unique(principal,route,key) |

## Связи и инварианты
- РЭС 1:N договоры; договор 1:N акты; акт 1:N версии/циклы; версия 1:N точки присоединения. Возможная связь точка 1:N приборы учитывается внешними ссылками в будущем; сами приборы принадлежат учёту ПУ.
- Составные FK/unique гарантируют, что version_id/cycle_id/task_id/contract_id относятся к тому же акту и РЭС. Одной проверки UUID существования недостаточно.
- Partial unique на approval_cycles(act_id) WHERE closed_at IS NULL. У цикла одна задача РЭС и ровно три центральные задачи: unique(cycle_id,stage,department_id), CHECK допустимых подразделений, транзакционный сервис создаёт комплект целиком.
- approval_decisions(task_id) unique; решение ссылается на ту же версию/цикл, что задача. Запрет UPDATE/DELETE для опубликованных версий, решений и событий runtime-ролью; изменения через разрешённые команды, без универсального PATCH состояния.
- current_version_id указывает версию своего акта; active_cycle_id — цикл своего акта. Поданный файл, снимок технических реквизитов и набор ТУ не меняются после sealed_at. Новое исправление — новая версия.
- Release создаётся только при APPROVE РЭС и трёх APPROVE центральных подразделений в том же цикле/версии. JSON-снимок проверяется версионированной схемой; массив точек имеет устойчивые ID.
- Индексы: acts(res_id,updated_at,id), contracts(number_normalized,contract_date,res_id), tasks(assignee_id,status,due_at), notifications(recipient_id,read_at,created_at), comments(version_id,status), outbox(next retry), audit(entity_type,entity_id,occurred_at). Реальный набор уточнить EXPLAIN.

## RLS и границы доступа
Включить ENABLE/FORCE ROW LEVEL SECURITY для защищённых таблиц. API runtime — отдельная роль без superuser/BYPASSRLS и не владелец; migration owner используется только вне runtime. SET LOCAL app.user_id задаётся из проверенной сервером личности внутри каждой транзакции; отсутствие контекста означает отказ. Роли/РЭС читаются из БД, клиент их не задаёт. После транзакции контекст не сохраняется в пуле.

Для файлов/версий/комментариев/пакетов — политика через доступный акт, для notifications — собственный recipient_id плюс актуальная видимость акта; для задач — видимость документа не даёт права решения. UPDATE/INSERT имеют WITH CHECK, не только USING. Пользователь не может изменить res_id/author_id/role_assignment прямым payload. Аналитика и SQL views работают с теми же ограничениями, без неосознанного SECURITY DEFINER/bypass. Service runtime отделён и видит только опубликованные представления/команды с ограничением allowed_res; прямое чтение черновиков запрещено. Фоновые worker-права минимальны, назначение job и доступ к файлу валидируются повторно.

RLS защищает от ошибок запросов, но не делает скомпрометированный backend доверенным и не заменяет защиту от SQL-инъекций. Параметризованные запросы, ограниченные гранты и тесты обязательны.
