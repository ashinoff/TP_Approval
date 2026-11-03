-- Unknown contract dates are facts not yet available, never today's creation date.
ALTER TABLE app.acts ALTER COLUMN contract_date DROP NOT NULL;
ALTER TABLE app.contracts ALTER COLUMN contract_date DROP NOT NULL;
CREATE UNIQUE INDEX contracts_unknown_date_unique ON app.contracts(res_id,number_key) WHERE contract_date IS NULL;
CREATE OR REPLACE FUNCTION app.bind_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.contract_id,NEW.res_id,NEW.contract_number,NEW.contract_date) IS DISTINCT FROM (OLD.contract_id,OLD.res_id,OLD.contract_number,OLD.contract_date) THEN RAISE EXCEPTION 'Contract identity is immutable'; END IF;
  IF NEW.act_type<>OLD.act_type AND EXISTS(SELECT 1 FROM app.versions WHERE act_id=OLD.id) THEN RAISE EXCEPTION 'Document type is immutable after version creation'; END IF;
  RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.res_id::text||app.contract_key(NEW.contract_number),0));
 SELECT id INTO NEW.contract_id FROM app.contracts WHERE res_id=NEW.res_id AND number_key=app.contract_key(NEW.contract_number) AND contract_date IS NOT DISTINCT FROM NEW.contract_date;
 IF NEW.contract_id IS NULL THEN
  INSERT INTO app.contracts(res_id,number,number_key,contract_date) VALUES(NEW.res_id,NEW.contract_number,app.contract_key(NEW.contract_number),NEW.contract_date) RETURNING id INTO NEW.contract_id;
 END IF;
 RETURN NEW;
END $$;
