-- Должность сотрудника (решение владельца 05.11.2026): показывается рядом с ФИО и в листе согласования.
ALTER TABLE app.users ADD COLUMN position text CHECK(position IS NULL OR length(position) BETWEEN 1 AND 200);

CREATE OR REPLACE FUNCTION app.my_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'position',u.position,'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('role',r.role,'resId',r.res_id)) FROM (
 SELECT role,res_id FROM app.roles WHERE user_id=u.id AND revoked_at IS NULL
 UNION SELECT r.role,r.res_id FROM app.substitutions s JOIN app.roles r ON r.id=s.role_id
 WHERE s.substitute_id=u.id AND r.revoked_at IS NULL AND now()>=s.starts_at AND now()<s.ends_at
 )r),'[]'::jsonb)) FROM app.users u WHERE u.id=app.uid() AND active
$$;

CREATE OR REPLACE FUNCTION app.local_admin_users() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'position',u.position,'login',c.login,
 'revision',u.account_revision,'active',u.active,'mustChangePassword',c.must_change,
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.role,'resId',r.res_id) ORDER BY r.role,r.res_id),'[]'::jsonb)
 FROM app.roles r WHERE r.user_id=u.id AND r.revoked_at IS NULL)) ORDER BY c.login),'[]'::jsonb)
 FROM app.local_credentials c JOIN app.users u ON u.id=c.user_id WHERE u.deleted_at IS NULL);
END $$;

CREATE FUNCTION app.local_admin_position(target uuid,value text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 UPDATE app.users SET position=nullif(btrim(value),'') WHERE id=target AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'LOCAL_USER_POSITION',jsonb_build_object('userId',target));
END $$;
REVOKE ALL ON FUNCTION app.local_admin_position(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.local_admin_position(uuid,text) TO tp_runtime;

-- Подпись участника документа теперь включает должность (лист согласования, карточка).
CREATE OR REPLACE FUNCTION app.act_user_label(target_act uuid,target_user uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'position',u.position,'source','CURRENT_PROFILE')
 FROM app.users u WHERE u.id=target_user AND EXISTS(SELECT 1 FROM app.acts a WHERE a.id=target_act AND app.can_read(a.res_id)) $$;
