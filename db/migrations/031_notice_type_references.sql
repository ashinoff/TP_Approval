-- Третий вид документа (решение владельца 09.11.2026): «Уведомление об обеспечении сетевой организацией возможности
-- присоединения к электрическим сетям» (NOTICE) — рядом с актом ТП (ACT_TP) и АВТУ (AVTU). Вид определяется по заголовку
-- документа при загрузке; скреплённые в одном PDF документы разделяются и сохраняются отдельно.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.acts'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%AVTU%' LOOP
  EXECUTE format('ALTER TABLE app.acts DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.acts ADD CONSTRAINT acts_act_type_check CHECK(act_type IN ('ACT_TP','AVTU','NOTICE'));
ALTER TABLE app.files DROP CONSTRAINT IF EXISTS files_kind_check;
ALTER TABLE app.files ADD CONSTRAINT files_kind_check CHECK(kind IN ('ACT_DOCX','AVTU_DOCX','TU_DOCX','ACT_PDF','AVTU_PDF','TU_PDF','EXTRA_PDF','NOTICE_PDF'));
CREATE OR REPLACE FUNCTION app.check_act_document_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.acts a JOIN app.files f ON f.act_id=a.id WHERE a.id=NEW.act_id AND f.id=NEW.file_id AND f.scan_status='READY'
  AND f.kind=ANY(CASE a.act_type WHEN 'AVTU' THEN ARRAY['AVTU_DOCX','AVTU_PDF'] WHEN 'NOTICE' THEN ARRAY['NOTICE_PDF'] ELSE ARRAY['ACT_DOCX','ACT_PDF'] END)) THEN
  RAISE EXCEPTION 'Act version requires matching document type'; END IF;
 RETURN NEW;
END $$;

-- Справочники для проверки уведомления: tg φ по уровню напряжения и доверенности подписантов сетевой организации.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.reference_books'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%breakers%' LOOP
  EXECUTE format('ALTER TABLE app.reference_books DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.reference_books ADD CONSTRAINT reference_books_code_check CHECK(code IN ('breakers','cables','tg','attorneys'));
-- tg: предельные значения коэффициента реактивной мощности по уровню напряжения (кВ). Владелец: для 0,4 кВ — 0,35;
-- остальные строки — по приказу Минэнерго России № 380 (НН 0,35; СН2 6–20 кВ и СН1 35 кВ 0,4; ВН 110 кВ 0,5), администратор может поправить.
INSERT INTO app.reference_books(code,title,rows,settings) VALUES
('tg','Коэффициент реактивной мощности (tg)','[{"voltage":"0.23","tg":0.35},{"voltage":"0.4","tg":0.35},{"voltage":"6","tg":0.4},{"voltage":"10","tg":0.4},{"voltage":"20","tg":0.4},{"voltage":"35","tg":0.4},{"voltage":"110","tg":0.5}]','{}'),
-- Доверенности заполняет администратор: номер, дата, ФИО и должность подписанта, срок действия.
('attorneys','Доверенности подписантов','[]','{}')
ON CONFLICT (code) DO NOTHING;
