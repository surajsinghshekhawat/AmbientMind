-- Links a rule to the Google Calendar event that mirrors it, so edits update
-- the same event rather than accumulating duplicates, and deleting a rule can
-- take its event with it. Null means the rule has never been pushed.
ALTER TABLE recurrence_rules ADD COLUMN gcal_event_id TEXT;
