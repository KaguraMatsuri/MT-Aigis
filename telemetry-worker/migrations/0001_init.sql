PRAGMA foreign_keys = ON;

CREATE TABLE installations (
  id_hash TEXT PRIMARY KEY
    CHECK(length(id_hash) = 64 AND id_hash NOT GLOB '*[^0-9a-f]*'),
  last_seen_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX installations_by_last_seen
ON installations(last_seen_at);

CREATE TABLE daily_active (
  day_utc TEXT NOT NULL,
  id_hash TEXT NOT NULL,
  PRIMARY KEY (day_utc, id_hash),
  FOREIGN KEY (id_hash) REFERENCES installations(id_hash) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE counters (
  metric TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK(value >= 0)
) WITHOUT ROWID;

INSERT INTO counters (metric, value)
VALUES ('total_installations', 0);

CREATE TABLE daily_counts (
  day_utc TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK(value >= 0)
) WITHOUT ROWID;

CREATE TRIGGER count_new_installation
AFTER INSERT ON installations
BEGIN
  UPDATE counters
  SET value = value + 1
  WHERE metric = 'total_installations';
END;

CREATE TRIGGER count_new_daily_active
AFTER INSERT ON daily_active
BEGIN
  INSERT INTO daily_counts (day_utc, value)
  VALUES (NEW.day_utc, 1)
  ON CONFLICT(day_utc) DO UPDATE SET value = value + 1;
END;
