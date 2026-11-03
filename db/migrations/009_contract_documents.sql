-- Contract grouping is scoped by RES and date. Business numbers remain strings.
CREATE FUNCTION app.contract_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT regexp_replace(translate(trim(value), chr(160)||'–—‑', ' '||'---'), '[[:space:]]+', '', 'g')
$$;
CREATE TABLE app.contracts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), res_id uuid NOT NULL REFERENCES app.res_units,
 number text NOT NULL, number_key text NOT NULL, contract_date date NOT NULL,
 UNIQUE(res_id,number_key,contract_date), UNIQUE(id,res_id)
);
ALTER TABLE app.acts ADD COLUMN contract_id uuid;
ALTER TABLE app.acts ADD COLUMN act_type text NOT NULL DEFAULT 'ACT_TP' CHECK(act_type IN ('ACT_TP','AVTU'));
INSERT INTO app.contracts(res_id,number,number_key,contract_date)
 SELECT res_id,min(contract_number),app.contract_key(contract_number),contract_date FROM app.acts GROUP BY res_id,app.contract_key(contract_number),contract_date;
UPDATE app.acts a SET contract_id=c.id FROM app.contracts c WHERE c.res_id=a.res_id AND c.number_key=app.contract_key(a.contract_number) AND c.contract_date=a.contract_date;
ALTER TABLE app.acts ALTER COLUMN contract_id SET NOT NULL;
ALTER TABLE app.acts ADD FOREIGN KEY(contract_id,res_id) REFERENCES app.contracts(id,res_id);
ALTER TABLE app.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY contracts_read ON app.contracts FOR SELECT USING(app.can_read(res_id));
CREATE POLICY contracts_insert ON app.contracts FOR INSERT WITH CHECK(app.has_role('RIRU_HEAD',res_id));
GRANT SELECT,INSERT ON app.contracts TO tp_runtime;
GRANT EXECUTE ON FUNCTION app.contract_key(text) TO tp_runtime;
CREATE FUNCTION app.bind_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.contract_id,NEW.res_id,NEW.contract_number,NEW.contract_date) IS DISTINCT FROM (OLD.contract_id,OLD.res_id,OLD.contract_number,OLD.contract_date) THEN RAISE EXCEPTION 'Contract identity is immutable'; END IF;
  IF NEW.act_type<>OLD.act_type AND EXISTS(SELECT 1 FROM app.versions WHERE act_id=OLD.id) THEN RAISE EXCEPTION 'Document type is immutable after version creation'; END IF;
  RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.res_id::text||app.contract_key(NEW.contract_number),0));
 SELECT id INTO NEW.contract_id FROM app.contracts WHERE res_id=NEW.res_id AND number_key=app.contract_key(NEW.contract_number) AND contract_date=NEW.contract_date;
 IF NEW.contract_id IS NULL THEN
  INSERT INTO app.contracts(res_id,number,number_key,contract_date) VALUES(NEW.res_id,NEW.contract_number,app.contract_key(NEW.contract_number),NEW.contract_date) RETURNING id INTO NEW.contract_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bind_contract BEFORE INSERT OR UPDATE ON app.acts FOR EACH ROW EXECUTE FUNCTION app.bind_contract();
ALTER TABLE app.files DROP CONSTRAINT files_kind_check;
ALTER TABLE app.files ADD CHECK(kind IN ('ACT_DOCX','AVTU_DOCX','TU_DOCX','TU_PDF'));
CREATE TABLE app.technical_conditions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL, res_id uuid NOT NULL,
 source_act_id uuid NOT NULL REFERENCES app.acts, file_id uuid NOT NULL,
 number integer NOT NULL CHECK(number>0), document_number text, document_date date,
 created_by uuid NOT NULL REFERENCES app.users, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(contract_id,res_id) REFERENCES app.contracts(id,res_id), FOREIGN KEY(file_id,source_act_id) REFERENCES app.files(id,act_id),
 UNIQUE(contract_id,number)
);
ALTER TABLE app.technical_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.technical_conditions FORCE ROW LEVEL SECURITY;
CREATE POLICY tu_read ON app.technical_conditions FOR SELECT USING(app.can_read(res_id));
CREATE POLICY tu_insert ON app.technical_conditions FOR INSERT WITH CHECK(
 app.has_role('RIRU_HEAD',res_id) AND created_by=app.uid() AND EXISTS(
 SELECT 1 FROM app.acts a JOIN app.files f ON f.act_id=a.id WHERE a.id=source_act_id AND a.contract_id=technical_conditions.contract_id AND f.id=file_id AND f.kind='TU_DOCX' AND f.scan_status='READY'));
GRANT SELECT,INSERT ON app.technical_conditions TO tp_runtime;
ALTER TABLE app.acts ADD COLUMN technical_conditions_id uuid REFERENCES app.technical_conditions;
ALTER TABLE app.cycles ADD COLUMN technical_conditions_id uuid REFERENCES app.technical_conditions;
CREATE FUNCTION app.check_tu_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract uuid; selected uuid;
BEGIN
 IF TG_TABLE_NAME='cycles' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW.technical_conditions_id IS DISTINCT FROM OLD.technical_conditions_id THEN RAISE EXCEPTION 'Cycle TU reference is immutable'; END IF;
   RETURN NEW;
  END IF;
  SELECT contract_id,technical_conditions_id INTO contract,selected FROM app.acts WHERE id=NEW.act_id;
  NEW.technical_conditions_id:=selected;
 ELSE
  contract:=NEW.contract_id;
  IF TG_OP='UPDATE' AND NEW.technical_conditions_id IS DISTINCT FROM OLD.technical_conditions_id AND OLD.state NOT IN ('DRAFT','RETURNED','REVISING') THEN RAISE EXCEPTION 'Submitted TU reference is immutable'; END IF;
 END IF;
 IF NEW.technical_conditions_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.technical_conditions WHERE id=NEW.technical_conditions_id AND contract_id=contract) THEN RAISE EXCEPTION 'TU belongs to another contract'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_tu_reference BEFORE INSERT OR UPDATE ON app.acts FOR EACH ROW EXECUTE FUNCTION app.check_tu_reference();
CREATE TRIGGER freeze_cycle_tu BEFORE INSERT OR UPDATE ON app.cycles FOR EACH ROW EXECUTE FUNCTION app.check_tu_reference();
REVOKE ALL ON FUNCTION app.bind_contract(),app.check_tu_reference() FROM PUBLIC;
CREATE FUNCTION app.check_act_document_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.acts a JOIN app.files f ON f.act_id=a.id WHERE a.id=NEW.act_id AND f.id=NEW.file_id AND f.scan_status='READY' AND f.kind=CASE a.act_type WHEN 'AVTU' THEN 'AVTU_DOCX' ELSE 'ACT_DOCX' END) THEN RAISE EXCEPTION 'Act version requires matching document type'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_act_document_kind BEFORE INSERT ON app.versions FOR EACH ROW EXECUTE FUNCTION app.check_act_document_kind();
REVOKE ALL ON FUNCTION app.check_act_document_kind() FROM PUBLIC;
