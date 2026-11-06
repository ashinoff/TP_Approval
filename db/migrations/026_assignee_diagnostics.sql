-- Понятная причина отказа в назначении (06.11.2026): кто из сотрудников подходит на этап в РЭС документа —
-- имена кандидатов с учётом замещения и признак «роль без РЭС (на все РЭС)». Только имена, без контактов.
CREATE FUNCTION app.candidate_labels(wanted text, area uuid) RETURNS TABLE(id uuid,name text,all_res boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT DISTINCT effective.id,effective.name,r.res_id IS NULL FROM app.roles r JOIN app.users u ON u.id=r.user_id AND u.active
 LEFT JOIN app.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 JOIN app.users effective ON effective.id=coalesce(s.substitute_id,r.user_id) AND effective.active
 WHERE r.revoked_at IS NULL AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area) AND app.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app.candidate_labels(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.candidate_labels(text,uuid) TO tp_runtime;
