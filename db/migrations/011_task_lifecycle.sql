-- Deleting a task used to remove its row, which also removed the only thing
-- stopping the same email, calendar event or recurring occurrence from being
-- imported again. A deleted task is now a tombstone: hidden everywhere, but
-- still holding its (source, source_id) slot until the retention sweep.
--
-- The rebuild is also the one chance to widen the status CHECK, so it admits
-- 'suggested' for AI tasks awaiting review, and adds the columns for edit
-- tracking and provenance.
CREATE TABLE tasks_new (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  deadline       TEXT,
  priority       TEXT NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  source         TEXT NOT NULL
                 CHECK (source IN ('gmail', 'gcalendar', 'outlook', 'teams', 'voice', 'manual', 'rule')),
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
  -- Background enrichment must not overwrite anything the user changed.
  user_edited_at TEXT,
  -- Link back to the thread or event, and the sentence that produced the task.
  source_url     TEXT,
  evidence       TEXT
);

INSERT INTO tasks_new
  (id, title, deadline, priority, source, source_id, people, raw_context,
   confidence, status, created_at, completed_at, snoozed_until)
  SELECT id, title, deadline, priority, source, source_id, people, raw_context,
         confidence, status, created_at, completed_at, snoozed_until
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
