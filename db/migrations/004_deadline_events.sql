ALTER TABLE app.deadline_policies ADD COLUMN warning_hours integer NOT NULL DEFAULT 4 CHECK(warning_hours BETWEEN 0 AND 168);
CREATE TABLE app.deadline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES app.tasks, act_id uuid NOT NULL REFERENCES app.acts, recipient_id uuid NOT NULL REFERENCES app.users, type text NOT NULL CHECK(type IN ('WARNING','OVERDUE','ESCALATION')), due_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,recipient_id,type,due_at));
ALTER TABLE app.deadline_events ENABLE ROW LEVEL SECURITY;ALTER TABLE app.deadline_events FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON app.deadline_events USING(app.act_visible(act_id)) WITH CHECK(app.act_visible(act_id));
GRANT SELECT,INSERT ON app.deadline_events TO tp_runtime;
