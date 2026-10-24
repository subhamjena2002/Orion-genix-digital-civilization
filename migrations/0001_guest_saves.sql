-- One saved game per guest. The guest is known only by the SHA-256 of the random token in their
-- cookie, so the table never holds anything that would let someone act as them.
--
-- `data` is the save as JSON (src/engine/orion/missions/SaveSchema.ts), checked by the API
-- before it's written. `revision` goes up by one on every write: a write names the revision it
-- was based on and only lands if that's still current (worker/index.ts), so an older save can
-- never overwrite a newer one. `last_write_id` lets a retried write be recognised as one that
-- already landed, instead of a conflict.
CREATE TABLE IF NOT EXISTS guest_saves (
	guest_hash TEXT PRIMARY KEY NOT NULL CHECK (length(guest_hash) = 64),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
	data TEXT NOT NULL CHECK (length(data) <= 16384),
	last_write_id TEXT CHECK (last_write_id IS NULL OR length(last_write_id) <= 64),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;

-- For a future retention policy (saves untouched for a long time); nothing deletes saves today.
CREATE INDEX IF NOT EXISTS guest_saves_updated_at ON guest_saves (updated_at);
