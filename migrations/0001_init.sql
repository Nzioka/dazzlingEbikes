-- Dazzling E-Bikes demo store schema (D1 / SQLite)

CREATE TABLE IF NOT EXISTS bikes (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  tagline   TEXT NOT NULL,
  range_km  INTEGER NOT NULL,
  price_usd INTEGER NOT NULL,
  stock     INTEGER NOT NULL,
  image     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS riders (
  email     TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  salt      TEXT NOT NULL,
  pw_hash   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bike_id    TEXT NOT NULL REFERENCES bikes(id),
  email      TEXT NOT NULL,
  city       TEXT,
  colo       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT,
  ok         INTEGER NOT NULL,
  reason     TEXT,
  ip         TEXT,
  colo       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO bikes VALUES
  ('city-one',    'Dazzling City One',    'The everyday commuter, built for traffic and hills', 80,  1490, 42, '/img/city-one.svg'),
  ('cargo-max',   'Dazzling Cargo Max',   'Deliveries, groceries and school runs',              110, 2690, 15, '/img/cargo-max.svg'),
  ('trail-pro',   'Dazzling Trail Pro',   'Full suspension for gravel and red-dirt roads',      95,  3290,  8, '/img/trail-pro.svg'),
  ('fold-go',     'Dazzling Fold & Go',   'Folds in ten seconds for the train and the office',  60,  1190, 31, '/img/fold-go.svg');
