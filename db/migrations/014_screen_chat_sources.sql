-- Screen captures and chat become sources of their own, so "what AmbientMind
-- knows" can count them; until now both were saved as 'manual'. Same rebuild
-- as 013, triggers and indexes included, since they go with the old table.
CREATE TABLE tasks_new (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  deadline       TEXT,
  priority       TEXT NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  source         TEXT NOT NULL
                 CHECK (source IN ('gmail', 'gcalendar', 'acalendar', 'reminders', 'outlook', 'teams', 'voice', 'screen', 'chat', 'manual', 'rule')),
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
         source_url, evidence, updated_at
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
