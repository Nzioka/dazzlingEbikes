-- Rider sessions. The browser holds a random token in an HttpOnly cookie;
-- only its SHA-256 hash is stored here, so a database leak can't be replayed.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL REFERENCES riders(email),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_by_email ON orders(email);
