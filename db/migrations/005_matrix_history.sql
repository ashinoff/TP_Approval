-- Identity snapshots preserve history; statuses remain solely in tasks/decisions/cycles.
ALTER TABLE app.tasks ADD COLUMN assignment_snapshot jsonb;
ALTER TABLE app.tasks ADD COLUMN completion_snapshot jsonb;
UPDATE app.tasks t SET assignment_snapshot=jsonb_build_object(
  'assigned',jsonb_build_object('id',u.id,'name',u.name),
  'principal',jsonb_build_object('id',p.id,'name',p.name),
  'source','LEGACY_CURRENT_PROFILE')
FROM app.users u,app.users p
WHERE u.id=t.assignee_id AND p.id=coalesce((SELECT user_id FROM app.roles WHERE id=t.assignment_id),t.assignee_id);
UPDATE app.tasks t SET completion_snapshot=coalesce(
  (SELECT jsonb_build_object('id',d.actor_id,'name',d.actor_name,'source','DECISION') FROM app.decisions d WHERE d.task_id=t.id),
  (t.assignment_snapshot->'assigned') || jsonb_build_object('source','LEGACY_ASSIGNEE'))
WHERE t.status<>'OPEN';

CREATE FUNCTION app.capture_task_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE assigned jsonb; principal jsonb; finished jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status<>'OPEN' THEN
   IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Closed task history is immutable' USING ERRCODE='55000'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id THEN
   SELECT jsonb_build_object('id',id,'name',name) INTO assigned FROM app.users WHERE id=NEW.assignee_id;
   SELECT jsonb_build_object('id',id,'name',name) INTO principal FROM app.users WHERE id=coalesce((SELECT user_id FROM app.roles WHERE id=NEW.assignment_id),NEW.assignee_id);
   NEW.assignment_snapshot=jsonb_build_object('assigned',assigned,'principal',principal,'source','ASSIGNMENT');
 ELSE NEW.assignment_snapshot=OLD.assignment_snapshot;
 END IF;
 IF NEW.status<>'OPEN' THEN
   SELECT jsonb_build_object('id',actor_id,'name',actor_name,'source','DECISION') INTO finished FROM app.decisions WHERE task_id=NEW.id;
   IF finished IS NULL THEN SELECT jsonb_build_object('id',id,'name',name,'source','COMPLETION') INTO finished FROM app.users WHERE id=app.task_user(NEW.assignment_id,NEW.assignee_id); END IF;
   NEW.completion_snapshot=finished;
 ELSE NEW.completion_snapshot=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.capture_task_identity() FROM PUBLIC;
CREATE TRIGGER task_identity BEFORE INSERT OR UPDATE ON app.tasks FOR EACH ROW EXECUTE FUNCTION app.capture_task_identity();

CREATE FUNCTION app.matrix_task_identity(target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE t app.tasks; area uuid; effective jsonb;
BEGIN
 SELECT * INTO t FROM app.tasks WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT res_id INTO area FROM app.acts WHERE id=t.act_id;
 IF NOT coalesce(app.can_read(area),false) THEN RETURN NULL; END IF;
 IF t.status='OPEN' THEN
   SELECT jsonb_build_object('id',id,'name',name,'active',active,'source','CURRENT_ASSIGNMENT') INTO effective FROM app.users WHERE id=app.task_user(t.assignment_id,t.assignee_id);
 ELSE effective=t.completion_snapshot;
 END IF;
 RETURN jsonb_build_object('effective',effective,'assignment',t.assignment_snapshot,
   'substitution',coalesce(effective->>'id','')<>coalesce(t.assignment_snapshot->'principal'->>'id',''));
END $$;
REVOKE ALL ON FUNCTION app.matrix_task_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.matrix_task_identity(uuid) TO tp_runtime;
CREATE INDEX comments_task ON app.comments(task_id);
CREATE INDEX tasks_act_cycle ON app.tasks(act_id,cycle_id);
