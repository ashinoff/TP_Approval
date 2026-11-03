CREATE FUNCTION app.freeze_cycle_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workflow_version IS DISTINCT FROM OLD.workflow_version THEN RAISE EXCEPTION 'Cycle route version is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.freeze_cycle_route() FROM PUBLIC;
CREATE TRIGGER freeze_cycle_route BEFORE UPDATE ON app.cycles FOR EACH ROW EXECUTE FUNCTION app.freeze_cycle_route();
