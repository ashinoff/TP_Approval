-- PDF — основной формат документов (решение владельца 05.11.2026): акт ТП и АВТУ могут быть PDF (из Word/Excel,
-- с текстовым слоем), ТУ — PDF (вид TU_PDF уже был). DOCX остаётся читаемым для уже загруженных документов.
ALTER TABLE app.files DROP CONSTRAINT IF EXISTS files_kind_check;
ALTER TABLE app.files DROP CONSTRAINT IF EXISTS files_kind_check1;
ALTER TABLE app.files ADD CONSTRAINT files_kind_check CHECK(kind IN ('ACT_DOCX','AVTU_DOCX','TU_DOCX','ACT_PDF','AVTU_PDF','TU_PDF'));

CREATE OR REPLACE FUNCTION app.check_act_document_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.acts a JOIN app.files f ON f.act_id=a.id WHERE a.id=NEW.act_id AND f.id=NEW.file_id AND f.scan_status='READY'
  AND f.kind=ANY(CASE a.act_type WHEN 'AVTU' THEN ARRAY['AVTU_DOCX','AVTU_PDF'] ELSE ARRAY['ACT_DOCX','ACT_PDF'] END)) THEN
  RAISE EXCEPTION 'Act version requires matching document type'; END IF;
 RETURN NEW;
END $$;

-- Редакция ТУ может ссылаться и на PDF-файл.
ALTER POLICY tu_insert ON app.technical_conditions WITH CHECK(
 app.has_role('RIRU_ENGINEER',res_id) AND created_by=app.uid() AND EXISTS(
 SELECT 1 FROM app.acts a JOIN app.files f ON f.act_id=a.id WHERE a.id=source_act_id AND a.contract_id=technical_conditions.contract_id AND f.id=file_id AND f.kind IN ('TU_DOCX','TU_PDF') AND f.scan_status='READY'));
