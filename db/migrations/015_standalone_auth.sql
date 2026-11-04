-- Separate credentials and opaque sessions. Runtime cannot read these tables.
-- Existing users, assignments, acts and signed-off history are not rewritten.
CREATE TABLE app.local_credentials (
 user_id uuid PRIMARY KEY REFERENCES app.users,
 login text UNIQUE NOT NULL CHECK(login ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
 password_hash text NOT NULL CHECK(password_hash ~ '^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$'),
 must_change boolean NOT NULL DEFAULT true,
 failed_attempts integer NOT NULL DEFAULT 0,
 locked_until timestamptz,
 password_version integer NOT NULL DEFAULT 1
);
CREATE TABLE app.local_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES app.local_credentials,
 password_version integer NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours'
);
CREATE INDEX local_sessions_user ON app.local_sessions(user_id);
CREATE INDEX local_sessions_expiry ON app.local_sessions(expires_at);
REVOKE ALL ON app.local_credentials,app.local_sessions FROM PUBLIC,tp_runtime;

CREATE FUNCTION app.local_login_candidate(wanted text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT c.password_hash FROM app.local_credentials c JOIN app.users u ON u.id=c.user_id
 WHERE c.login=wanted AND u.active AND (c.locked_until IS NULL OR c.locked_until<=now())
$$;
CREATE FUNCTION app.local_login_failure(wanted text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 UPDATE app.local_credentials SET
 failed_attempts=CASE WHEN locked_until<=now() THEN 1 ELSE failed_attempts+1 END,
 locked_until=CASE WHEN locked_until<=now() THEN NULL WHEN failed_attempts>=4 THEN now()+interval '15 minutes' ELSE locked_until END
 WHERE login=wanted AND (locked_until IS NULL OR locked_until<=now());
END $$;
CREATE FUNCTION app.local_open_session(wanted text, expected_hash text, session_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE c app.local_credentials;
BEGIN
 SELECT * INTO c FROM app.local_credentials WHERE login=wanted FOR UPDATE;
 IF NOT FOUND OR c.password_hash<>expected_hash OR c.locked_until>now()
 OR NOT EXISTS(SELECT 1 FROM app.users WHERE id=c.user_id AND active) THEN RETURN false; END IF;
 UPDATE app.local_credentials SET failed_attempts=0,locked_until=NULL WHERE user_id=c.user_id;
 DELETE FROM app.local_sessions WHERE expires_at<=now();
 INSERT INTO app.local_sessions(token_hash,user_id,password_version) VALUES(session_hash,c.user_id,c.password_version);
 INSERT INTO app.audit_events(actor_id,action) VALUES(c.user_id,'LOCAL_LOGIN');
 RETURN true;
END $$;
CREATE FUNCTION app.local_session(session_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('userId',s.user_id,'mustChangePassword',c.must_change)
 FROM app.local_sessions s JOIN app.local_credentials c ON c.user_id=s.user_id
 JOIN app.users u ON u.id=s.user_id
 WHERE s.token_hash=session_hash AND s.expires_at>now() AND u.active AND s.password_version=c.password_version
$$;
CREATE FUNCTION app.local_close_session(session_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 DELETE FROM app.local_sessions WHERE token_hash=session_hash
$$;
CREATE FUNCTION app.local_own_password() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT password_hash FROM app.local_credentials WHERE user_id=app.uid()
$$;
CREATE FUNCTION app.local_change_password(expected_hash text, new_hash text, session_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE v integer;
BEGIN
 UPDATE app.local_credentials SET password_hash=new_hash,must_change=false,password_version=password_version+1,failed_attempts=0,locked_until=NULL
 WHERE user_id=app.uid() AND password_hash=expected_hash RETURNING password_version INTO v;
 IF NOT FOUND THEN RETURN false; END IF;
 DELETE FROM app.local_sessions WHERE user_id=app.uid();
 INSERT INTO app.local_sessions(token_hash,user_id,password_version) VALUES(session_hash,app.uid(),v);
 INSERT INTO app.audit_events(actor_id,action) VALUES(app.uid(),'LOCAL_PASSWORD_CHANGED');
 RETURN true;
END $$;

CREATE FUNCTION app.local_admin_users() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'login',c.login,'active',u.active,'mustChangePassword',c.must_change,
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.role,'resId',r.res_id)),'[]'::jsonb) FROM app.roles r WHERE r.user_id=u.id)) ORDER BY c.login),'[]'::jsonb)
 FROM app.local_credentials c JOIN app.users u ON u.id=c.user_id);
END $$;
CREATE FUNCTION app.local_admin_create(wanted text, display_name text, new_hash text, wanted_role text, area uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE target uuid;
BEGIN
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 target=app.admin_user('urn:tp-approval:local',gen_random_uuid()::text,display_name,wanted_role,area);
 INSERT INTO app.local_credentials(user_id,login,password_hash) VALUES(target,wanted,new_hash);
 RETURN target;
END $$;
CREATE FUNCTION app.local_admin_access(target uuid, enabled boolean, new_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 -- Serialise account disabling, including two administrators disabling each other.
 PERFORM pg_advisory_xact_lock(817624);
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 IF target=app.uid() THEN RAISE EXCEPTION 'Use own password change' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM app.local_credentials WHERE user_id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown local account' USING ERRCODE='22023'; END IF;
 IF enabled IS NOT NULL THEN UPDATE app.users SET active=enabled WHERE id=target; END IF;
 IF new_hash IS NOT NULL THEN
  UPDATE app.local_credentials SET password_hash=new_hash,must_change=true,password_version=password_version+1,failed_attempts=0,locked_until=NULL WHERE user_id=target;
 END IF;
 DELETE FROM app.local_sessions WHERE user_id=target;
 INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'LOCAL_ACCOUNT_UPDATED',jsonb_build_object('userId',target,'active',enabled,'passwordReset',new_hash IS NOT NULL));
END $$;
CREATE FUNCTION app.local_admin_role(target uuid, wanted_role text, area uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE u app.users;
BEGIN
 IF NOT app.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM app.users WHERE id=target AND EXISTS(SELECT 1 FROM app.local_credentials WHERE user_id=target);
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown local account' USING ERRCODE='22023'; END IF;
 RETURN app.admin_user(u.issuer,u.subject,u.name,wanted_role,area);
END $$;

REVOKE ALL ON FUNCTION app.local_login_candidate(text),app.local_login_failure(text),app.local_open_session(text,text,text),app.local_session(text),app.local_close_session(text),app.local_own_password(),app.local_change_password(text,text,text),app.local_admin_users(),app.local_admin_create(text,text,text,text,uuid),app.local_admin_access(uuid,boolean,text),app.local_admin_role(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.local_login_candidate(text),app.local_login_failure(text),app.local_open_session(text,text,text),app.local_session(text),app.local_close_session(text),app.local_own_password(),app.local_change_password(text,text,text),app.local_admin_users(),app.local_admin_create(text,text,text,text,uuid),app.local_admin_access(uuid,boolean,text),app.local_admin_role(uuid,text,uuid) TO tp_runtime;
