CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  deadline     TEXT,
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  source       TEXT NOT NULL
               CHECK (source IN ('gmail', 'gcalendar', 'outlook', 'teams', 'voice', 'manual')),
  source_id    TEXT,
  people       TEXT NOT NULL DEFAULT '[]',
  raw_context  TEXT,
  confidence   REAL NOT NULL DEFAULT 1.0
               CHECK (confidence >= 0.0 AND confidence <= 1.0),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'done', 'archived', 'snoozed')),
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

-- Source-level deduplication enforced by the database rather than by a
-- read-then-write check, so concurrent sync passes cannot race.
CREATE UNIQUE INDEX idx_tasks_source
  ON tasks (source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX idx_tasks_status_deadline ON tasks (status, deadline);
