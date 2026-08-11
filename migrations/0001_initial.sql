-- Cairn, server-side schema.
--
-- Mirrors the client entities in src/lib/types.ts, plus an account column on every row
-- and a per-account sequence number that drives the sync cursor.
--
-- Two rules run through all of it:
--   1. Every row belongs to exactly one account, and no query may omit that filter.
--   2. Nothing is ever hard-deleted. A tombstone has to travel to the other device *as*
--      a deletion; a row that simply vanished from a pull is indistinguishable from one
--      the client has not seen yet.

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- PBKDF2 parameters are stored per account so the iteration count can be raised later
  -- without invalidating existing passwords.
  password_salt TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  -- The cursor. Every accepted mutation bumps this and stamps the rows it touched, so
  -- pulls are "give me everything above N". A counter rather than a timestamp: client
  -- clocks disagree by minutes, and a timestamp cursor silently skips rows written
  -- inside the skew window.
  seq           INTEGER NOT NULL DEFAULT 0
);

-- Case-insensitive, so Alice@example.com and alice@example.com are one account.
CREATE UNIQUE INDEX accounts_email ON accounts (lower(email));

CREATE TABLE sessions (
  -- The SHA-256 of the cookie value, never the value itself: a leaked database must not
  -- hand over usable sessions.
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_account ON sessions (account_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- Replay protection. Every mutation carries a client-generated UUID, so a retry after a
-- dropped connection cannot apply twice.
CREATE TABLE applied_mutations (
  id         TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE projects (
  id             TEXT NOT NULL,
  account_id     TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active', 'parked', 'done')),
  next_action_id TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  seq            INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX projects_seq ON projects (account_id, seq);

CREATE TABLE tasks (
  id             TEXT NOT NULL,
  account_id     TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  project_id     TEXT,
  title          TEXT NOT NULL,
  notes          TEXT,
  is_next_action INTEGER NOT NULL DEFAULT 0 CHECK (is_next_action IN (0, 1)),
  completed_at   INTEGER,
  week_id        TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  seq            INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX tasks_seq ON tasks (account_id, seq);
CREATE INDEX tasks_project ON tasks (account_id, project_id);

-- THE core invariant, enforced by the database rather than by hope.
--
-- On the client this lived inside one Dexie transaction, which is sufficient when there
-- is only one writer. It is not sufficient once a second device can contradict the
-- first, so it moves here. A partial unique index is the exact tool: at most one live,
-- flagged task per project.
CREATE UNIQUE INDEX tasks_one_next_action
  ON tasks (account_id, project_id)
  WHERE is_next_action = 1 AND deleted_at IS NULL;

CREATE TABLE inbox_items (
  id          TEXT NOT NULL,
  account_id  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  parsed_date TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  seq         INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX inbox_items_seq ON inbox_items (account_id, seq);

-- No completion column, and there must never be one. "A calendar item is not a task" is
-- enforced by the schema on the server exactly as it is on the client.
CREATE TABLE fixed_dates (
  id         TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX fixed_dates_seq ON fixed_dates (account_id, seq);

CREATE TABLE weeks (
  id                  TEXT NOT NULL,
  account_id          TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  review_completed_at INTEGER,
  review_steps        TEXT NOT NULL DEFAULT '[]',
  seq                 INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX weeks_seq ON weeks (account_id, seq);

-- Exactly one open week per account. Two tabs racing `ensureCurrentWeek` was already a
-- real bug locally; across devices it is a certainty without this.
CREATE UNIQUE INDEX weeks_one_open
  ON weeks (account_id)
  WHERE ended_at IS NULL;

CREATE TABLE settings (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
);

CREATE INDEX settings_seq ON settings (account_id, seq);
