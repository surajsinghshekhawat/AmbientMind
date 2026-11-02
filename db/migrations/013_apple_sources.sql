-- Apple Calendar ('acalendar') and Reminders ('reminders') become sources,
-- which means widening the source CHECK, which in SQLite means a rebuild.
--
-- Two-way Reminders sync also needs to know when a task last changed, to let
-- the later edit win when both sides changed the same field. `updated_at` is
-- kept by triggers rather than by every writer, so no code path can forget.
CREATE TABLE tasks_new (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  deadline       TEXT,
  priority       TEXT NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  source         TEXT NOT NULL
                 CHECK (source IN ('gmail', 'gcalendar', 'acalendar', 'reminders', 'outlook', 'teams', 'voice', 'manual', 'rule')),
  source_id      TEXT,
  people         TEXT NOT NULL DEFAULT '[]',
  raw_context    TEXT,
  confidence     REAL NOT NULL DEFAULT 1.0
                 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'done', 'archived', 'snoozed', 'deleted', 'suggested')),
  created_at     TEXT NOT NULL,
  completed_at   TEXT,
  snoozed_until  TEXT,
  deleted_at     TEXT,
  user_edited_at TEXT,
  source_url     TEXT,
  evidence       TEXT,
  updated_at     TEXT
);

INSERT INTO tasks_new
  (id, title, deadline, priority, source, source_id, people, raw_context, confidence,
   status, created_at, completed_at, snoozed_until, deleted_at, user_edited_at,
   source_url, evidence, updated_at)
  SELECT id, title, deadline, priority, source, source_id, people, raw_context, confidence,
         status, created_at, completed_at, snoozed_until, deleted_at, user_edited_at,
         source_url, evidence,
         COALESCE(deleted_at, completed_at, user_edited_at, created_at)
  FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE UNIQUE INDEX idx_tasks_source
  ON tasks (source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX idx_tasks_status_deadline ON tasks (status, deadline);

CREATE INDEX idx_tasks_snoozed_until ON tasks (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX idx_tasks_deleted_at ON tasks (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TRIGGER tasks_touch_insert AFTER INSERT ON tasks
  WHEN NEW.updated_at IS NULL
BEGIN
  UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER tasks_touch AFTER UPDATE OF title, deadline, priority, status ON tasks
BEGIN
  UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- A task's copy elsewhere. No foreign key: calendar prep tasks are removed
-- outright when their meeting goes, and the link has to outlive the row so
-- the copy can be removed too.
CREATE TABLE task_links (
  task_id         TEXT NOT NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('reminders')),
  external_id     TEXT NOT NULL,
  -- The other side's modification stamp when last synced.
  modified_at     TEXT,
  -- The synced fields as each side had them then, so a change on either side
  -- is a field-by-field difference rather than a guess from timestamps.
  local_snapshot  TEXT NOT NULL,
  remote_snapshot TEXT NOT NULL,
  synced_at       TEXT NOT NULL,
  PRIMARY KEY (provider, task_id)
);

CREATE UNIQUE INDEX idx_task_links_external ON task_links (provider, external_id);
