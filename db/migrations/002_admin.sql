CREATE FUNCTION app.admin_user(iss text,sub text,display_name text,wanted text,area uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE target uuid;
BEGIN
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 INSERT INTO app.users(issuer,subject,name) VALUES(iss,sub,display_name) ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name RETURNING id INTO target;
 INSERT INTO app.roles(user_id,role,res_id) VALUES(target,wanted,area) ON CONFLICT DO NOTHING;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'USER_ROLE_ASSIGNED',jsonb_build_object('userId',target,'role',wanted,'resId',area));
 RETURN target;
END $$;
CREATE FUNCTION app.admin_substitute(target_role uuid,replacement uuid,start_time timestamptz,end_time timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE area uuid; result uuid; original uuid;
BEGIN
 SELECT res_id,user_id INTO area,original FROM app.roles WHERE id=target_role AND role IN ('RIRU_HEAD','RES_HEAD','SUE','STP','GI') FOR UPDATE;
 IF NOT FOUND OR NOT app.has_role('PROCESS_ADMIN',area) THEN RAISE EXCEPTION 'PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF original=replacement OR end_time<=start_time OR EXISTS(SELECT 1 FROM app.substitutions WHERE role_id=target_role AND starts_at<end_time AND ends_at>start_time) THEN RAISE EXCEPTION 'Invalid/overlapping substitution' USING ERRCODE='22023'; END IF;
 INSERT INTO app.substitutions(role_id,substitute_id,starts_at,ends_at,created_by) VALUES(target_role,replacement,start_time,end_time,app.uid()) RETURNING id INTO result;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'SUBSTITUTION_CREATED',jsonb_build_object('substitutionId',result));
 RETURN result;
END $$;
CREATE FUNCTION app.admin_calendar(entries jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT app.has_role('PROCESS_ADMIN') THEN RAISE EXCEPTION 'Global PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 INSERT INTO app.calendar_days(day,working,source,revision) SELECT day,working,source,1 FROM jsonb_to_recordset(entries) AS e(day date,working boolean,source text)
 ON CONFLICT(day) DO UPDATE SET working=excluded.working,source=excluded.source,revision=app.calendar_days.revision+1;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'CALENDAR_UPDATED',jsonb_build_object('count',jsonb_array_length(entries)));
END $$;
CREATE FUNCTION app.admin_policy(wanted text,days integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE result uuid;
BEGIN
 IF NOT app.has_role('PROCESS_ADMIN') THEN RAISE EXCEPTION 'Global PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF wanted NOT IN ('RES_HEAD','SUE','STP','GI','RIRU_HEAD') THEN RAISE EXCEPTION 'Invalid role'; END IF;
 INSERT INTO app.deadline_policies(role,working_days) VALUES(wanted,days) RETURNING id INTO result;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'POLICY_CREATED',jsonb_build_object('policyId',result));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.admin_user(text,text,text,text,uuid),app.admin_substitute(uuid,uuid,timestamptz,timestamptz),app.admin_calendar(jsonb),app.admin_policy(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_user(text,text,text,text,uuid),app.admin_substitute(uuid,uuid,timestamptz,timestamptz),app.admin_calendar(jsonb),app.admin_policy(text,integer) TO tp_runtime;

-- Identities/role administration is exposed only through checked functions, not raw tables.
CREATE FUNCTION app.admin_directory() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT CASE WHEN app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN') THEN
 (SELECT jsonb_agg(jsonb_build_object('id',r.id,'userId',u.id,'name',u.name,'role',r.role,'resId',r.res_id)) FROM app.roles r JOIN app.users u ON u.id=r.user_id) ELSE '[]'::jsonb END $$;
REVOKE ALL ON FUNCTION app.admin_directory() FROM PUBLIC; GRANT EXECUTE ON FUNCTION app.admin_directory() TO tp_runtime;
