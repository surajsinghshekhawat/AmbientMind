-- Records every message the pipeline has already considered. The unique index
-- on tasks(source, source_id) only prevents duplicate *tasks*; a message that
-- correctly yields no task leaves no row there and would otherwise be sent to
-- the model again on every sync, forever.
CREATE TABLE processed_messages (
  source       TEXT NOT NULL
               CHECK (source IN ('gmail', 'gcalendar', 'outlook', 'teams')),
  source_id    TEXT NOT NULL,
  -- 'skipped' means a cheap pre-filter rejected it before any model call.
  outcome      TEXT NOT NULL DEFAULT 'extracted'
               CHECK (outcome IN ('extracted', 'skipped', 'failed')),
  tasks_found  INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (source, source_id)
);

CREATE INDEX idx_processed_at ON processed_messages (processed_at);

-- Per-integration cursors (Gmail historyId, Calendar syncToken).
CREATE TABLE sync_state (
  source     TEXT PRIMARY KEY,
  cursor     TEXT,
  last_run   TEXT,
  last_error TEXT
);
