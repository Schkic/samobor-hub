import type { Notice } from "../core/types";
import { normalizePlace, parseStreetList } from "../core/streets";
import { noticeId } from "../core/id";

/**
 * HEP ODS "Bez struje":
 *   https://www.hep.hr/ods/bez-struje/19?dp=zagreb&el=115&datum=DD.MM.YYYY
 * dp=zagreb → Elektra Zagreb, el=115 → terenska jedinica Samobor.
 * Stranica nudi otprilike tjedan dana unaprijed; zahtjev ne treba kolačiće.
 */
export const HEP_BASE = "https://www.hep.hr/ods/bez-struje/19";

export interface HepUnit {
  dp: string; // distribucijsko područje
  el: string; // terenska jedinica
}

export const HEP_SAMOBOR: HepUnit = { dp: "zagreb", el: "115" };

/** "2026-10-15" → "15.10.2026" */
export function toHepDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function hepUrl(unit: HepUnit, isoDate: string): string {
  return `${HEP_BASE}?dp=${unit.dp}&el=${unit.el}&datum=${toHepDate(isoDate)}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Izvuče vrijednost polja "<strong>Label:</strong> vrijednost" unutar bloka. */
function field(block: string, label: string): string | null {
  const re = new RegExp(
    `<strong>\\s*${label}\\s*:\\s*</strong>([\\s\\S]*?)</div>`,
    "i",
  );
  const m = re.exec(block);
  return m ? textOf(m[1]) : null;
}

export interface HepRawEntry {
  mjesto: string;
  ulica: string;
  napomena: string | null;
  kada: string;
  tip: string;
}

/** Čisti parser HTML-a, bez mreže, da se može testirati na spremljenim stranicama. */
export function parseHepHtml(html: string): HepRawEntry[] {
  // class/Class: HEP koristi "Class" za radwrap, ostalo malim slovima
  const start = html.search(/class\s*=\s*"radwrap"/i);
  if (start === -1) throw new Error("HEP: nije pronađen blok radwrap, struktura stranice se promijenila");

  const body = html.slice(start);
  if (/Nema planiranih prekida/i.test(body.slice(0, 500))) return [];

  // Svaki unos: div.mjesto (grad, ulica, napomena) pa div.vrijeme (kada, tip), odvojeni <hr>
  const entries: HepRawEntry[] = [];
  const blockRe = /<div class="mjesto[^"]*">([\s\S]*?)<div class="vrijeme[^"]*">([\s\S]*?)<hr/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body)) !== null) {
    const [, mjestoBlock, vrijemeBlock] = m;
    const kada = /<div class="kada">([\s\S]*?)<\/div>/i.exec(vrijemeBlock);
    const tip = /<div class="tip">([\s\S]*?)<\/div>/i.exec(vrijemeBlock);
    entries.push({
      mjesto: field(mjestoBlock, "Mjesto") ?? "",
      ulica: field(mjestoBlock, "Ulica") ?? "",
      napomena: field(mjestoBlock, "Napomena"),
      kada: kada ? textOf(kada[1]) : "",
      tip: tip ? textOf(tip[1]).replace(/^Radovi:\s*/i, "") : "",
    });
  }
  return entries;
}

function parseTimes(kada: string): { start: string | null; end: string | null } {
  const m = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(kada);
  if (!m) return { start: null, end: null };
  const pad = (t: string) => t.padStart(5, "0");
  return { start: pad(m[1]), end: pad(m[2]) };
}

export async function toNotices(
  entries: HepRawEntry[],
  isoDate: string,
  url: string,
): Promise<Notice[]> {
  const out: Notice[] = [];
  for (const e of entries) {
    const { streets, partial } = parseStreetList(e.ulica);
    const { start, end } = parseTimes(e.kada);
    const places = e.mjesto
      .split(",")
      .map((p) => normalizePlace(p))
      .filter(Boolean);
    // HEP i kvarove ponekad označi kao "planirani", ali ih otkriva napomena
    const isFault = /kvar/i.test(e.napomena ?? "") || /nepredvi|kvar/i.test(e.tip);
    out.push({
      id: await noticeId("hep", isoDate, `${e.mjesto}|${e.ulica}|${e.kada}`),
      source: "hep",
      kind: isFault ? "struja-kvar" : "struja-planirano",
      date: isoDate,
      start,
      end,
      places,
      streets,
      rawStreets: e.ulica,
      note: e.napomena,
      partial,
      url,
    });
  }
  return out;
}

export async function fetchHepDay(
  unit: HepUnit,
  isoDate: string,
  fetcher: typeof fetch = fetch,
): Promise<Notice[]> {
  const url = hepUrl(unit, isoDate);
  const res = await fetcher(url, {
    headers: { "User-Agent": "samobor-hub (+https://opticora.hr)" },
  });
  if (!res.ok) throw new Error(`HEP ${isoDate}: HTTP ${res.status}`);
  const html = await res.text();
  return toNotices(parseHepHtml(html), isoDate, url);
}
