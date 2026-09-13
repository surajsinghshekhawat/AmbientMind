-- Repeating commitments are rules, not tasks. Storing the rule means a weekly
-- tuition slot survives completing this week's instance, and can be turned off
-- in one place instead of deleting rows forever.
CREATE TABLE recurrence_rules (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  -- JSON array of weekday numbers, 0 = Sunday, matching Date#getDay().
  weekdays     TEXT NOT NULL,
  -- Local wall-clock 'HH:MM'. Deliberately not UTC: "tuition at 5pm" means 5pm
  -- where the user is, including after a timezone change.
  time_of_day  TEXT NOT NULL,
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  -- Materialise the task this many minutes before the occurrence itself.
  lead_minutes INTEGER NOT NULL DEFAULT 0,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'explicit'
               CHECK (source IN ('explicit', 'suggested'))
);

-- SQLite cannot alter a CHECK constraint, and tasks.source needs to admit
-- 'rule' so a materialised occurrence is distinguishable from a manual add.
CREATE TABLE tasks_new (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  deadline     TEXT,
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  source       TEXT NOT NULL
               CHECK (source IN ('gmail', 'gcalendar', 'outlook', 'teams', 'voice', 'manual', 'rule')),
  source_id    TEXT,
  people       TEXT NOT NULL DEFAULT '[]',
  raw_context  TEXT,
  confidence   REAL NOT NULL DEFAULT 1.0
               CHECK (confidence >= 0.0 AND confidence <= 1.0),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'done', 'archived', 'snoozed')),
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  snoozed_until TEXT
);

INSERT INTO tasks_new
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
