import type { Address, HouseSpec, Notice, Parity, StreetSegment } from "./types";

// ---------------------------------------------------------------------------
// Normalizacija
// ---------------------------------------------------------------------------

const DIACRITICS: Record<string, string> = {
  Č: "C", Ć: "C", Đ: "D", Š: "S", Ž: "Z",
  č: "c", ć: "c", đ: "d", š: "s", ž: "z",
};

/** Velika slova, bez hrvatske (i ostale) dijakritike, sažeti razmaci. */
export function normalizeText(s: string): string {
  return s
    .replace(/[ČĆĐŠŽčćđšž]/g, (c) => DIACRITICS[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ključ za uspoređivanje naziva ulica iz različitih izvora:
 * "Ulica grada Wirgesa" (odvoz), "GRADA WIRGESA" (HEP) i "Ul. grada Wirgesa"
 * daju isti ključ. Točke se brišu ("151. samoborske brigade" → "151 SAMOBORSKE BRIGADE").
 */
export function normalizeStreet(s: string): string {
  let n = normalizeText(s).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  n = n
    .replace(/^(ULICA|UL)\s+/, "")
    .replace(/\s+ULICA$/, "")
    // tipfeler bez razmaka: "VOĆARSKAULICA" → "VOCARSKA"
    .replace(/([A-Z]{3,})ULICA$/, "$1");
  return n;
}

/** Ključ naselja; "Sv. Nedelja" i "SVETA NEDELJA" daju isto. */
export function normalizePlace(s: string): string {
  return normalizeText(s)
    .replace(/\./g, " ")
    .replace(/\bSV\b/g, "SVETA")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Parser popisa ulica (HEP format)
// ---------------------------------------------------------------------------

// Paritet je uvijek malim slovima (nazivi ulica u HEP-ovim popisima su velikim
// ili s velikim početnim slovom), pa se ne miješa s nazivima.
const PARITY_WORDS: Record<string, Parity> = {
  par: "par", parni: "par", parne: "par", "par.": "par",
  nep: "nep", neparni: "nep", neparne: "nep", "nep.": "nep",
  obje: "obje",
};

// Veznici koji u prozi odvajaju ulice ili raspone ("10-44 i 5-29 te Kijevska").
// Samo malim slovima: veliko "I" je rimski broj ("SAVSKI GAJ I").
const SEPARATOR_WORDS = new Set([",", ";", "i", "te"]);

/**
 * Prozni oblik koji pišu terenske jedinice izvan Zagreba svodi na isti oblik
 * kao zagrebački: "Nazora od k. br. 10-44 i od k. br. 5-29 te Kijevska ulica u cijelosti."
 * → "Nazora 10-44 i 5-29 te Kijevska ulica".
 */
function normalizeProse(text: string): string {
  return (
    text
      // napomene u zagradama: "(ODRANSKI RIBIĆ)"
      .replace(/\([^)]*\)/g, " ")
      // "od 10 do 44" → "10-44"
      .replace(/\bod\s+(\d+[A-Z]?)\s+do\s+(\d+[A-Z]?)\b/gi, "$1-$2")
      // "od k. br.", "od kč.br.", "k.br.", "kbr" ispred brojeva
      .replace(/(?<!\p{L})(?:od\s+)?(?:k\.?\s*č|k)\.?\s*br\.?\s*/giu, " ")
      // "kućni brojevi"
      .replace(/(?<!\p{L})kućn\p{L}*\s+broj\p{L}*/giu, " ")
      // preostali "od" ispred broja: "od 92-150"
      .replace(/(?<!\p{L})od\s+(?=\d)/giu, "")
      // "u cijelosti" / "cijela ulica" znači cijelu ulicu, a to je ionako zadano
      .replace(/(?<!\p{L})u\s+cijelosti(?!\p{L})/giu, " ")
      // "SVE ULICE", "cijelo naselje": prazan popis = cijelo mjesto
      .replace(/(?<!\p{L})(?:sve\s+ulice|cijel[oa]\s+(?:naselje|mjesto|selo))(?!\p{L})/giu, " ")
      // "2-42 parPRIGORJE BRDOVEČKO": HEP zna zalijepiti paritet za sljedeći naziv
      .replace(/(\d\s*(?:par|nep|obje))(?=[A-ZČĆĐŠŽ])/g, "$1 , ")
      // "bb" (bez broja) nije ni ulica ni broj
      .replace(/(?<!\p{L})bb(?!\p{L})/giu, " ")
      // "VUGROVEC GORNJI -Vukasova ulica": crtica s razmakom ispred slova je separator
      .replace(/\s+-\s*(?=\p{L})/gu, " , ")
      // točka na kraju segmenta ("1-31A.", "ODVOJAK.") — redni brojevi "1. ODVOJAK" ostaju
      .replace(/\.(?=\s*(?:[,;]|$))/g, "")
  );
}

/** "68/ A" → "68/A"; "2/B" i "2B" ostaju kakvi jesu, samo velikim slovima. */
function normalizeHouse(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

function baseNumber(house: string): number | null {
  const m = /^(\d+)/.exec(house);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Token koji predstavlja kućni broj ili raspon: počinje znamenkom i nije redni
 * broj ("151." je dio naziva ulice, ne kućni broj).
 */
const HOUSE_TOKEN = /^\d+[A-Z]?(?:\/[A-Z0-9]+)?(?:-(?:\d+[A-Z]?|\*))?$/i;

/**
 * Parsira HEP-ov slobodni tekst ulica u segmente. Primjeri koje podržava:
 *   "ČAKOVEČKA 1-36 obje, MARIBORSKA 2-24 par, 1-do kraja nep, MARIBORSKI ODVOJAK"
 *   "TRPINJSKA 13-23 obje, 23/A DIVKA BUDAKA 2/A, 4-16 par"   (23/A pripada Trpinjskoj)
 *   "SAVSKI GAJ III 1-11 obje"                                  (rimski broj je dio naziva)
 *   "IVANJOREČKA CESTA 76.78 par"                               (tipfeler za 76-78)
 *   "SLAVONSKA AVENIJA 68, 68/ A, 72"                           (razmak iza kose crte)
 */
export function parseStreetList(raw: string): { streets: StreetSegment[]; partial: boolean } {
  let text = raw.trim();
  const partial = /\.\.\.|…/.test(text);
  text = normalizeProse(text.replace(/\.\.\.|…/g, ""));

  text = text
    // "1-do kraja", "1 - do kraja" → "1-*"
    .replace(/(\d)\s*-\s*do\s+kraja/gi, "$1-*")
    // "76.78" → "76-78" (točka između dva broja je tipfeler za crticu)
    .replace(/(\d)\.(\d)/g, "$1-$2")
    // "13 - 23" → "13-23"
    .replace(/(\d)\s+-\s+(\d)/g, "$1-$2")
    // "68/ A" → "68/A"
    .replace(/(\d)\s*\/\s*([A-Z0-9])/gi, "$1/$2")
    // zarez, točka-zarez i dvotočka ("BRDOVEC:BREGOVITA ULICA") kao separatori
    .replace(/[,;:]/g, " , ");

  const tokens = text.split(/\s+/).filter(Boolean);
  const streets: StreetSegment[] = [];
  let current: StreetSegment | null = null;
  let prevWasWord = false;

  for (const tok of tokens) {
    if (SEPARATOR_WORDS.has(tok)) {
      prevWasWord = false;
      continue;
    }

    const parity = PARITY_WORDS[tok]; // paritet je malim slovima, nazivi ulica velikim
    if (parity) {
      const last = current?.specs[current.specs.length - 1];
      if (last?.kind === "range") last.parity = parity;
      prevWasWord = false;
      continue;
    }

    if (HOUSE_TOKEN.test(tok)) {
      if (current) current.specs.push(parseHouseToken(tok));
      prevWasWord = false;
      continue;
    }

    // Riječ (dio naziva ulice): nastavlja naziv ako je i prethodni token bio riječ.
    if (current && prevWasWord) {
      current.name += " " + tok;
    } else {
      current = { name: tok, key: "", specs: [] };
      streets.push(current);
    }
    prevWasWord = true;
  }

  for (const s of streets) s.key = normalizeStreet(s.name);
  return { streets, partial };
}

function parseHouseToken(tok: string): HouseSpec {
  const dash = tok.indexOf("-");
  if (dash === -1) return { kind: "single", number: normalizeHouse(tok) };
  const from = baseNumber(tok.slice(0, dash)) ?? 0;
  const toPart = tok.slice(dash + 1);
  const to = toPart === "*" ? null : baseNumber(toPart);
  // Bez navedenog pariteta: konzervativno pretpostavljamo obje strane.
  return { kind: "range", from, to, parity: "obje" };
}

// ---------------------------------------------------------------------------
// Poklapanje s adresom korisnika
// ---------------------------------------------------------------------------

export function houseMatches(specs: HouseSpec[], houseNumber?: string): boolean {
  if (specs.length === 0) return true; // cijela ulica
  if (!houseNumber) return true; // ne znamo broj → bolje javiti nego propustiti
  const house = normalizeHouse(houseNumber);
  const n = baseNumber(house);

  return specs.some((spec) => {
    if (spec.kind === "single") {
      // "23/A" pogađa samo 23/A; "23" pogađa 23, ali i 23A/23/A jer je to isti priključak
      if (spec.number === house) return true;
      return /^\d+$/.test(spec.number) && baseNumber(spec.number) === n && n !== null;
    }
    if (n === null) return false;
    if (n < spec.from) return false;
    if (spec.to !== null && n > spec.to) return false;
    if (spec.parity === "par") return n % 2 === 0;
    if (spec.parity === "nep") return n % 2 === 1;
    return true;
  });
}

export type MatchLevel = "address" | "street" | "place" | null;

/**
 * Pogađa li obavijest adresu?
 *  - "address": ulica i kućni broj su u popisu
 *  - "street":  ulica je u popisu, a kućni broj nije poznat
 *  - "place":   obavijest je za cijelo naselje (bez popisa ulica) ili je popis skraćen
 *  - null:      ne pogađa
 */
export function matchNotice(notice: Notice, addr: Address): MatchLevel {
  const place = normalizePlace(addr.place);
  const streetKey = normalizeStreet(addr.street);

  const placeOk =
    notice.places.length === 0 || notice.places.some((p) => p === place);

  // Segment koji je samo naziv mjesta, bez kućnih brojeva:
  //  - jedini segment ("KRIŽEVĆEC")             → cijelo mjesto
  //  - prefiks ispred ulica ("RIBNICA; ULICA…")  → samo kaže gdje su ulice, ignorira se
  const placeKeys = new Set(notice.places.map((p) => normalizeStreet(p)));
  const isPlaceOnly = (s: StreetSegment) => s.specs.length === 0 && placeKeys.has(s.key);
  const streets = notice.streets.filter((s) => !isPlaceOnly(s));
  const wholePlace = notice.streets.length > 0 && streets.length === 0;

  const hit = streets.find((s) => s.key === streetKey);
  if (hit) {
    // HEP navodi mjesto kao širi pojam (npr. ZAGREB za cijelu jedinicu), pa ulica
    // može biti pogođena i kad se naselje ne podudara doslovno. Ipak zahtijevamo
    // poklapanje mjesta kad ulica postoji u više naselja (npr. "Rude" i "Samobor").
    if (!placeOk && notice.places.length > 0) return null;
    if (!houseMatches(hit.specs, addr.houseNumber)) return null;
    return addr.houseNumber && hit.specs.length > 0 ? "address" : "street";
  }

  if (!placeOk) return null;
  if (notice.streets.length === 0 || wholePlace) return "place";
  // Skraćen popis ("KSAVERSKA,MIHALJEVAC,MLINOVI...") može sadržavati našu ulicu.
  if (notice.partial) return "place";
  return null;
}
