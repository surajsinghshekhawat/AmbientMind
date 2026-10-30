-- Two columns on `examples`, both in service of loops that were designed in
-- migration 002 and never closed.
--
-- `source_id` ties an example back to the message that produced it, which is
-- what lets a completed or deleted task mark its own example. Without it the
-- feedback column, its CHECK constraint and its index have no writer, and
-- renderFewShot's handling of thumbs-down examples is unreachable code.
--
-- `embed_version` records which embedding convention produced a row's vector.
-- Version 0 is raw text; version 1 carries nomic-embed's `search_document:`
-- prefix. Mixing the two in one store is worse than consistently using either,
-- so rows are re-embedded in the background until they all agree.
ALTER TABLE examples ADD COLUMN source_id TEXT;
ALTER TABLE examples ADD COLUMN embed_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_examples_source_id ON examples (source_id);
CREATE INDEX idx_examples_embed_version ON examples (embed_version);

-- The retention sweep deletes oldest-first, so it sorts on created_at every
-- fifteen minutes. processed_messages already has idx_processed_at from
-- migration 003 and needs nothing further.
CREATE INDEX idx_examples_created_at ON examples (created_at);
