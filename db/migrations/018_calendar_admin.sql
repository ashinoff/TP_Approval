-- Календарь может править администратор системы (TECH_ADMIN) или глобальный PROCESS_ADMIN:
-- организация сама назначает дополнительные выходные/рабочие дни (решение владельца 04.11.2026).
-- Уже созданные задачи не пересчитываются: срок фиксируется снимком календаря при назначении.
CREATE OR REPLACE FUNCTION app.admin_calendar(entries jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT (app.has_role('PROCESS_ADMIN') OR app.has_role('TECH_ADMIN')) THEN RAISE EXCEPTION 'PROCESS_ADMIN or TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 INSERT INTO app.calendar_days(day,working,source,revision) SELECT day,working,source,1 FROM jsonb_to_recordset(entries) AS e(day date,working boolean,source text)
 ON CONFLICT(day) DO UPDATE SET working=excluded.working,source=excluded.source,revision=app.calendar_days.revision+1;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'CALENDAR_UPDATED',jsonb_build_object('count',jsonb_array_length(entries),'days',(SELECT jsonb_agg(e->>'day') FROM jsonb_array_elements(entries) e),'source',entries->0->>'source'));
END $$;
