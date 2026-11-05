-- Сервисное меню администратора (решение владельца 05.11.2026): удаление документов насовсем (целиком или по частям),
-- состояние и проверки базы, очистка мусора, резервные копии «база + файлы» и восстановление (только TECH_ADMIN).
-- Runtime не получает прав на таблицы: всё — через SECURITY DEFINER функции с проверкой роли и записью в журнал.
-- Технический администратор по-прежнему не читает содержимое документов: список — только реквизиты.

CREATE FUNCTION app.require_tech_admin() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
END $$;

-- Реквизиты документов для сервисного меню (без содержимого файлов и замечаний).
CREATE FUNCTION app.admin_documents(search text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 PERFORM app.require_tech_admin();
 RETURN coalesce((SELECT jsonb_agg(row ORDER BY (row->>'created_at') DESC) FROM (
  SELECT jsonb_build_object('id',a.id,'act_number',a.act_number,'contract_number',a.contract_number,'contract_date',a.contract_date,
   'act_type',a.act_type,'state',a.state,'created_at',a.created_at,'res',r.name,'author',u.name,
   'versions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'number',v.number,'created_at',v.created_at,
     'in_cycle',EXISTS(SELECT 1 FROM app.cycles c WHERE c.version_id=v.id)) ORDER BY v.number),'[]') FROM app.versions v WHERE v.act_id=a.id),
   'cycles',(SELECT count(*) FROM app.cycles c WHERE c.act_id=a.id),
   'technical_conditions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'number',t.number,'source_act_id',t.source_act_id,
     'in_cycle',EXISTS(SELECT 1 FROM app.cycles c WHERE c.technical_conditions_id=t.id)) ORDER BY t.number),'[]') FROM app.technical_conditions t WHERE t.source_act_id=a.id)) AS row
  FROM app.acts a JOIN app.res_units r ON r.id=a.res_id JOIN app.users u ON u.id=a.author_id
  WHERE search IS NULL OR search='' OR a.contract_number ILIKE '%'||search||'%' OR a.act_number ILIKE '%'||search||'%'
  ORDER BY a.created_at DESC LIMIT 200) s),'[]'::jsonb);
END $$;

-- Удаление документа целиком: версии, циклы, задачи, решения, замечания, сверки, уведомления, журнал документа и
-- загруженные им редакции ТУ. Договор удаляется, если в нём не осталось документов. Возвращает файлы для удаления с диска.
CREATE FUNCTION app.admin_purge_act(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE a app.acts; tus uuid[]; files uuid[]; used text; t record;
BEGIN
 PERFORM app.require_tech_admin();
 SELECT * INTO a FROM app.acts WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(array_agg(id),'{}') INTO tus FROM app.technical_conditions WHERE source_act_id=target;
 SELECT string_agg(DISTINCT o.act_number,', ') INTO used FROM app.cycles c JOIN app.acts o ON o.id=c.act_id WHERE c.technical_conditions_id=ANY(tus) AND c.act_id<>target;
 IF used IS NOT NULL THEN RAISE EXCEPTION 'TU of this document is used by: %',used USING ERRCODE='55006'; END IF;
 SELECT coalesce(array_agg(id),'{}') INTO files FROM app.files WHERE act_id=target;
 -- Журнал и замечания неизменяемы для обычной работы; удаление насовсем — только здесь, без триггеров.
 SET LOCAL session_replication_role=replica;
 UPDATE app.acts SET technical_conditions_id=NULL WHERE technical_conditions_id=ANY(tus) AND id<>target;
 DELETE FROM app.tu_check_confirmations WHERE check_id IN (SELECT id FROM app.tu_checks WHERE act_id=target OR technical_conditions_id=ANY(tus));
 DELETE FROM app.tu_checks WHERE act_id=target OR technical_conditions_id=ANY(tus);
 DELETE FROM app.decisions WHERE task_id IN (SELECT id FROM app.tasks WHERE act_id=target);
 DELETE FROM app.technical_conditions WHERE id=ANY(tus);
 -- Всё остальное, что ссылается на документ по act_id (включая будущие таблицы), кроме самого документа.
 FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables x ON x.table_schema=c.table_schema AND x.table_name=c.table_name
  WHERE c.table_schema='app' AND c.column_name='act_id' AND x.table_type='BASE TABLE' AND c.table_name<>'acts' LOOP
  EXECUTE format('DELETE FROM app.%I WHERE act_id=$1',t.table_name) USING target;
 END LOOP;
 DELETE FROM app.acts WHERE id=target;
 IF NOT EXISTS(SELECT 1 FROM app.acts WHERE contract_id=a.contract_id) THEN DELETE FROM app.contracts WHERE id=a.contract_id; END IF;
 SET LOCAL session_replication_role=origin;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'ADMIN_PURGE_DOCUMENT',jsonb_build_object('actId',a.id,'actNumber',a.act_number,'contractNumber',a.contract_number,'actType',a.act_type,'files',cardinality(files),'technicalConditions',cardinality(tus)));
 RETURN jsonb_build_object('files',to_jsonb(files));
END $$;

-- Удаление одной редакции ТУ: нельзя, если по ней уже шёл цикл согласования (сначала удалите документ).
CREATE FUNCTION app.admin_purge_tu(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE t app.technical_conditions; contract text;
BEGIN
 PERFORM app.require_tech_admin();
 SELECT * INTO t FROM app.technical_conditions WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'TU not found' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM app.cycles WHERE technical_conditions_id=target) THEN RAISE EXCEPTION 'TU is used by an approval cycle' USING ERRCODE='55006'; END IF;
 SELECT number INTO contract FROM app.contracts WHERE id=t.contract_id;
 SET LOCAL session_replication_role=replica;
 UPDATE app.acts SET technical_conditions_id=NULL WHERE technical_conditions_id=target;
 DELETE FROM app.tu_check_confirmations WHERE check_id IN (SELECT id FROM app.tu_checks WHERE technical_conditions_id=target);
 DELETE FROM app.tu_checks WHERE technical_conditions_id=target;
 DELETE FROM app.technical_conditions WHERE id=target;
 DELETE FROM app.files WHERE id=t.file_id;
 SET LOCAL session_replication_role=origin;
 INSERT INTO app.audit_events(actor_id,act_id,action,details) VALUES(app.uid(),t.source_act_id,'ADMIN_PURGE_TU',jsonb_build_object('technicalConditionsId',t.id,'number',t.number,'contractNumber',contract));
 RETURN jsonb_build_object('files',jsonb_build_array(t.file_id));
END $$;

-- Удаление версии акта, ещё не отправленной на согласование (отправленная — часть истории цикла).
CREATE FUNCTION app.admin_purge_version(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE v app.versions;
BEGIN
 PERFORM app.require_tech_admin();
 SELECT * INTO v FROM app.versions WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Version not found' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM app.cycles WHERE version_id=target) OR EXISTS(SELECT 1 FROM app.releases WHERE version_id=target) THEN
  RAISE EXCEPTION 'Version was submitted for approval' USING ERRCODE='55006'; END IF;
 SET LOCAL session_replication_role=replica;
 DELETE FROM app.tu_check_confirmations WHERE check_id IN (SELECT id FROM app.tu_checks WHERE version_id=target);
 DELETE FROM app.tu_checks WHERE version_id=target;
 DELETE FROM app.versions WHERE id=target;
 DELETE FROM app.files f WHERE f.id=v.file_id AND NOT EXISTS(SELECT 1 FROM app.versions x WHERE x.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM app.technical_conditions x WHERE x.file_id=f.id);
 UPDATE app.acts SET revision=revision+1 WHERE id=v.act_id;
 SET LOCAL session_replication_role=origin;
 INSERT INTO app.audit_events(actor_id,act_id,action,details) VALUES(app.uid(),v.act_id,'ADMIN_PURGE_VERSION',jsonb_build_object('versionId',v.id,'number',v.number));
 RETURN jsonb_build_object('files',CASE WHEN EXISTS(SELECT 1 FROM app.files WHERE id=v.file_id) THEN '[]'::jsonb ELSE jsonb_build_array(v.file_id) END);
END $$;

-- Состояние базы: размер, количество записей, миграции и найденные несоответствия.
CREATE FUNCTION app.admin_health() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,public AS $$
DECLARE issues jsonb:='[]'; item jsonb;
BEGIN
 PERFORM app.require_tech_admin();
 FOR item IN SELECT jsonb_build_object('code',code,'level',level,'label',label,'count',cnt,'items',items) FROM (
  SELECT 'unlinked_files' code,'warn' level,'Файлы, не привязанные ни к версии, ни к ТУ (старше суток)' label,count(*) cnt,
   coalesce(jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'created_at',f.created_at,'act',a.contract_number)) FILTER (WHERE true),'[]') items
   FROM app.files f JOIN app.acts a ON a.id=f.act_id WHERE f.created_at<now()-interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM app.versions v WHERE v.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM app.technical_conditions t WHERE t.file_id=f.id)
  UNION ALL
  SELECT 'quarantined_files','warn','Файлы, не прошедшие проверку антивирусом (старше часа)',count(*),coalesce(jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'created_at',f.created_at)),'[]')
   FROM app.files f WHERE f.scan_status<>'READY' AND f.created_at<now()-interval '1 hour'
  UNION ALL
  SELECT 'open_tasks_closed_cycle','error','Открытые задачи в закрытых циклах',count(*),coalesce(jsonb_agg(jsonb_build_object('id',t.id,'role',t.role,'act',a.contract_number)),'[]')
   FROM app.tasks t JOIN app.cycles c ON c.id=t.cycle_id JOIN app.acts a ON a.id=t.act_id WHERE t.status='OPEN' AND c.closed_at IS NOT NULL
  UNION ALL
  SELECT 'stuck_cycles','error','Активные циклы без открытых задач',count(*),coalesce(jsonb_agg(jsonb_build_object('id',c.id,'number',c.number,'act',a.contract_number,'state',c.state)),'[]')
   FROM app.cycles c JOIN app.acts a ON a.id=c.act_id WHERE c.closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM app.tasks t WHERE t.cycle_id=c.id AND t.status='OPEN')
  UNION ALL
  SELECT 'empty_contracts','info','Договоры без документов',count(*),coalesce(jsonb_agg(jsonb_build_object('id',k.id,'number',k.number)),'[]')
   FROM app.contracts k WHERE NOT EXISTS(SELECT 1 FROM app.acts a WHERE a.contract_id=k.id)
  UNION ALL
  SELECT 'acts_without_versions','info','Документы без загруженной версии (старше суток)',count(*),coalesce(jsonb_agg(jsonb_build_object('id',a.id,'act',a.contract_number,'state',a.state)),'[]')
   FROM app.acts a WHERE a.created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM app.versions v WHERE v.act_id=a.id)
  UNION ALL
  SELECT 'expired_sessions','info','Истёкшие сеансы входа',count(*),'[]'::jsonb FROM app.local_sessions s WHERE s.expires_at<now()
 ) q LOOP issues:=issues||jsonb_build_array(item); END LOOP;
 RETURN jsonb_build_object(
  'database',current_database(),'dbBytes',pg_database_size(current_database()),'postgres',current_setting('server_version'),
  'migrations',(SELECT jsonb_agg(name ORDER BY name) FROM public.schema_migrations),
  'counts',jsonb_build_object('documents',(SELECT count(*) FROM app.acts),'contracts',(SELECT count(*) FROM app.contracts),'versions',(SELECT count(*) FROM app.versions),
   'technicalConditions',(SELECT count(*) FROM app.technical_conditions),'files',(SELECT count(*) FROM app.files),'cycles',(SELECT count(*) FROM app.cycles),
   'openTasks',(SELECT count(*) FROM app.tasks WHERE status='OPEN'),'remarks',(SELECT count(*) FROM app.comments),'users',(SELECT count(*) FROM app.users),
   'auditEvents',(SELECT count(*) FROM app.audit_events)),
  'fileBytes',(SELECT coalesce(sum(size),0) FROM app.files),
  'issues',issues);
END $$;

-- Все файлы базы: для сверки с диском (файлы без записи и записи без файла).
CREATE FUNCTION app.admin_file_index() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 PERFORM app.require_tech_admin();
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'size',size,'status',scan_status,'created_at',created_at)) FROM app.files),'[]');
END $$;

-- Очистка: непривязанные файлы старше суток, истёкшие сеансы. Записи файлов, которых нет на диске, — по списку от сервера.
CREATE FUNCTION app.admin_cleanup(missing uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE removed uuid[]; sessions integer; lost uuid[];
BEGIN
 PERFORM app.require_tech_admin();
 SELECT coalesce(array_agg(f.id),'{}') INTO removed FROM app.files f WHERE f.created_at<now()-interval '1 day'
  AND NOT EXISTS(SELECT 1 FROM app.versions v WHERE v.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM app.technical_conditions t WHERE t.file_id=f.id);
 -- Пропавшие с диска файлы удаляются из базы только если на них ничего не ссылается (иначе — это повреждение для разбора).
 SELECT coalesce(array_agg(f.id),'{}') INTO lost FROM app.files f WHERE f.id=ANY(missing)
  AND NOT EXISTS(SELECT 1 FROM app.versions v WHERE v.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM app.technical_conditions t WHERE t.file_id=f.id);
 DELETE FROM app.files WHERE id=ANY(removed) OR id=ANY(lost);
 DELETE FROM app.local_sessions WHERE expires_at<now();GET DIAGNOSTICS sessions=ROW_COUNT;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'ADMIN_CLEANUP',jsonb_build_object('files',cardinality(removed)+cardinality(lost),'sessions',sessions));
 RETURN jsonb_build_object('files',to_jsonb(removed||lost),'sessions',sessions);
END $$;

-- Резервная копия всех таблиц приложения одним снимком (сеансы входа и ключи повторных запросов не сохраняются).
CREATE FUNCTION app.admin_backup() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,public AS $$
DECLARE result jsonb:='{}'; t record; rows jsonb;
BEGIN
 PERFORM app.require_tech_admin();
 FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE' AND table_name NOT IN ('local_sessions','idempotency') ORDER BY table_name LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM app.%I x',t.table_name) INTO rows;
  result:=result||jsonb_build_object(t.table_name,rows);
 END LOOP;
 RETURN jsonb_build_object('migrations',(SELECT jsonb_agg(name ORDER BY name) FROM public.schema_migrations),'tables',result);
END $$;

-- Восстановление: только та же версия схемы (тот же набор миграций). Все текущие данные заменяются копией одной транзакцией;
-- сеансы входа сбрасываются — все пользователи входят заново.
CREATE FUNCTION app.admin_restore(data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,public AS $$
DECLARE t record; actor uuid:=app.uid(); counts jsonb:='{}'; n integer;
BEGIN
 PERFORM app.require_tech_admin();
 IF data->'migrations' IS DISTINCT FROM (SELECT jsonb_agg(name ORDER BY name) FROM public.schema_migrations) THEN
  RAISE EXCEPTION 'Backup schema version differs from the current one' USING ERRCODE='55006'; END IF;
 SET LOCAL session_replication_role=replica;
 FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE' LOOP
  EXECUTE format('DELETE FROM app.%I',t.table_name);
 END LOOP;
 FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE' AND data->'tables' ? table_name LOOP
  EXECUTE format('INSERT INTO app.%I SELECT * FROM jsonb_populate_recordset(NULL::app.%I,$1)',t.table_name,t.table_name) USING data->'tables'->t.table_name;
  GET DIAGNOSTICS n=ROW_COUNT;counts:=counts||jsonb_build_object(t.table_name,n);
 END LOOP;
 SET LOCAL session_replication_role=origin;
 IF EXISTS(SELECT 1 FROM app.users WHERE id=actor) THEN
  INSERT INTO app.audit_events(actor_id,action,details) VALUES(actor,'ADMIN_RESTORE',jsonb_build_object('counts',counts));
 END IF;
 RETURN counts;
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['app.require_tech_admin()','app.admin_documents(text)','app.admin_purge_act(uuid)','app.admin_purge_tu(uuid)','app.admin_purge_version(uuid)',
  'app.admin_health()','app.admin_file_index()','app.admin_cleanup(uuid[])','app.admin_backup()','app.admin_restore(jsonb)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO tp_runtime',f);
 END LOOP;
END $$;
