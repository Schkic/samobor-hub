-- Obavijesti iz svih izvora (HEP, VIO, Komunalac...), u zajedničkom formatu.
CREATE TABLE IF NOT EXISTS notices (
  id          TEXT PRIMARY KEY,         -- hash(izvor|datum|sadržaj)
  source      TEXT NOT NULL,            -- 'hep' | 'vio' | 'komunalac' | 'odvoz'
  kind        TEXT NOT NULL,            -- 'struja-planirano', 'struja-kvar', 'voda'...
  date        TEXT NOT NULL,            -- YYYY-MM-DD
  start_time  TEXT,                     -- HH:MM
  end_time    TEXT,
  places      TEXT NOT NULL,            -- JSON string[]
  streets     TEXT NOT NULL,            -- JSON StreetSegment[]
  raw_streets TEXT NOT NULL,
  note        TEXT,
  partial     INTEGER NOT NULL DEFAULT 0,
  url         TEXT NOT NULL,
  first_seen  TEXT NOT NULL,            -- kad smo je prvi put vidjeli (ISO)
  notified    INTEGER NOT NULL DEFAULT 0 -- 0 = push još nije poslan
);

CREATE INDEX IF NOT EXISTS idx_notices_date ON notices (date);
CREATE INDEX IF NOT EXISTS idx_notices_source_date ON notices (source, date);
CREATE INDEX IF NOT EXISTS idx_notices_pending ON notices (notified, date);

-- Zapis svakog pokretanja scrapera, da se vidi kad izvor prestane raditi.
CREATE TABLE IF NOT EXISTS source_runs (
  source     TEXT NOT NULL,
  ran_at     TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  found      INTEGER NOT NULL DEFAULT 0,
  error      TEXT
);
