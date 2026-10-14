/**
 * Zajednički format obavijesti za sve izvore (HEP, VIO, Komunalac, odvoz...).
 * Svaki izvor parsira svoj format u Notice[], a ostatak hub-a (baza, API,
 * push) radi samo s ovim tipom.
 */

export type SourceId = "hep" | "vio" | "komunalac" | "odvoz";

export type Parity = "par" | "nep" | "obje";

/** Dio ulice koji je pogođen. Ulica bez ikakvih specifikacija = cijela ulica. */
export type HouseSpec =
  | { kind: "range"; from: number; to: number | null; parity: Parity } // to=null → "do kraja"
  | { kind: "single"; number: string }; // točan kućni broj, npr. "23/A", "2E/1"

export interface StreetSegment {
  /** Naziv kako ga je izvor napisao, npr. "TRPINJSKA". */
  name: string;
  /** Normalizirani ključ za uspoređivanje, vidi normalizeStreet(). */
  key: string;
  /** Prazno = cijela ulica. */
  specs: HouseSpec[];
}

export interface Notice {
  /** Stabilni ID (hash izvora, datuma i sirovog teksta), za deduplikaciju. */
  id: string;
  source: SourceId;
  /** Tip događaja, npr. "struja-planirano", "struja-kvar", "voda". */
  kind: string;
  /** YYYY-MM-DD */
  date: string;
  /** "HH:MM" ili null ako izvor ne navodi vrijeme. */
  start: string | null;
  end: string | null;
  /** Naselja/mjesta, normalizirana (velika slova, bez dijakritike). */
  places: string[];
  /** Pogođene ulice. Prazno = cijelo mjesto. */
  streets: StreetSegment[];
  /** Izvorni tekst popisa ulica, za prikaz korisniku. */
  rawStreets: string;
  note: string | null;
  /** true kad je popis ulica skraćen ("...") pa se ne može vjerovati da je potpun. */
  partial: boolean;
  url: string;
}

/** Adresa korisnika kako je spremljena u aplikaciji. */
export interface Address {
  place: string; // naselje, npr. "Samobor", "Rude"
  street: string; // npr. "Ulica grada Wirgesa", "Rude"
  houseNumber?: string; // npr. "92A"
}
