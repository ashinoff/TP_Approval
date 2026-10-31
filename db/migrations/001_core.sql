CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
CREATE TABLE app.res_units(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, name text NOT NULL);
INSERT INTO app.res_units(code,name) VALUES ('KRASNAYA_POLYANA','Краснополянский РЭС'),('ADLER','Адлерский РЭС'),('HOSTA','Хостинский РЭС'),('SOCHI','Сочинский РЭС'),('DAGOMYS','Дагомысский РЭС'),('LAZAREVSKOE','Лазаревский РЭС'),('TUAPSE','Туапсинский РЭС');
CREATE TABLE app.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(issuer,subject));
CREATE TABLE app.roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.users, role text NOT NULL CHECK(role IN ('RIRU_HEAD','RES_HEAD','SUE','STP','GI','TECH_ADMIN','PROCESS_ADMIN')), res_id uuid REFERENCES app.res_units,
 CHECK((role IN ('RIRU_HEAD','RES_HEAD') AND res_id IS NOT NULL) OR role IN ('PROCESS_ADMIN','TECH_ADMIN') OR (role IN ('SUE','STP','GI') AND res_id IS NULL)),
 UNIQUE NULLS NOT DISTINCT(user_id,role,res_id));
CREATE TABLE app.substitutions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid NOT NULL REFERENCES app.roles, substitute_id uuid NOT NULL REFERENCES app.users, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES app.users, CHECK(ends_at>starts_at));
CREATE FUNCTION app.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE FUNCTION app.has_role(wanted text, area uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT EXISTS(SELECT 1 FROM app.roles r JOIN app.users u ON u.id=r.user_id WHERE r.user_id=app.uid() AND u.active AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area))
 OR EXISTS(SELECT 1 FROM app.substitutions s JOIN app.roles r ON r.id=s.role_id JOIN app.users u ON u.id=s.substitute_id WHERE s.substitute_id=app.uid() AND u.active AND now()>=s.starts_at AND now()<s.ends_at AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area)) $$;
CREATE FUNCTION app.can_read(area uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app.has_role('RIRU_HEAD',area) OR app.has_role('RES_HEAD',area) OR app.has_role('SUE') OR app.has_role('STP') OR app.has_role('GI') OR app.has_role('PROCESS_ADMIN',area) $$;
CREATE FUNCTION app.resolve_identity(iss text, sub text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$ SELECT id FROM app.users WHERE issuer=iss AND subject=sub AND active $$;
CREATE FUNCTION app.candidates(wanted text, area uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT DISTINCT coalesce(s.substitute_id,r.user_id) FROM app.roles r JOIN app.users u ON u.id=r.user_id AND u.active
 LEFT JOIN app.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 JOIN app.users effective ON effective.id=coalesce(s.substitute_id,r.user_id) AND effective.active
 WHERE r.role=wanted AND (r.res_id IS NULL OR r.res_id=area) $$;
CREATE TABLE app.calendar_days(day date PRIMARY KEY, working boolean NOT NULL, source text NOT NULL, revision integer NOT NULL CHECK(revision>0));
CREATE TABLE app.deadline_policies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text NOT NULL, working_days integer NOT NULL CHECK(working_days BETWEEN 1 AND 90), preliminary boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO app.deadline_policies(role,working_days) VALUES ('RES_HEAD',1),('SUE',2),('STP',2),('GI',2),('RIRU_HEAD',2);
CREATE TABLE app.acts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), res_id uuid NOT NULL REFERENCES app.res_units, author_id uuid NOT NULL REFERENCES app.users, contract_number text NOT NULL, contract_date date NOT NULL, act_number text NOT NULL, applicant text NOT NULL, address text NOT NULL,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED','REVISING')), revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.files(id uuid PRIMARY KEY, act_id uuid NOT NULL REFERENCES app.acts, sha256 text NOT NULL, size integer NOT NULL CHECK(size>0), kind text NOT NULL CHECK(kind IN ('ACT_DOCX','TU_DOCX','TU_PDF')), scan_status text NOT NULL CHECK(scan_status IN ('QUARANTINED','READY')), created_by uuid NOT NULL REFERENCES app.users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,act_id));
CREATE TABLE app.versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts, number integer NOT NULL CHECK(number>0), file_id uuid NOT NULL, snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES app.users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(act_id,number), UNIQUE(id,act_id), FOREIGN KEY(file_id,act_id) REFERENCES app.files(id,act_id));
CREATE TABLE app.cycles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts, version_id uuid UNIQUE NOT NULL, number integer NOT NULL, state text NOT NULL CHECK(state IN ('RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED')), started_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, UNIQUE(act_id,number), UNIQUE(id,act_id), FOREIGN KEY(version_id,act_id) REFERENCES app.versions(id,act_id));
CREATE UNIQUE INDEX one_active_cycle ON app.cycles(act_id) WHERE closed_at IS NULL;
CREATE TABLE app.tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts, cycle_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('RES_HEAD','SUE','STP','GI','RIRU_HEAD')), assignee_id uuid NOT NULL REFERENCES app.users, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DONE','CANCELLED')), policy_id uuid NOT NULL REFERENCES app.deadline_policies, calendar_snapshot jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL, completed_at timestamptz, UNIQUE(cycle_id,role), FOREIGN KEY(cycle_id,act_id) REFERENCES app.cycles(id,act_id));
CREATE TABLE app.decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid UNIQUE NOT NULL REFERENCES app.tasks, actor_id uuid NOT NULL REFERENCES app.users, actor_name text NOT NULL, decision text NOT NULL CHECK(decision IN ('APPROVE','RETURN')), reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts, version_id uuid NOT NULL, task_id uuid NOT NULL REFERENCES app.tasks, author_id uuid NOT NULL REFERENCES app.users, text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(version_id,act_id) REFERENCES app.versions(id,act_id));
CREATE TABLE app.comment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), comment_id uuid NOT NULL REFERENCES app.comments, act_id uuid NOT NULL REFERENCES app.acts, actor_id uuid NOT NULL REFERENCES app.users, version_id uuid NOT NULL, type text NOT NULL CHECK(type IN ('REPORTED_FIXED','VERIFIED','REOPENED')), explanation text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(version_id,act_id) REFERENCES app.versions(id,act_id));
CREATE TABLE app.releases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts, version_id uuid NOT NULL, cycle_id uuid UNIQUE NOT NULL REFERENCES app.cycles, status text NOT NULL CHECK(status IN ('CURRENT','UNDER_REVISION','SUPERSEDED','REVOKED')), published_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(version_id,act_id) REFERENCES app.versions(id,act_id));
CREATE UNIQUE INDEX one_publication ON app.releases(act_id) WHERE status IN ('CURRENT','UNDER_REVISION');
CREATE TABLE app.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts, recipient_id uuid NOT NULL REFERENCES app.users, type text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES app.users, act_id uuid REFERENCES app.acts, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts, type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.idempotency(user_id uuid NOT NULL REFERENCES app.users, key text NOT NULL, path text NOT NULL, hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(user_id,path,key));

CREATE FUNCTION app.act_visible(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM app.acts WHERE id=target) $$;
ALTER TABLE app.acts ENABLE ROW LEVEL SECURITY; ALTER TABLE app.acts FORCE ROW LEVEL SECURITY;
CREATE POLICY acts_read ON app.acts FOR SELECT USING(app.can_read(res_id));
CREATE POLICY acts_insert ON app.acts FOR INSERT WITH CHECK(app.has_role('RIRU_HEAD',res_id) AND author_id=app.uid());
CREATE POLICY acts_update ON app.acts FOR UPDATE USING(app.can_read(res_id)) WITH CHECK(app.can_read(res_id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['files','versions','cycles','tasks','comments','comment_events','releases','audit_events','outbox'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY scope ON app.%I USING(app.act_visible(act_id)) WITH CHECK(app.act_visible(act_id))',t);
 END LOOP;
END $$;
ALTER TABLE app.decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON app.decisions USING(EXISTS(SELECT 1 FROM app.tasks WHERE id=task_id)) WITH CHECK(actor_id=app.uid() AND EXISTS(SELECT 1 FROM app.tasks WHERE id=task_id AND assignee_id=app.uid() AND status='OPEN'));
ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY; ALTER TABLE app.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_read ON app.notifications FOR SELECT USING(recipient_id=app.uid() AND app.act_visible(act_id));
CREATE POLICY notification_insert ON app.notifications FOR INSERT WITH CHECK(app.act_visible(act_id));
CREATE POLICY notification_update ON app.notifications FOR UPDATE USING(recipient_id=app.uid() AND app.act_visible(act_id)) WITH CHECK(recipient_id=app.uid());
ALTER TABLE app.idempotency ENABLE ROW LEVEL SECURITY; ALTER TABLE app.idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY own ON app.idempotency USING(user_id=app.uid()) WITH CHECK(user_id=app.uid());
CREATE INDEX tasks_user_open ON app.tasks(assignee_id,status,due_at);
CREATE INDEX acts_area ON app.acts(res_id,created_at);
CREATE INDEX notifications_user ON app.notifications(recipient_id,created_at);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO tp_runtime;
GRANT EXECUTE ON FUNCTION app.uid(), app.has_role(text,uuid), app.can_read(uuid), app.resolve_identity(text,text), app.candidates(text,uuid), app.act_visible(uuid) TO tp_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO tp_runtime;
REVOKE SELECT ON app.users,app.roles,app.substitutions FROM tp_runtime;
GRANT INSERT ON app.acts,app.files,app.versions,app.cycles,app.tasks,app.decisions,app.comments,app.comment_events,app.releases,app.notifications,app.audit_events,app.outbox,app.idempotency TO tp_runtime;
GRANT UPDATE ON app.acts,app.cycles,app.tasks,app.releases,app.notifications,app.files TO tp_runtime;

CREATE FUNCTION app.my_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('role',role,'resId',res_id)) FROM app.roles WHERE user_id=u.id),'[]'::jsonb)) FROM app.users u WHERE u.id=app.uid() AND active $$;
REVOKE ALL ON FUNCTION app.my_profile() FROM PUBLIC; GRANT EXECUTE ON FUNCTION app.my_profile() TO tp_runtime;
