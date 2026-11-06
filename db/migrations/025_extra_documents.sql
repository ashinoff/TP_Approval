-- Дополнительные документы договора (решение владельца 06.11.2026): ПСУ, предыдущий акт ТП, поопорная схема.
-- Загружаются в PDF к выбранному документу (при создании или позже через «Доп. документы»), видны в пакете документов
-- и в режиме проверки как документ для сравнения. Маршрута согласования у них нет; удаляются вместе с документом.
ALTER TABLE app.files DROP CONSTRAINT IF EXISTS files_kind_check;
ALTER TABLE app.files ADD CONSTRAINT files_kind_check CHECK(kind IN ('ACT_DOCX','AVTU_DOCX','TU_DOCX','ACT_PDF','AVTU_PDF','TU_PDF','EXTRA_PDF'));

CREATE TABLE app.extra_documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 act_id uuid NOT NULL REFERENCES app.acts,
 file_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('PSU','PREV_ACT','POLE_SCHEME')),
 number integer NOT NULL CHECK(number>0),
 created_by uuid NOT NULL REFERENCES app.users,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(file_id,act_id) REFERENCES app.files(id,act_id),
 UNIQUE(act_id,kind,number));
CREATE INDEX extra_documents_act ON app.extra_documents(act_id);

ALTER TABLE app.extra_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE app.extra_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY extra_documents_read ON app.extra_documents FOR SELECT USING(app.act_visible(act_id));
CREATE POLICY extra_documents_insert ON app.extra_documents FOR INSERT WITH CHECK(created_by=app.uid() AND EXISTS(
 SELECT 1 FROM app.acts a JOIN app.files f ON f.act_id=a.id WHERE a.id=act_id AND f.id=file_id AND f.kind='EXTRA_PDF' AND f.scan_status='READY'
  AND a.state IN ('DRAFT','RETURNED','REVISING') AND app.has_role('RIRU_ENGINEER',a.res_id)));
GRANT SELECT,INSERT ON app.extra_documents TO tp_runtime;
