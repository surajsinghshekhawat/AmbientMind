-- Every re-read of a message stored another example of it, so a forced sync
-- duplicated the corpus and retrieval returned the same email several times.
-- Keep one example per message, preferring a rated one, then the newest.
CREATE TEMP TABLE doomed_examples AS
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY source_id
             ORDER BY (feedback <> 0) DESC, id DESC
           ) AS rank
      FROM examples
     WHERE source_id IS NOT NULL
  )
  WHERE rank > 1;

DELETE FROM example_vectors WHERE rowid IN (SELECT id FROM doomed_examples);
DELETE FROM examples WHERE id IN (SELECT id FROM doomed_examples);
DROP TABLE doomed_examples;

DROP INDEX idx_examples_source_id;
CREATE UNIQUE INDEX idx_examples_source_id
  ON examples (source_id)
  WHERE source_id IS NOT NULL;
