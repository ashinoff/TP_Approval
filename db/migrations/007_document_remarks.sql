CREATE TABLE app.error_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 200), active boolean NOT NULL DEFAULT true);
INSERT INTO app.error_categories(name) VALUES ('Орфографическая'),('Пунктуационная'),('Техническая'),('Несоответствие техническим условиям'),('Ошибка в мощности'),('Ошибка в точке присоединения'),('Ошибка в наименовании питающего центра'),('Ошибка в номере опоры'),('Ошибка в реквизитах заявителя'),('Ошибка в адресе'),('Ошибка оформления'),('Другое');
ALTER TABLE app.error_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.error_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY categories_read ON app.error_categories FOR SELECT USING(app.uid() IS NOT NULL);
CREATE POLICY categories_write ON app.error_categories FOR ALL USING(app.has_role('TECH_ADMIN')) WITH CHECK(app.has_role('TECH_ADMIN'));
GRANT SELECT,INSERT,UPDATE ON app.error_categories TO tp_runtime;

ALTER TABLE app.comments ADD COLUMN category_id uuid REFERENCES app.error_categories;
ALTER TABLE app.comments ADD COLUMN category_name text;
ALTER TABLE app.comments ADD COLUMN anchor jsonb;
ALTER TABLE app.comments ADD COLUMN original_value text;
ALTER TABLE app.comments ADD COLUMN suggested_value text;
ALTER TABLE app.comments ADD COLUMN discussion text NOT NULL DEFAULT '';
ALTER TABLE app.comments ADD COLUMN author_snapshot jsonb;
CREATE FUNCTION app.capture_comment_author() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 SELECT jsonb_build_object('id',u.id,'name',u.name,'role',t.role,'cycleId',t.cycle_id) INTO NEW.author_snapshot
 FROM app.users u JOIN app.tasks t ON t.id=NEW.task_id WHERE u.id=NEW.author_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.capture_comment_author() FROM PUBLIC;
CREATE TRIGGER comment_author BEFORE INSERT ON app.comments FOR EACH ROW EXECUTE FUNCTION app.capture_comment_author();
-- Comments and correction events are append-only: original DOCX and historical anchors never change.
CREATE FUNCTION app.document_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Document remarks are immutable' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION app.document_history_immutable() FROM PUBLIC;
CREATE TRIGGER immutable_comment BEFORE UPDATE OR DELETE ON app.comments FOR EACH ROW EXECUTE FUNCTION app.document_history_immutable();
CREATE TRIGGER immutable_comment_event BEFORE UPDATE OR DELETE ON app.comment_events FOR EACH ROW EXECUTE FUNCTION app.document_history_immutable();
CREATE INDEX comments_version ON app.comments(version_id,created_at);
