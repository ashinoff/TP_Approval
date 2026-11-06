-- Структура подразделений (решение владельца 06.11.2026): в службах СУЭ, СТП, ТЕХБЛОК — начальник (главный инженер
-- ТЕХБЛОКА) и инженеры. Задачу согласования по-прежнему получает начальник службы (роли SUE/STP/GI); инженеры служб
-- (SUE_ENGINEER/STP_ENGINEER/GI_ENGINEER) видят документы всех РЭС только для чтения. Маршрут согласования не меняется.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.roles'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%SUE%' LOOP
  EXECUTE format('ALTER TABLE app.roles DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.roles ADD CONSTRAINT roles_role_check CHECK(role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI','SUE_ENGINEER','STP_ENGINEER','GI_ENGINEER','TECH_ADMIN','PROCESS_ADMIN'));
ALTER TABLE app.roles ADD CONSTRAINT roles_scope_check CHECK((role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD') AND res_id IS NOT NULL) OR role IN ('PROCESS_ADMIN','TECH_ADMIN')
 OR (role IN ('SUE','STP','GI','SUE_ENGINEER','STP_ENGINEER','GI_ENGINEER') AND res_id IS NULL));

CREATE OR REPLACE FUNCTION app.can_read(area uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT app.has_role('RIRU_ENGINEER',area) OR app.has_role('RIRU_HEAD',area) OR app.has_role('RES_HEAD',area) OR app.has_role('SUE') OR app.has_role('STP') OR app.has_role('GI')
  OR app.has_role('SUE_ENGINEER') OR app.has_role('STP_ENGINEER') OR app.has_role('GI_ENGINEER')
  OR app.has_role('PROCESS_ADMIN',area) OR app.has_role('TECH_ADMIN') $$;
