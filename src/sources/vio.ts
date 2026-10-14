import type { Notice, StreetSegment } from "../core/types";
import { normalizePlace, normalizeStreet, parseStreetList } from "../core/streets";
import { noticeId } from "../core/id";
import { VILLAGES } from "../data/addresses";

/**
 * Vodoopskrba i odvodnja (VIO), "Privremeni prekid u opskrbi vodom zbog radova".
 * Tablica: DATUM | ULICA | NASELJE | AUTOCISTERNA | PLANIRANO VRIJEME RADOVA | STATUS.
 * Samobor je u VIO-u od 2025. (uslužno područje 11). Za cijelo samoborsko područje
 * stupac NASELJE kaže "SAMOBOR"; selo, ako ga ima, piše u stupcu ULICA ("LUG K.BR 2").
 */
export const VIO_URL = "https://www.vio.hr/obavijesti/privremeni-prekid-u-opskrbi-vodom-zbog-radova/1833";

export interface VioRow {
  datum: string; // "14.10.2026"
  ulica: string;
  naselje: string;
  autocisterna: string;
  vrijeme: string;
  status: string;
}

const strip = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, " ")
    .trim();

export function parseVioHtml(html: string): VioRow[] {
  const table = /<table[^>]*class="[^"]*opskrba[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!table) throw new Error("VIO: tablica prekida nije pronađena, struktura stranice se promijenila");
  const rows: VioRow[] = [];
  for (const tr of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
    if (cells.length < 6) continue; // zaglavlje (th) ili prazan red
    const [datum, ulica, naselje, autocisterna, vrijeme, status] = cells;
    rows.push({ datum, ulica, naselje, autocisterna, vrijeme, status });
  }
  return rows;
}

/** "14.10.2026" → "2026-10-14" */
function isoDate(d: string): string | null {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(d);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** "09.00 - 15.00", "10:55 - 15:00", "14.10.2026\n21:50 - 15:00" */
export function parseVioTime(s: string): { start: string | null; end: string | null } {
  const t = s.replace(/\d{1,2}\.\d{1,2}\.\d{4}/g, " ");
  const m = /(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/.exec(t);
  if (!m) return { start: null, end: null };
  return { start: `${m[1].padStart(2, "0")}:${m[2]}`, end: `${m[3].padStart(2, "0")}:${m[4]}` };
}

const VILLAGE_KEYS = VILLAGES.map((v) => ({ name: v, key: normalizeStreet(v) }));
const SAMOBOR_PLACES = new Set(["SAMOBOR", ...VILLAGES.map(normalizePlace)]);

/** Je li redak sa samoborskog područja? */
export function isSamoborRow(r: VioRow): boolean {
  return r.naselje.split(/[,/]/).some((p) => SAMOBOR_PLACES.has(normalizePlace(p)));
}

/**
 * "LUG" → Lug Samoborski, "RUDE" → Rude: segment koji je naziv (ili početak naziva)
 * sela postaje oznaka mjesta. Vraća selo ili null.
 */
function villageFor(segmentKey: string): string | null {
  const exact = VILLAGE_KEYS.find((v) => v.key === segmentKey);
  if (exact) return exact.name;
  const prefix = VILLAGE_KEYS.filter((v) => v.key.startsWith(segmentKey + " "));
  return prefix.length === 1 ? prefix[0].name : null;
}

export async function vioToNotices(rows: VioRow[], url = VIO_URL): Promise<{ notices: Notice[]; dates: string[] }> {
  const notices: Notice[] = [];
  const dates = new Set<string>();
  for (const r of rows) {
    if (!isSamoborRow(r)) continue;
    const date = isoDate(r.datum);
    if (!date) continue;
    dates.add(date);
    if (/zavr[sš]en/i.test(r.status)) continue; // gotovo, ne prikazujemo

    // "I OKOLNE ULICE" = popis nije potpun
    const okolne = /\bi?\s*okoln\p{L}*\s+ulic\p{L}*/iu;
    const partialText = okolne.test(r.ulica);
    const cleaned = r.ulica.replace(okolne, " ").replace(/,\s*samobor\b/i, " ");
    const parsed = parseStreetList(cleaned);

    // Sela navedena u stupcu ULICA postaju mjesta; njihovi kućni brojevi vrijede za adresu "Selo N"
    const villages: string[] = [];
    const streets: StreetSegment[] = parsed.streets.map((s) => {
      const v = villageFor(s.key);
      if (!v) return s;
      villages.push(v);
      return { name: v, key: normalizeStreet(v), specs: s.specs };
    });
    const places = villages.length ? villages.map(normalizePlace) : ["SAMOBOR"];
    const { start, end } = parseVioTime(r.vrijeme);
    const cisterna = /^da$/i.test(r.autocisterna.trim());

    notices.push({
      id: await noticeId("vio", date, `${r.ulica}|${r.naselje}|${r.vrijeme}`),
      source: "vio",
      kind: "voda",
      date,
      start,
      end,
      places,
      streets,
      rawStreets: r.ulica,
      note: [cisterna ? "Autocisterna će biti na terenu." : null, /tijek/i.test(r.status) ? "Radovi su u tijeku." : null]
        .filter(Boolean)
        .join(" ") || null,
      partial: parsed.partial || partialText,
      url,
    });
  }
  return { notices, dates: [...dates].sort() };
}

export async function fetchVio(fetcher: typeof fetch = fetch) {
  const res = await fetcher(VIO_URL, { headers: { "User-Agent": "samobor-hub (+https://opticora.hr)" } });
  if (!res.ok) throw new Error(`VIO: HTTP ${res.status}`);
  return vioToNotices(parseVioHtml(await res.text()));
}
