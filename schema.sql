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

-- Postavke huba (npr. VAPID ključ koji Worker sam generira pri prvom pokretanju).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Push pretplate: jedan preglednik/uređaj = jedna pretplata s jednom adresom.
CREATE TABLE IF NOT EXISTS subscriptions (
  id         TEXT PRIMARY KEY,          -- hash endpointa
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  place      TEXT NOT NULL,
  street     TEXT NOT NULL,
  house      TEXT,
  topics     TEXT,                      -- "struja,voda,odvoz"; NULL = struja i voda
  zone       TEXT,                      -- ručno odabrana zona odvoza
  addresses  TEXT,                      -- JSON [{label, address, zone}]: sve adrese uređaja; prva = place/street/house/zone
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Što je kome poslano, da nitko ne dobije istu obavijest dvaput.
-- kind: 'najava' (čim se obavijest pojavi), 'danas' (jutro na dan isključenja),
-- 'vecer' (podsjetnik za odvoz; notice_id = 'odvoz:<zona>:<datum>')
CREATE TABLE IF NOT EXISTS deliveries (
  notice_id TEXT NOT NULL,
  sub_id    TEXT NOT NULL,
  kind      TEXT NOT NULL,
  sent_at   TEXT NOT NULL,
  PRIMARY KEY (notice_id, sub_id, kind)
);
