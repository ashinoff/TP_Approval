-- Справочники номиналов для проверки акта (решение владельца 05.11.2026): ведёт администратор,
-- остальные пользователи видят их только для чтения. Таблица хранится целиком: строки — массив JSON,
-- каждое сохранение увеличивает revision, отчёт сверки ссылается на ревизии справочников.
CREATE TABLE app.reference_books(
 code text PRIMARY KEY CHECK(code IN ('breakers','cables')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),
 settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(settings)='object'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by uuid REFERENCES app.users,
 updated_by_name text,
 updated_at timestamptz NOT NULL DEFAULT now());

-- Исходные значения — из таблиц владельца «ВА и трансформаторы тока.xlsx» и «сечения кабеля.xlsx».
-- breakers: мощность (кВт) от–до → номинал вводного автомата не выше, А; трансформаторы тока не ниже (null — не требуются).
-- 1ф — однофазный учёт 0,23 кВ, 3ф — трёхфазный учёт 0,4 кВ.
INSERT INTO app.reference_books(code,title,rows,settings) VALUES
('breakers','Номиналы ВА и трансформаторов тока',
 '[{"phases":"1ф","from":0,"to":1.29,"breaker":6,"ct":null},{"phases":"1ф","from":1.30,"to":2.16,"breaker":10,"ct":null},
   {"phases":"1ф","from":2.17,"to":3.45,"breaker":16,"ct":null},{"phases":"1ф","from":3.46,"to":4.32,"breaker":20,"ct":null},
   {"phases":"1ф","from":4.33,"to":5.40,"breaker":25,"ct":null},{"phases":"1ф","from":5.41,"to":6.91,"breaker":32,"ct":null},
   {"phases":"1ф","from":6.92,"to":8.64,"breaker":40,"ct":null},{"phases":"1ф","from":8.65,"to":10.81,"breaker":50,"ct":null},
   {"phases":"1ф","from":10.82,"to":13.62,"breaker":63,"ct":null},{"phases":"1ф","from":13.63,"to":17.29,"breaker":80,"ct":null},
   {"phases":"3ф","from":0,"to":3.71,"breaker":6,"ct":null},{"phases":"3ф","from":3.72,"to":6.19,"breaker":10,"ct":null},
   {"phases":"3ф","from":6.20,"to":9.90,"breaker":16,"ct":null},{"phases":"3ф","from":9.91,"to":12.37,"breaker":20,"ct":null},
   {"phases":"3ф","from":12.38,"to":15.47,"breaker":25,"ct":null},{"phases":"3ф","from":15.48,"to":19.80,"breaker":32,"ct":null},
   {"phases":"3ф","from":19.81,"to":24.75,"breaker":40,"ct":null},{"phases":"3ф","from":24.76,"to":30.93,"breaker":50,"ct":null},
   {"phases":"3ф","from":30.94,"to":38.98,"breaker":63,"ct":null},{"phases":"3ф","from":38.99,"to":49.90,"breaker":80,"ct":null},
   {"phases":"3ф","from":50.00,"to":61.87,"breaker":100,"ct":"100/5"},{"phases":"3ф","from":61.88,"to":77.34,"breaker":125,"ct":"200/5"},
   {"phases":"3ф","from":77.35,"to":98.99,"breaker":160,"ct":"200/5"},{"phases":"3ф","from":99.00,"to":123.74,"breaker":200,"ct":"250/5"},
   {"phases":"3ф","from":123.75,"to":154.67,"breaker":250,"ct":"300/5"},{"phases":"3ф","from":154.68,"to":185.61,"breaker":300,"ct":"400/5"},
   {"phases":"3ф","from":185.62,"to":194.89,"breaker":315,"ct":"400/5"},{"phases":"3ф","from":194.90,"to":247.48,"breaker":400,"ct":"500/5"},
   {"phases":"3ф","from":247.49,"to":309.34,"breaker":500,"ct":"600/5"},{"phases":"3ф","from":309.35,"to":389.77,"breaker":630,"ct":"800/5"},
   {"phases":"3ф","from":389.78,"to":494.95,"breaker":800,"ct":"1000/5"},{"phases":"3ф","from":494.96,"to":618.69,"breaker":1000,"ct":"1200/5"},
   {"phases":"3ф","from":618.70,"to":989.90,"breaker":1600,"ct":"2000/5"},{"phases":"3ф","from":989.91,"to":1237.38,"breaker":2000,"ct":"2500/5"},
   {"phases":"3ф","from":1237.39,"to":1546.72,"breaker":2500,"ct":"3000/5"}]','{}'),
-- cables: мощность (кВт) от–до → минимальное сечение (жил × мм²); допустимо это сечение и выше.
-- 0.23 — однофазное присоединение, 0.38 — трёхфазное. brands — марки, к которым применяется таблица (правила ВЛ: СИП).
('cables','Сечения провода и кабеля',
 '[{"voltage":"0.23","from":0,"to":21.62,"cores":2,"section":16},
   {"voltage":"0.38","from":0,"to":61.86,"cores":4,"section":16},{"voltage":"0.38","from":61.87,"to":80.42,"cores":4,"section":25},
   {"voltage":"0.38","from":80.43,"to":98.99,"cores":4,"section":35},{"voltage":"0.38","from":99.00,"to":120.64,"cores":4,"section":50},
   {"voltage":"0.38","from":120.65,"to":148.48,"cores":4,"section":70},{"voltage":"0.38","from":148.49,"to":185.60,"cores":4,"section":95},
   {"voltage":"0.38","from":185.61,"to":210.35,"cores":4,"section":120},{"voltage":"0.38","from":210.36,"to":235.10,"cores":4,"section":150},
   {"voltage":"0.38","from":235.11,"to":269.74,"cores":4,"section":185},{"voltage":"0.38","from":269.75,"to":318.62,"cores":4,"section":240}]',
 '{"brands":["СИП"]}');

ALTER TABLE app.reference_books ENABLE ROW LEVEL SECURITY; ALTER TABLE app.reference_books FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_books_read ON app.reference_books FOR SELECT USING(app.uid() IS NOT NULL);
CREATE POLICY reference_books_update ON app.reference_books FOR UPDATE USING(app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN'))
 WITH CHECK(updated_by=app.uid() AND (app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN')));
GRANT SELECT,UPDATE ON app.reference_books TO tp_runtime;

-- Имя редактора фиксируется при сохранении: runtime не читает app.users напрямую.
CREATE FUNCTION app.reference_editor_name() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 NEW.updated_by_name:=(SELECT u.name FROM app.users u WHERE u.id=NEW.updated_by);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.reference_editor_name() FROM PUBLIC;
CREATE TRIGGER reference_editor_name BEFORE UPDATE ON app.reference_books FOR EACH ROW EXECUTE FUNCTION app.reference_editor_name();

CREATE POLICY reference_audit ON app.audit_events FOR INSERT WITH CHECK(act_id IS NULL AND action='REFERENCE_UPDATED' AND (app.has_role('TECH_ADMIN') OR app.has_role('PROCESS_ADMIN')));
