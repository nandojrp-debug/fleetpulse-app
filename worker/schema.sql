-- FleetPulse — accounts (operator + driver) at GPS pings
-- Patakbuhin ito ISANG BESES sa D1 console (Cloudflare → D1 → iyong database → Console).
-- Hindi nito gagalawin ang luma mong tables; bago lahat ng tables (may "fp_" sa unahan).

CREATE TABLE IF NOT EXISTS fp_fleets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  join_code   TEXT NOT NULL UNIQUE,      -- invite code na ibibigay ng operator sa drivers
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fp_users (
  id          TEXT PRIMARY KEY,
  fleet_id    TEXT NOT NULL REFERENCES fp_fleets(id),
  role        TEXT NOT NULL CHECK (role IN ('operator', 'driver')),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  plate       TEXT,                      -- plate number ng truck (driver lang)
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fp_users_fleet ON fp_users (fleet_id, role);

CREATE TABLE IF NOT EXISTS fp_sessions (
  token_hash  TEXT PRIMARY KEY,          -- SHA-256 ng token (hindi naka-save ang mismong token)
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fp_sessions_user ON fp_sessions (user_id);

CREATE TABLE IF NOT EXISTS fp_pings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fleet_id    TEXT NOT NULL,
  driver_id   TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  speed       REAL,
  heading     REAL,
  accuracy    REAL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fp_pings_driver_ts ON fp_pings (driver_id, ts);
