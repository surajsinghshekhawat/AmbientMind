-- A pattern the app noticed but has NOT acted on. Suggestions are persisted so
-- that "no, this is not weekly" is remembered: re-asking every hour about the
-- same thing is worse than never asking at all.
CREATE TABLE recurrence_suggestions (
  id          TEXT PRIMARY KEY,
  -- Normalised title + weekday. Stable across further occurrences, so a
  -- dismissal keeps holding as the count grows.
  signature   TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  weekdays    TEXT NOT NULL,
  time_of_day TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at  TEXT NOT NULL,
  decided_at  TEXT
);

CREATE INDEX idx_suggestions_status ON recurrence_suggestions (status);
