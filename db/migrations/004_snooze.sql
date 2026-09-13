-- Snoozing needs a wake time, not just a status: without it a snoozed task is
-- indistinguishable from one that was hidden forever, and nothing can bring it
-- back. NULL means "not snoozed".
ALTER TABLE tasks ADD COLUMN snoozed_until TEXT;

CREATE INDEX idx_tasks_snoozed_until ON tasks (snoozed_until)
  WHERE snoozed_until IS NOT NULL;
