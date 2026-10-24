-- Accounts (docs/accounts.md). Guests still play without one; an account keeps the save across
-- browsers and devices. As with guests, nothing here lets someone act as a player if the tables
-- leak: sessions and email links are stored as SHA-256 hashes of their tokens, and passwords
-- (once sign-up lands) only as slow salted hashes.
--
-- Every table below hangs off `users` with ON DELETE CASCADE, so deleting a user removes their
-- sign-in methods, sessions, pending email links and save with it. (D1 always enforces foreign
-- keys.)

-- One player. `email` is stored trimmed and lower-cased, so the UNIQUE holds whatever case it's
-- typed in. `password_hash` is NULL for an account that only signs in with Google.
-- `failed_logins` and `locked_until` slow down password guessing for this account.
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 22),
	email TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(trim(email))),
	email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
	password_hash TEXT CHECK (password_hash IS NULL OR length(password_hash) <= 255),
	display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 32),
	failed_logins INTEGER NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
	locked_until INTEGER,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;

-- A sign-in with another provider (Google). The provider's own stable id (Google's `sub`) is the
-- identity, never the email, which can change hands. `email` is what the provider last reported.
CREATE TABLE IF NOT EXISTS oauth_accounts (
	provider TEXT NOT NULL CHECK (provider IN ('google')),
	provider_user_id TEXT NOT NULL CHECK (length(provider_user_id) BETWEEN 1 AND 255),
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	email TEXT CHECK (email IS NULL OR length(email) <= 254),
	created_at INTEGER NOT NULL,
	PRIMARY KEY (provider, provider_user_id)
) STRICT;

CREATE INDEX IF NOT EXISTS oauth_accounts_user ON oauth_accounts (user_id);

-- A signed-in browser. The cookie holds a random token; only its hash is kept. `expires_at`
-- slides forward as the session is used (worker/auth.ts), and `last_seen_at` is written at most
-- once an hour so that using the game doesn't cost a database write per request.
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 200)
) STRICT;

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions (expires_at);

-- Single-use links sent by email: confirming the address, or resetting the password.
CREATE TABLE IF NOT EXISTS email_tokens (
	token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	used_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens (user_id);

-- A signed-in player's saved game: the same shape and rules as guest_saves (0001), keyed by the
-- account instead of a cookie.
CREATE TABLE IF NOT EXISTS user_saves (
	user_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	revision INTEGER NOT NULL CHECK (revision >= 1),
	schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
	data TEXT NOT NULL CHECK (length(data) <= 16384),
	last_write_id TEXT CHECK (last_write_id IS NULL OR length(last_write_id) <= 64),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;
