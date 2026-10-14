import type { HouseSpec } from "../core/types";
import { houseMatches, normalizeStreet } from "../core/streets";

/**
 * Raspored odvoza otpada. Izvor je javni data.json aplikacije za odvoz
 * (odvoz-otpada-samobor.opticora.hr), koji hub samo čita, nikad ne mijenja.
 * Podaci potječu iz Komunalčeve "Obavijesti o sakupljanju komunalnog otpada".
 */
export const ODVOZ_URL = "https://odvoz-otpada-samobor.opticora.hr/data.json";

export interface OdvozData {
  y: number[]; // godine u rasporedu
  x?: Record<string, string>; // pomaknuti termini: novi datum → izvorni datum (blagdani)
  p: Record<string, ZoneSchedule>; // zona → raspored
  s: Record<string, { n: string; z: [string, string][] }>; // ključ ulice → zone s napomenom
  l: { n: string; q: string; t: "u" | "n"; k: string }[]; // popis ulica (u) i naselja (n)
}

interface ZoneSchedule {
  m?: string[]; // miješani komunalni otpad
  b?: string[]; // biootpad
  p?: string[]; // papir i plastika/metal isti dan (gradske zone)
  pa?: string[]; // papir i karton
  pe?: string[]; // plastika i metal
  r?: [string, string, string][]; // mobilno reciklažno dvorište: [datum, vrijeme, lokacija]
}

export type WasteType = "m" | "b" | "pa" | "pe";
export const WASTE_LABEL: Record<WasteType, string> = {
  m: "Miješani otpad",
  b: "Biootpad",
  pa: "Papir i karton",
  pe: "Plastika i metal",
};
const ORDER: WasteType[] = ["m", "b", "pa", "pe"];

// ---------------------------------------------------------------------------
// Napomene o zonama → kućni brojevi
// ---------------------------------------------------------------------------

/**
 * "od kbr. 2 do 52 - parni i od kbr. 1 do 139 – neparni" → dva raspona.
 * Vraća null kad napomena ne navodi kućne brojeve ("od Ulice Ivana Perkovca do
 * Ulice Ferka Ivanščaka"), pa se zona ne može odrediti iz broja.
 */
export function zoneNoteSpecs(note: string): HouseSpec[] | null {
  if (!note.trim()) return []; // prazna napomena = cijela ulica
  let t = note
    .replace(/\([^)]*\)/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/kraja ulice/gi, "kraja")
    .replace(/\bbroja\b/gi, " ");
  const specs: HouseSpec[] = [];

  // Rasponi: "[od|do] [kbr.] A do [kbr.] B|kraja", iza kojih može doći "- parni/neparni"
  const range = /(?:\b(?:od|do)\s+)?(?:kbr\.?\s*)?(\d+[A-Z]?)\s+do\s+(?:kbr\.?\s*)?(\d+[A-Z]?|kraja)\b([^\d]{0,24}?\b(neparni|parni)\b)?/gi;
  t = t.replace(range, (_m, from: string, to: string, _p, parity?: string) => {
    specs.push({
      kind: "range",
      from: parseInt(from, 10),
      to: /kraja/i.test(to) ? null : parseInt(to, 10),
      parity: parity ? (parity.toLowerCase() === "parni" ? "par" : "nep") : "obje",
    });
    return " ";
  });

  // Pojedinačni brojevi: "kbr. 1A i 2", "34/1", "3, 5A, 5B"
  for (const m of t.matchAll(/\b(\d+[A-Z]?(?:\/\d+)?)\b/gi)) {
    specs.push({ kind: "single", number: m[1].toUpperCase() });
  }
  return specs.length ? specs : null;
}

export interface ZoneChoice {
  zone: string;
  note: string;
}

export interface ZoneResolution {
  zone: string | null; // null = korisnik mora odabrati
  options: ZoneChoice[];
}

/** Odredi zonu odvoza za adresu. */
export function resolveZone(
  data: OdvozData,
  place: string,
  street: string,
  houseNumber?: string,
  chosen?: string,
): ZoneResolution {
  if (place !== "Samobor") {
    // naselja imaju vlastitu zonu istog imena
    return { zone: data.p[place] ? place : null, options: [] };
  }
  const key = normalizeStreet(street);
  const entry = Object.entries(data.s).find(([, v]) => normalizeStreet(v.n) === key)?.[1];
  if (!entry) return { zone: null, options: [] };

  const options = entry.z.map(([zone, note]) => ({ zone, note }));
  if (options.length === 1) return { zone: options[0].zone, options };
  if (chosen && options.some((o) => o.zone === chosen)) return { zone: chosen, options };
  if (houseNumber) {
    const hits = options.filter((o) => {
      const specs = zoneNoteSpecs(o.note);
      return specs !== null && specs.length > 0 && houseMatches(specs, houseNumber);
    });
    if (hits.length === 1) return { zone: hits[0].zone, options };
  }
  return { zone: null, options };
}

// ---------------------------------------------------------------------------
// Raspored za zonu
// ---------------------------------------------------------------------------

export interface PickupDay {
  date: string;
  types: WasteType[];
  movedFrom?: string; // izvorni datum ako je termin pomaknut zbog blagdana
}

export interface ZoneOverview {
  zone: string;
  next: { type: WasteType; label: string; date: string | null }[]; // sljedeći odvoz po vrsti
  days: PickupDay[]; // svi odvozi od danas do `until`
  yard: { date: string; time: string; place: string }[]; // mobilno reciklažno dvorište
  lastDate: string | null; // zadnji datum u rasporedu
}

export function zoneOverview(data: OdvozData, zone: string, today: string, until: string): ZoneOverview | null {
  const z = data.p[zone];
  if (!z) return null;
  const byType: Record<WasteType, string[]> = {
    m: z.m ?? [],
    b: z.b ?? [],
    pa: z.pa ?? z.p ?? [],
    pe: z.pe ?? z.p ?? [],
  };
  const next = ORDER.filter((t) => byType[t].length).map((t) => ({
    type: t,
    label: WASTE_LABEL[t],
    date: byType[t].find((d) => d >= today) ?? null,
  }));
  const map = new Map<string, WasteType[]>();
  for (const t of ORDER) {
    for (const d of byType[t]) {
      if (d < today || d > until) continue;
      map.set(d, [...(map.get(d) ?? []), t]);
    }
  }
  const days = [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, types]) => ({ date, types, ...(data.x?.[date] ? { movedFrom: data.x[date] } : {}) }));
  const yard = (z.r ?? [])
    .filter(([d]) => d >= today)
    .map(([date, time, place]) => ({ date, time, place }));
  const lastDate = ORDER.flatMap((t) => byType[t]).sort().pop() ?? null;
  return { zone, next, days, yard, lastDate };
}

// ---------------------------------------------------------------------------
// Dohvat (s predmemorijom, da hub ne opterećuje stranicu za odvoz)
// ---------------------------------------------------------------------------

export async function fetchOdvoz(
  db: D1Database,
  fetcher: typeof fetch = fetch,
  maxAgeMs = 6 * 3600_000,
): Promise<{ data: OdvozData; fetchedAt: string } | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'odvoz_data'")
    .first<{ value: string }>();
  const cached = row ? (JSON.parse(row.value) as { data: OdvozData; fetchedAt: string }) : null;
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return cached;

  try {
    const res = await fetcher(ODVOZ_URL, { headers: { "User-Agent": "samobor-hub (+https://opticora.hr)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as OdvozData;
    if (!data?.p || !data?.s) throw new Error("neočekivan format");
    const fresh = { data, fetchedAt: new Date().toISOString() };
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('odvoz_data', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(fresh))
      .run();
    return fresh;
  } catch (e) {
    console.warn("odvoz: dohvat nije uspio, koristim spremljenu kopiju", e);
    return cached; // bolje stari raspored nego nikakav
  }
}
