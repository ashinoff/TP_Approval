-- Existing uploader role assignments become engineer assignments; their UUIDs and
-- substitutions remain intact. Historical tasks/decisions are never rewritten.
ALTER TABLE app.roles DROP CONSTRAINT roles_role_check;
ALTER TABLE app.roles DROP CONSTRAINT roles_check;
ALTER TABLE app.roles ADD CHECK(role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI','TECH_ADMIN','PROCESS_ADMIN'));
ALTER TABLE app.roles ADD CHECK((role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD') AND res_id IS NOT NULL) OR role IN ('PROCESS_ADMIN','TECH_ADMIN') OR (role IN ('SUE','STP','GI') AND res_id IS NULL));
UPDATE app.roles SET role='RIRU_ENGINEER' WHERE role='RIRU_HEAD';
INSERT INTO app.deadline_policies(role,working_days,preliminary) SELECT 'RIRU_ENGINEER',working_days,preliminary FROM app.deadline_policies WHERE role='RIRU_HEAD' ORDER BY created_at DESC,id DESC LIMIT 1;
INSERT INTO app.deadline_policies(role,working_days,preliminary) VALUES('RIRU_HEAD',1,true);
ALTER TABLE app.acts ADD COLUMN workflow_version integer NOT NULL DEFAULT 1 CHECK(workflow_version IN (1,2));
ALTER TABLE app.cycles ADD COLUMN workflow_version integer NOT NULL DEFAULT 1 CHECK(workflow_version IN (1,2));
ALTER TABLE app.acts ALTER COLUMN workflow_version SET DEFAULT 2;
ALTER TABLE app.cycles ALTER COLUMN workflow_version SET DEFAULT 2;
ALTER TABLE app.acts DROP CONSTRAINT acts_state_check;
ALTER TABLE app.acts ADD CHECK(state IN ('DRAFT','RIRU_REVIEW','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED','REVISING'));
ALTER TABLE app.cycles DROP CONSTRAINT cycles_state_check;
ALTER TABLE app.cycles ADD CHECK(state IN ('RIRU_REVIEW','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED'));
ALTER TABLE app.tasks DROP CONSTRAINT tasks_role_check;
ALTER TABLE app.tasks ADD CHECK(role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI'));
CREATE FUNCTION app.task_role(task_role text,cycle uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN task_role='RIRU_HEAD' AND EXISTS(SELECT 1 FROM app.cycles WHERE id=cycle AND workflow_version=1) THEN 'RIRU_ENGINEER' ELSE task_role END
$$;
REVOKE ALL ON FUNCTION app.task_role(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.task_role(text,uuid) TO tp_runtime;
CREATE OR REPLACE FUNCTION app.can_read(area uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app.has_role('RIRU_ENGINEER',area) OR app.has_role('RIRU_HEAD',area) OR app.has_role('RES_HEAD',area) OR app.has_role('SUE') OR app.has_role('STP') OR app.has_role('GI') OR app.has_role('PROCESS_ADMIN',area) $$;
CREATE OR REPLACE FUNCTION app.admin_substitute(target_role uuid,replacement uuid,start_time timestamptz,end_time timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE area uuid; result uuid; original uuid;
BEGIN
 SELECT res_id,user_id INTO area,original FROM app.roles WHERE id=target_role AND role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI') FOR UPDATE;
 IF NOT FOUND OR NOT app.has_role('PROCESS_ADMIN',area) THEN RAISE EXCEPTION 'PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF original=replacement OR end_time<=start_time OR EXISTS(SELECT 1 FROM app.substitutions WHERE role_id=target_role AND starts_at<end_time AND ends_at>start_time) THEN RAISE EXCEPTION 'Invalid/overlapping substitution' USING ERRCODE='22023'; END IF;
 INSERT INTO app.substitutions(role_id,substitute_id,starts_at,ends_at,created_by) VALUES(target_role,replacement,start_time,end_time,app.uid()) RETURNING id INTO result;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'SUBSTITUTION_CREATED',jsonb_build_object('substitutionId',result));
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION app.admin_policy(wanted text,days integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE result uuid;
BEGIN
 IF NOT app.has_role('PROCESS_ADMIN') THEN RAISE EXCEPTION 'Global PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF wanted NOT IN ('RES_HEAD','SUE','STP','GI','RIRU_HEAD','RIRU_ENGINEER') THEN RAISE EXCEPTION 'Invalid role'; END IF;
 INSERT INTO app.deadline_policies(role,working_days) VALUES(wanted,days) RETURNING id INTO result;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'POLICY_CREATED',jsonb_build_object('policyId',result));
 RETURN result;
END $$;
ALTER POLICY acts_insert ON app.acts WITH CHECK(app.has_role('RIRU_ENGINEER',res_id) AND author_id=app.uid());
ALTER POLICY contracts_insert ON app.contracts WITH CHECK(app.has_role('RIRU_ENGINEER',res_id));
ALTER POLICY tu_insert ON app.technical_conditions WITH CHECK(
 app.has_role('RIRU_ENGINEER',res_id) AND created_by=app.uid() AND EXISTS(
 SELECT 1 FROM app.acts a JOIN app.files f ON f.act_id=a.id WHERE a.id=source_act_id AND a.contract_id=technical_conditions.contract_id AND f.id=file_id AND f.kind='TU_DOCX' AND f.scan_status='READY'));
