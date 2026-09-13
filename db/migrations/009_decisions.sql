-- What the user did with a task, kept after the task itself is gone.
--
-- Two jobs, one table. It is a memory, so the app can stop re-asking questions
-- that were already settled; and it is evidence, so repeatedly deleting the
-- same kind of task can quiet that kind down. Both need the same rows, and
-- splitting them would have meant recording every action twice.
CREATE TABLE IF NOT EXISTS decisions (
  id           TEXT PRIMARY KEY,
  -- 'completed' | 'deleted' | 'snoozed' | 'dismissed_suggestion'
  kind         TEXT NOT NULL,
  -- Normalised title, so variations of the same commitment group together.
  subject      TEXT NOT NULL,
  -- Original wording, for showing the user what was learned.
  title        TEXT NOT NULL,
  -- Where the task came from, so noise can be attributed to a source.
  source       TEXT,
  -- Free text: the sender, the snooze target, the clash it lost to.
  detail       TEXT,
  decided_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_subject ON decisions (subject);
CREATE INDEX IF NOT EXISTS idx_decisions_decided_at ON decisions (decided_at);
