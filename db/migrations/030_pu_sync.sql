-- Синхронизация с «Учёт ПУ» (решение владельца 09.11.2026): по номеру договора ТП «Учёт ПУ» забирает РЭС,
-- реквизиты и технические характеристики (поля карточки, заполненные из ТУ) и отмечает договор синхронизированным.
-- Здесь хранится только отметка синхронизации и хеш переданных данных: если данные потом поменялись,
-- договор показывается как «изменён после синхронизации». Сами данные не копируются — они берутся из актов.
CREATE TABLE app.pu_sync(
 number_key text PRIMARY KEY,
 contract_number text NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
 external_id text CHECK(external_id IS NULL OR length(external_id) BETWEEN 1 AND 200),
 synced_at timestamptz NOT NULL DEFAULT now(),
 first_synced_at timestamptz NOT NULL DEFAULT now(),
 synced_count integer NOT NULL DEFAULT 1 CHECK(synced_count>0)
);
ALTER TABLE app.pu_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pu_sync FORCE ROW LEVEL SECURITY;
-- Отметка не содержит персональных данных; читают все (и рабочее место, и сервис «Учёт ПУ» без пользователя),
-- пишет только app.pu_sync_mark.
CREATE POLICY pu_sync_read ON app.pu_sync FOR SELECT USING(true);
GRANT SELECT ON app.pu_sync TO tp_runtime;

-- Одна строка на номер договора: данные берутся из акта ТП (если его нет — из АВТУ), последнего по времени создания.
-- Мимо RLS: сервис «Учёт ПУ» работает без пользователя; рабочее место фильтрует строки по своей области само.
CREATE FUNCTION app.pu_sync_rows(only_key text DEFAULT NULL) RETURNS TABLE(
 number_key text, contract_number text, contract_date date, res_id uuid, res_code text, res_name text,
 act_id uuid, act_type text, state text, approved boolean, applicant text, address text,
 tu jsonb, technical jsonb, payload jsonb, payload_hash text, documents integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 WITH picked AS (
  SELECT DISTINCT ON (app.contract_key(a.contract_number)) app.contract_key(a.contract_number) AS key,a.*,
   count(*) OVER (PARTITION BY app.contract_key(a.contract_number))::integer AS documents
  FROM app.acts a WHERE only_key IS NULL OR app.contract_key(a.contract_number)=only_key
  ORDER BY app.contract_key(a.contract_number),(a.act_type='ACT_TP') DESC,a.created_at DESC,a.id
 ), data AS (
  SELECT p.*,r.code AS res_code,r.name AS res_name,
   EXISTS(SELECT 1 FROM app.releases x WHERE x.act_id=p.id AND x.status IN ('CURRENT','UNDER_REVISION')) AS approved,
   (SELECT jsonb_build_object('revision',t.number,'number',t.document_number,'date',t.document_date) FROM app.technical_conditions t WHERE t.id=p.technical_conditions_id) AS tu,
   coalesce((SELECT jsonb_object_agg(f.code,jsonb_build_object('label',f.label,'value',v.value,'unit',f.unit,'origin',v.origin))
    FROM app.card_values v JOIN app.card_fields f ON f.code=v.field_code WHERE v.act_id=p.id),'{}'::jsonb) AS technical
  FROM picked p JOIN app.res_units r ON r.id=p.res_id
 )
 SELECT d.key,d.contract_number,d.contract_date,d.res_id,d.res_code,d.res_name,d.id,d.act_type,d.state,d.approved,d.applicant,d.address,
  d.tu,d.technical,x.payload,md5(x.payload::text),d.documents
 FROM data d CROSS JOIN LATERAL (SELECT jsonb_build_object('contractNumber',d.contract_number,'contractDate',d.contract_date,
  'res',jsonb_build_object('code',d.res_code,'name',d.res_name),'applicant',d.applicant,'address',d.address,
  'tu',d.tu,'technical',d.technical) AS payload) x
$$;

-- Отметка «синхронизирован»: только для актуальных данных (хеш совпадает), иначе «Учёт ПУ» должен перечитать договор.
CREATE FUNCTION app.pu_sync_mark(number text, hash text, external text) RETURNS app.pu_sync
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE row_hash text; actual text; result app.pu_sync;
BEGIN
 SELECT r.payload_hash,r.contract_number INTO row_hash,actual FROM app.pu_sync_rows(app.contract_key(number)) r;
 IF row_hash IS NULL THEN RAISE EXCEPTION 'PU_SYNC_NOT_FOUND'; END IF;
 IF row_hash<>hash THEN RAISE EXCEPTION 'PU_SYNC_STALE'; END IF;
 INSERT INTO app.pu_sync(number_key,contract_number,payload_hash,external_id) VALUES(app.contract_key(number),actual,hash,external)
 ON CONFLICT (number_key) DO UPDATE SET payload_hash=EXCLUDED.payload_hash,external_id=coalesce(EXCLUDED.external_id,pu_sync.external_id),
  contract_number=EXCLUDED.contract_number,synced_at=now(),synced_count=pu_sync.synced_count+1
 RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.pu_sync_rows(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.pu_sync_mark(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pu_sync_rows(text),app.pu_sync_mark(text,text,text) TO tp_runtime;
