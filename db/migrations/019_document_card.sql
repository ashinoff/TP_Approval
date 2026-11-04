-- Расширяемая карточка документа (решение владельца 04.11.2026).
-- Справочник полей ведёт администратор без миграций; значения — по документу (договору ТП),
-- в момент отправки на согласование фиксируются снимком в цикле. Базовые реквизиты (договор, дата,
-- заявитель, адрес) остаются колонками app.acts.
CREATE TABLE app.card_fields(
 code text PRIMARY KEY CHECK(code ~ '^[a-z][a-z0-9_]{1,40}$'),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('text','number','date','select')),
 unit text CHECK(unit IS NULL OR length(unit)<=20),
 options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(options)='array'),
 required boolean NOT NULL DEFAULT false,
 tu_source text CHECK(tu_source IN ('power_kw','voltage_kv','phases')),
 sort integer NOT NULL DEFAULT 100,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind<>'select' OR jsonb_array_length(options)>0));
CREATE TABLE app.card_values(
 act_id uuid NOT NULL REFERENCES app.acts,
 field_code text NOT NULL REFERENCES app.card_fields,
 value text NOT NULL CHECK(length(value) BETWEEN 1 AND 2000),
 origin text NOT NULL CHECK(origin IN ('TU','MANUAL')),
 updated_by uuid NOT NULL REFERENCES app.users,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(act_id,field_code));
ALTER TABLE app.cycles ADD COLUMN card_snapshot jsonb;

-- Поля «Учёта ПУ» для техприсоединения: из ТУ читаются мощность, напряжение, фазность; дату исполнения инженер вводит вручную.
INSERT INTO app.card_fields(code,label,kind,unit,options,required,tu_source,sort) VALUES
 ('power_kw','Максимальная мощность','number','кВт','[]',true,'power_kw',10),
 ('voltage_kv','Уровень напряжения','select','кВ','["0.23","0.4","6","10","35","110"]',true,'voltage_kv',20),
 ('phases','Фазность','select',NULL,'["1ф","3ф","3фтт"]',true,'phases',30),
 ('plan_date','Планируемая дата исполнения','date',NULL,'[]',true,NULL,40);

ALTER TABLE app.card_fields ENABLE ROW LEVEL SECURITY; ALTER TABLE app.card_fields FORCE ROW LEVEL SECURITY;
CREATE POLICY card_fields_read ON app.card_fields FOR SELECT USING(app.uid() IS NOT NULL);
CREATE POLICY card_fields_insert ON app.card_fields FOR INSERT WITH CHECK(app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN'));
CREATE POLICY card_fields_update ON app.card_fields FOR UPDATE USING(app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN')) WITH CHECK(app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN'));
GRANT SELECT,INSERT,UPDATE ON app.card_fields TO tp_runtime;

ALTER TABLE app.card_values ENABLE ROW LEVEL SECURITY; ALTER TABLE app.card_values FORCE ROW LEVEL SECURITY;
CREATE POLICY card_values_read ON app.card_values FOR SELECT USING(app.act_visible(act_id));
CREATE POLICY card_values_insert ON app.card_values FOR INSERT WITH CHECK(updated_by=app.uid() AND EXISTS(SELECT 1 FROM app.acts a WHERE a.id=act_id AND a.state IN ('DRAFT','RETURNED','REVISING') AND app.has_role('RIRU_ENGINEER',a.res_id)));
CREATE POLICY card_values_update ON app.card_values FOR UPDATE USING(EXISTS(SELECT 1 FROM app.acts a WHERE a.id=act_id AND a.state IN ('DRAFT','RETURNED','REVISING') AND app.has_role('RIRU_ENGINEER',a.res_id)))
 WITH CHECK(updated_by=app.uid() AND EXISTS(SELECT 1 FROM app.acts a WHERE a.id=act_id AND a.state IN ('DRAFT','RETURNED','REVISING') AND app.has_role('RIRU_ENGINEER',a.res_id)));
CREATE POLICY card_values_delete ON app.card_values FOR DELETE USING(EXISTS(SELECT 1 FROM app.acts a WHERE a.id=act_id AND a.state IN ('DRAFT','RETURNED','REVISING') AND app.has_role('RIRU_ENGINEER',a.res_id)));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.card_values TO tp_runtime;

-- Снимок карточки пишется только при создании цикла; runtime не может переписать его задним числом.
CREATE FUNCTION app.guard_card_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.card_snapshot IS DISTINCT FROM OLD.card_snapshot AND session_user='tp_runtime' THEN RAISE EXCEPTION 'Card snapshot is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_card_snapshot() FROM PUBLIC;
CREATE TRIGGER guard_card_snapshot BEFORE UPDATE ON app.cycles FOR EACH ROW EXECUTE FUNCTION app.guard_card_snapshot();

-- Аудит изменений справочника полей (событие без документа) — только администратором.
CREATE POLICY card_field_audit ON app.audit_events FOR INSERT WITH CHECK(act_id IS NULL AND action IN ('CARD_FIELD_CREATED','CARD_FIELD_UPDATED') AND (app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN')));
