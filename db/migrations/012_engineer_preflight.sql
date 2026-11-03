ALTER TABLE app.acts ADD COLUMN tu_check_required boolean NOT NULL DEFAULT true;
CREATE TABLE app.tu_checks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES app.acts,
 version_id uuid NOT NULL, technical_conditions_id uuid NOT NULL REFERENCES app.technical_conditions,
 act_hash text NOT NULL, tu_hash text NOT NULL, rules_version text NOT NULL,
 status text NOT NULL CHECK(status IN ('PASS','BLOCKED')), findings jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES app.users, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(version_id,act_id) REFERENCES app.versions(id,act_id)
);
ALTER TABLE app.tu_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tu_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON app.tu_checks FOR SELECT USING(app.act_visible(act_id));
CREATE POLICY check_insert ON app.tu_checks FOR INSERT WITH CHECK(app.has_role('RIRU_ENGINEER',(SELECT res_id FROM app.acts WHERE id=act_id)) AND created_by=app.uid());
GRANT SELECT,INSERT ON app.tu_checks TO tp_runtime;
CREATE INDEX tu_checks_source ON app.tu_checks(act_id,version_id,technical_conditions_id,created_at DESC);
CREATE FUNCTION app.guard_tu_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tu_check_required IS DISTINCT FROM OLD.tu_check_required AND session_user='tp_runtime' THEN RAISE EXCEPTION 'TU validation requirement cannot be changed by runtime' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_tu_requirement() FROM PUBLIC;
CREATE TRIGGER guard_tu_requirement BEFORE UPDATE ON app.acts FOR EACH ROW EXECUTE FUNCTION app.guard_tu_requirement();
-- Show already-authorized temporary roles in navigation, without granting new rights.
CREATE OR REPLACE FUNCTION app.my_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('role',r.role,'resId',r.res_id)) FROM (
 SELECT role,res_id FROM app.roles WHERE user_id=u.id
 UNION SELECT r.role,r.res_id FROM app.substitutions s JOIN app.roles r ON r.id=s.role_id WHERE s.substitute_id=u.id AND now()>=s.starts_at AND now()<s.ends_at
 )r),'[]'::jsonb)) FROM app.users u WHERE u.id=app.uid() AND active
$$;
