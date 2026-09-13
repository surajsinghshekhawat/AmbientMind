-- A failed message was indistinguishable from a handled one, so anything that
-- threw once was never read again: a dropped connection, an expired token, or
-- Ollama restarting mid-pass retired that mail permanently. Counting attempts
-- lets a transient failure be retried while a message that breaks the parser
-- every single time eventually stops costing a model call.
ALTER TABLE processed_messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- Anything already marked failed was lost under the old behaviour. Seed it at
-- one attempt so it is retried rather than written off.
UPDATE processed_messages SET attempts = 1 WHERE outcome = 'failed';
