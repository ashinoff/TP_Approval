-- Manual confirmation of TU check findings by the RIRU engineer (user decision Р4, 03.11.2026).
-- Only MANUAL_REVIEW / UNKNOWN findings of a specific immutable report can be confirmed, with a comment.
-- A DIFFERENCE can never be confirmed. A new act version, other TU or new rules produce a new report,
-- so earlier confirmations do not carry over.
CREATE TABLE app.tu_check_confirmations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 check_id uuid NOT NULL REFERENCES app.tu_checks,
 act_id uuid NOT NULL REFERENCES app.acts,
 field text NOT NULL CHECK(length(field) BETWEEN 1 AND 50),
 comment text NOT NULL CHECK(length(btrim(comment)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL DEFAULT app.uid() REFERENCES app.users,
 actor_name text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(check_id,field)
);
ALTER TABLE app.tu_check_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tu_check_confirmations FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON app.tu_check_confirmations FOR SELECT USING(app.act_visible(act_id));
CREATE POLICY confirmation_insert ON app.tu_check_confirmations FOR INSERT
 WITH CHECK(actor_id=app.uid() AND app.has_role('RIRU_ENGINEER',(SELECT res_id FROM app.acts WHERE id=act_id)));
GRANT SELECT,INSERT ON app.tu_check_confirmations TO tp_runtime;
CREATE INDEX tu_check_confirmations_check ON app.tu_check_confirmations(check_id);

CREATE FUNCTION app.validate_tu_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE
 report app.tu_checks;
 finding_status text;
BEGIN
 SELECT * INTO report FROM app.tu_checks WHERE id=NEW.check_id;
 IF report.id IS NULL OR report.act_id<>NEW.act_id THEN RAISE EXCEPTION 'TU check does not belong to the act' USING ERRCODE='23514'; END IF;
 SELECT f->>'status' INTO finding_status FROM jsonb_array_elements(report.findings) f WHERE f->>'field'=NEW.field LIMIT 1;
 IF finding_status IS NULL OR finding_status NOT IN ('MANUAL_REVIEW','UNKNOWN') THEN
  RAISE EXCEPTION 'Only MANUAL_REVIEW or UNKNOWN findings can be confirmed' USING ERRCODE='23514';
 END IF;
 NEW.actor_id:=app.uid();
 NEW.actor_name:=coalesce(app.my_profile()->>'name','');
 NEW.created_at:=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.validate_tu_confirmation() FROM PUBLIC;
CREATE TRIGGER validate_tu_confirmation BEFORE INSERT ON app.tu_check_confirmations FOR EACH ROW EXECUTE FUNCTION app.validate_tu_confirmation();
CREATE TRIGGER immutable_tu_confirmation BEFORE UPDATE OR DELETE ON app.tu_check_confirmations FOR EACH ROW EXECUTE FUNCTION app.document_history_immutable();
