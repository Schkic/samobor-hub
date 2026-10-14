import { normalizeStreet, normalizeText } from "../core/streets";
import type { Address } from "../core/types";
import { TOWN, VILLAGES } from "../data/addresses";

/**
 * Vozni red Samoborčeka iz javnog data.json aplikacije Autobusi
 * (autobusi-samobor.opticora.hr). Aplikaciju ne diramo, samo čitamo njezine podatke.
 *
 * Format: l[] = linije { id, n, od, d: smjerovi { h, st: stanice }, t: { r, s, n } , f?, x?, src }.
 * t.r / t.s / t.n = radni dan / subota / nedjelja i blagdan; svaki je niz po smjeru,
 * a vremena ("6:00", "4:35*", "16:40C") su polasci s PRVE stanice smjera. Oznaka
 * iza vremena upućuje na fusnotu u f.
 */
export const BUS_URL = "https://autobusi-samobor.opticora.hr/data.json";
export const BUS_APP = "https://autobusi-samobor.opticora.hr/";

export type DayType = "r" | "s" | "n";

export interface BusLine {
  id: string;
  n: string;
  od?: string;
  d: { h: string; st: string[] }[];
  t: Record<DayType, string[][]>;
  f?: Record<string, string>;
  x?: string;
  src?: string;
}

export interface BusData {
  page?: string;
  gen?: string;
  l: BusLine[];
}

export interface Departure {
  time: string; // "6:35"
  note?: string; // tekst fusnote
}

export interface DirectionNext {
  h: string; // "Iz Braslovja"
  from: string; // prva stanica
  to: string; // zadnja stanica
  next: Departure[];
  tomorrow: boolean; // danas više nema polazaka, prikazani su sutrašnji
}

export interface LineInfo {
  id: string;
  name: string;
  stop: string | null; // stanica koja je povezala adresu s linijom
  note: string | null; // npr. "Subotom, nedjeljom i blagdanima linija ne prometuje!"
  src: string | null;
  dirs: DirectionNext[];
}

export interface BoardRow {
  time: string;
  line: string;
  to: string;
  note?: string;
  tomorrow: boolean;
}

export interface BusOverview {
  day: DayType;
  dayLabel: string;
  mode: "stanica" | "kolodvor" | "nema"; // nema = selo bez linije Samoborčeka
  lines: LineInfo[];
  board: BoardRow[]; // samo za "kolodvor": sljedeći polasci sa Samobor AK
  gen: string | null;
  app: string;
}

// ---------------------------------------------------------------------------
// Dani: radni / subota / nedjelja i blagdan
// ---------------------------------------------------------------------------

/** Uskrs (gregorijanski, anonimni algoritam) → YYYY-MM-DD */
export function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Državni blagdani i neradni dani u Hrvatskoj (Zakon o blagdanima, od 2020.). */
export function holidays(y: number): Set<string> {
  const e = easter(y);
  const fixed = ["01-01", "01-06", "05-01", "05-30", "06-22", "08-05", "08-15", "11-01", "11-18", "12-25", "12-26"];
  return new Set([...fixed.map((md) => `${y}-${md}`), e, addDays(e, 1), addDays(e, 60)]);
}

export function dayType(date: string): DayType {
  const [y, m, d] = date.split("-").map(Number);
  if (holidays(y).has(date)) return "n";
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? "n" : wd === 6 ? "s" : "r";
}

export const DAY_LABEL: Record<DayType, string> = { r: "radni dan", s: "subota", n: "nedjelja i blagdan" };

// ---------------------------------------------------------------------------
// Povezivanje adrese sa stanicama
// ---------------------------------------------------------------------------

/** "Sv. Martin", "Sveti Martin" → "SV MARTIN"; bez dijakritika. */
const placeKey = (s: string) =>
  normalizeText(s).replace(/\./g, " ").replace(/\bSVET[IAO]\b/g, "SV").replace(/\s+/g, " ").trim();

/** Pridjevi uz ime sela koje stanice obično izostavljaju ("Cerje" = Cerje Samoborsko). */
const REGIONAL = /\b(SAMOBORSK[A-Z]*|PODVRSK[A-Z]*|PODOKICK[A-Z]*|PLESIVICK[A-Z]*|POD OKICEM)\b/g;

function villageKeys(village: string): Set<string> {
  const full = placeKey(village);
  const core = full.replace(REGIONAL, " ").replace(/\s+/g, " ").trim();
  return new Set([full, core].filter(Boolean));
}

const ALL_VILLAGE_KEYS = new Set(VILLAGES.flatMap((v) => [...villageKeys(v)]));

/** Mjesto stanice: dio prije " – ", bez "Gornje/Donji…" ("Gornje Rude" → "RUDE"). */
function stopPlaceKeys(stop: string): string[] {
  const head = placeKey(stop.split(/\s+[–—-]\s+/)[0]).replace(/\s+\d+[A-Z]?$/, ""); // "Smerovišće 1", "Klake 1"
  const bare = head.replace(/^(GORNJ[AEI]|DONJ[AEI])\s+/, "");
  return [...new Set([head, bare])];
}

/** Ključ ulice za usporedbu sa stanicama: "Ulica svete Ane" = "Ulica Sv. Ane", "Mirnovečka cesta" = "Mirnovečka". */
const streetCmp = (s: string) =>
  normalizeStreet(s).replace(/\bSVET(E|A|OG|I)\b/g, "SV").replace(/\s+CESTA$/, "").trim();

/** Dijelovi naziva stanice kao ključevi ulica ("Okićka ulica – k.br. 26" → ["OKICKA", "K BR 26"]). */
const stopStreetParts = (stop: string) => stop.split(/\s+[–—]\s+/).map(streetCmp);

/** "ŠMIDHENOVA" ~ "LJUDEVITA ŠMIDHENA", "GAJEVA" ~ "LJUDEVITA GAJA" */
function possessiveMatches(part: string, streetKey: string): boolean {
  const w = /^([A-Z]{3,})(OVA|EVA)\b/.exec(part);
  const words = streetKey.split(" ");
  if (!w || words.length < 2) return false; // samo ime i prezime ("Ulica Gaj" nije "Gajeva")
  const last = words[words.length - 1];
  return last.startsWith(w[1]) && last.length <= w[1].length + 2;
}

export function stopMatchesAddress(stop: string, address: Address): boolean {
  if (address.place !== TOWN) {
    const keys = villageKeys(address.place);
    if (stopPlaceKeys(stop).some((k) => keys.has(k))) return true;
    // korisnik je upisao pravu ulicu u selu: tad i ona vrijedi
    if (address.street === address.place) return false;
  }
  // stanica u selu ("Kladje – Prigorska ulica") nije stanica u gradskoj ulici istog imena
  if (address.place === TOWN && stopPlaceKeys(stop).some((k) => ALL_VILLAGE_KEYS.has(k))) return false;
  const key = streetCmp(address.street);
  return stopStreetParts(stop).some((p) => p === key || possessiveMatches(p, key));
}

// ---------------------------------------------------------------------------
// Sljedeći polasci
// ---------------------------------------------------------------------------

const minutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? +m[1] * 60 + +m[2] : NaN;
};

function parseDeparture(raw: string, f: Record<string, string> | undefined): Departure {
  const m = /^(\d{1,2}:\d{2})\s*(.*)$/.exec(raw.trim());
  if (!m) return { time: raw };
  const mark = m[2].trim();
  const note = mark ? f?.[mark] : undefined;
  return note ? { time: m[1], note } : { time: m[1] };
}

/** Do `count` polazaka od `nowMin` danas; ako ih nema, prvi sutrašnji. */
function nextFor(line: BusLine, dir: number, today: string, nowMin: number, count: number): { next: Departure[]; tomorrow: boolean } {
  const todayTimes = (line.t[dayType(today)]?.[dir] ?? []).filter((t) => minutes(t) >= nowMin);
  if (todayTimes.length) return { next: todayTimes.slice(0, count).map((t) => parseDeparture(t, line.f)), tomorrow: false };
  const tomorrow = addDays(today, 1);
  const tm = line.t[dayType(tomorrow)]?.[dir] ?? [];
  return { next: tm.slice(0, count).map((t) => parseDeparture(t, line.f)), tomorrow: true };
}

const isAK = (s: string | undefined) => !!s && placeKey(s) === "SAMOBOR AK";

/**
 * Pregled autobusa za adresu. `now` = minute od ponoći po zagrebačkom vremenu.
 * Linija je "vaša" ako joj neka stanica odgovara naselju ili ulici. U gradu bez
 * takve stanice prikazujemo sljedeće polaske s autobusnog kolodvora (Samobor AK).
 */
export function busOverview(data: BusData, address: Address, today: string, nowMin: number, count = 3): BusOverview {
  const lines: LineInfo[] = [];
  for (const line of data.l) {
    // smjer bez popisa stanica (npr. S2 "Iz Grdanjaca") ne možemo povezati s adresom
    const stop = line.d.flatMap((d) => d.st).find((s) => stopMatchesAddress(s, address));
    if (!stop) continue;
    const dirs: DirectionNext[] = [];
    line.d.forEach((d, i) => {
      if (!d.st.length) return;
      // kružna linija koja kreće i završava na kolodvoru: jedan smjer, ostaje
      dirs.push({ h: d.h, from: d.st[0], to: d.st[d.st.length - 1], ...nextFor(line, i, today, nowMin, count) });
    });
    lines.push({ id: line.id, name: line.n, stop, note: line.x ?? null, src: line.src ?? null, dirs });
  }
  lines.sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")));

  const board: BoardRow[] = [];
  if (!lines.length && address.place === TOWN) {
    for (const line of data.l) {
      line.d.forEach((d, i) => {
        if (!isAK(d.st[0]) || isAK(d.st[d.st.length - 1])) return; // samo odlasci s kolodvora, bez kružnih
        const { next, tomorrow } = nextFor(line, i, today, nowMin, 6);
        for (const dep of next) board.push({ ...dep, line: line.id, to: d.st[d.st.length - 1], tomorrow });
      });
    }
    board.sort((a, b) => Number(a.tomorrow) - Number(b.tomorrow) || minutes(a.time) - minutes(b.time));
    board.splice(8);
  }

  const day = dayType(today);
  return {
    day,
    dayLabel: DAY_LABEL[day],
    mode: lines.length ? "stanica" : address.place === TOWN ? "kolodvor" : "nema",
    lines,
    board,
    gen: data.gen ?? null,
    app: BUS_APP,
  };
}

/** Minute od ponoći u Zagrebu. */
export function nowMinutesZagreb(now = new Date()): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zagreb", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(now)
    .split(":")
    .map(Number);
  return (h % 24) * 60 + m;
}

// ---------------------------------------------------------------------------
// Dohvat (predmemorija u D1, kao kod odvoza)
// ---------------------------------------------------------------------------

export async function fetchBus(
  db: D1Database,
  fetcher: typeof fetch = fetch,
  maxAgeMs = 6 * 3600_000,
): Promise<{ data: BusData; fetchedAt: string } | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'bus_data'").first<{ value: string }>();
  const cached = row ? (JSON.parse(row.value) as { data: BusData; fetchedAt: string }) : null;
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return cached;
  try {
    const res = await fetcher(BUS_URL, { headers: { "User-Agent": "samobor-hub (+https://opticora.hr)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as BusData;
    if (!Array.isArray(data?.l) || !data.l.length) throw new Error("neočekivan format");
    const fresh = { data, fetchedAt: new Date().toISOString() };
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('bus_data', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(fresh))
      .run();
    return fresh;
  } catch (e) {
    console.warn("autobusi: dohvat nije uspio, koristim spremljenu kopiju", e);
    return cached;
  }
}
