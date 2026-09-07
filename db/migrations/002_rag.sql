-- Retrieval corpus for the few-shot layer. Kept beside the tasks in the same
-- database file rather than in a separate vector service, so there is no second
-- process to supervise and no client/server version to keep in step.
CREATE TABLE examples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT NOT NULL,
  tasks      TEXT NOT NULL DEFAULT '[]',
  source     TEXT NOT NULL DEFAULT 'observed'
             CHECK (source IN ('seed', 'observed', 'feedback')),
  -- -1 thumbs down, 0 unrated, 1 thumbs up. Negative examples are retrieved too:
  -- showing the model what not to extract is as useful as showing what to.
  feedback   INTEGER NOT NULL DEFAULT 0
             CHECK (feedback IN (-1, 0, 1)),
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE example_vectors USING vec0(embedding float[768]);

CREATE INDEX idx_examples_feedback ON examples (feedback);
