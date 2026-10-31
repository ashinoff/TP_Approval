-- Keep the original role assignment, not a permanently copied substitute identity.
ALTER TABLE app.tasks ADD COLUMN assignment_id uuid REFERENCES app.roles;
CREATE FUNCTION app.assignment_for(wanted text,area uuid,assignee uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT r.id FROM app.roles r LEFT JOIN app.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 WHERE r.role=wanted AND (r.res_id IS NULL OR r.res_id=area) AND coalesce(s.substitute_id,r.user_id)=assignee LIMIT 1 $$;
CREATE FUNCTION app.task_user(assignment uuid,fallback uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT coalesce((SELECT coalesce(s.substitute_id,r.user_id) FROM app.roles r LEFT JOIN app.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at WHERE r.id=assignment),fallback) $$;
REVOKE ALL ON FUNCTION app.assignment_for(text,uuid,uuid),app.task_user(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assignment_for(text,uuid,uuid),app.task_user(uuid,uuid) TO tp_runtime;
DROP POLICY scope ON app.decisions;
CREATE POLICY scope ON app.decisions USING(EXISTS(SELECT 1 FROM app.tasks WHERE id=task_id)) WITH CHECK(actor_id=app.uid() AND EXISTS(SELECT 1 FROM app.tasks WHERE id=task_id AND app.task_user(assignment_id,assignee_id)=app.uid() AND status='OPEN'));
REVOKE UPDATE ON app.files FROM tp_runtime;
