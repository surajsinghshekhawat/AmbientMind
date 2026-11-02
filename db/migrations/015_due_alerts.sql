-- Due-soon notifications. `reminded_at` is when the one alert for the current
-- deadline went out; `remind_at` is a later alert the user asked for with
-- "Snooze 1 hour". Both clear when the deadline changes.
ALTER TABLE tasks ADD COLUMN reminded_at TEXT;
ALTER TABLE tasks ADD COLUMN remind_at TEXT;
