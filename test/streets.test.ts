import { test } from "node:test";
import assert from "node:assert/strict";
import {
  streetKeyMatches,
  houseMatches,
  matchNotice,
  normalizePlace,
  normalizeStreet,
  parseStreetList,
} from "../src/core/streets";
import type { Notice } from "../src/core/types";

const names = (raw: string) => parseStreetList(raw).streets.map((s) => s.name);

test("normalizacija naziva ulica iz različitih izvora", () => {
  assert.equal(normalizeStreet("Ulica grada Wirgesa"), "GRADA WIRGESA");
  assert.equal(normalizeStreet("GRADA WIRGESA"), "GRADA WIRGESA");
  assert.equal(normalizeStreet("Ul. grada Wirgesa"), "GRADA WIRGESA");
  assert.equal(normalizeStreet("Šmidhenova ulica"), "SMIDHENOVA");
  assert.equal(normalizeStreet("Ulica 151. samoborske brigade HV"), "151 SAMOBORSKE BRIGADE HV");
  assert.equal(normalizeStreet("RUĐERA BOŠKOVIĆA"), "RUDERA BOSKOVICA");
  assert.equal(normalizePlace("Sv. Nedelja"), normalizePlace("SVETA NEDELJA"));
});

test("osnovni rasponi s paritetom i 'do kraja'", () => {
  const { streets } = parseStreetList(
    "ČAKOVEČKA 1-36 obje, MARIBORSKA 2-24 par, 1-do kraja nep, MARIBORSKI ODVOJAK",
  );
  assert.deepEqual(streets.map((s) => s.name), ["ČAKOVEČKA", "MARIBORSKA", "MARIBORSKI ODVOJAK"]);
  assert.deepEqual(streets[1].specs, [
    { kind: "range", from: 2, to: 24, parity: "par" },
    { kind: "range", from: 1, to: null, parity: "nep" },
  ]);
  assert.deepEqual(streets[2].specs, []); // cijela ulica
});

test("broj ispred nove ulice pripada prethodnoj ulici", () => {
  const { streets } = parseStreetList(
    "TRPINJSKA 13-23 obje, 23/A DIVKA BUDAKA 2/A, 4-16 par, 1/A, 1/B, 1/C, 5-17 nep",
  );
  assert.deepEqual(streets.map((s) => s.name), ["TRPINJSKA", "DIVKA BUDAKA"]);
  assert.deepEqual(streets[0].specs[1], { kind: "single", number: "23/A" });
  assert.equal(streets[1].specs.length, 6);
});

test("rimski brojevi i redni brojevi su dio naziva", () => {
  assert.deepEqual(
    names("SAVSKI GAJ I 2-16 par, 1-19 nep, SAVSKI GAJ II, SAVSKI GAJ III 1-11 obje"),
    ["SAVSKI GAJ I", "SAVSKI GAJ II", "SAVSKI GAJ III"],
  );
  assert.deepEqual(
    names("I. PETRUŠEVEC III ODVOJAK 40-do kraja par, I. PETRUŠEVEC IV ODVOJAK 26-do kraja par"),
    ["I. PETRUŠEVEC III ODVOJAK", "I. PETRUŠEVEC IV ODVOJAK"],
  );
  assert.deepEqual(names("151. SAMOBORSKE BRIGADE HV 1-20 obje"), ["151. SAMOBORSKE BRIGADE HV"]);
});

test("tipfeleri: '76.78' i '68/ A'", () => {
  const a = parseStreetList("IVANJOREČKA CESTA 76.78 par, 5").streets[0];
  assert.deepEqual(a.specs[0], { kind: "range", from: 76, to: 78, parity: "par" });
  const b = parseStreetList("SLAVONSKA AVENIJA 68, 68/ A, 72, 72/B").streets[0];
  assert.deepEqual(
    b.specs.map((s) => (s.kind === "single" ? s.number : "")),
    ["68", "68/A", "72", "72/B"],
  );
});

test("skraćeni popis bez razmaka je partial", () => {
  const r = parseStreetList("KSAVERSKA,MIHALJEVAC,MLINOVI...");
  assert.equal(r.partial, true);
  assert.deepEqual(r.streets.map((s) => s.name), ["KSAVERSKA", "MIHALJEVAC", "MLINOVI"]);
});

// Stvarni unosi iz terenskih jedinica izvan Zagreba (V. Gorica, Zelina, 13.–16.10.2026.)
const describe = (raw: string) =>
  parseStreetList(raw).streets.map(
    (s) =>
      s.name +
      (s.specs.length
        ? " " + s.specs
            .map((p) => (p.kind === "range" ? `${p.from}-${p.to ?? "*"}${p.parity === "obje" ? "" : " " + p.parity}` : p.number))
            .join("; ")
        : ""),
  );

test("proza: 'od k. br.', 'i', 'te', 'u cijelosti'", () => {
  assert.deepEqual(
    describe("Vladimira Nazora od k. br. 10-44 i od k. br. 5-29 te Kijevska i Zagrebačka ulica u cijelosti."),
    ["Vladimira Nazora 10-44; 5-29", "Kijevska", "Zagrebačka ulica"],
  );
  assert.deepEqual(
    describe("Turopoljsko-Posavskog odreda od k. br. 87-117 i od k. br. 84-120 te Vodovodna ulica u cijelosti"),
    ["Turopoljsko-Posavskog odreda 87-117; 84-120", "Vodovodna ulica"],
  );
});

test("proza: 'kč.br.' zalijepljen za broj, slovo na kraju raspona, točka na kraju", () => {
  assert.deepEqual(describe("SOP BUKEVSKI od kč.br. 1-31A."), ["SOP BUKEVSKI 1-31"]);
  assert.deepEqual(describe("ČIČKA POLJANA od kč.br.1-29 i 2-26."), ["ČIČKA POLJANA 1-29; 2-26"]);
  assert.deepEqual(describe("LAZINA ČIČKA od kč.br. 92-150 i 97A-149."), ["LAZINA ČIČKA 92-150; 97-149"]);
  assert.deepEqual(
    describe("SELNICA ŠČITARJEVSKA od kč.br.18A-102A, 17 i 27-103K"),
    ["SELNICA ŠČITARJEVSKA 18-102; 17; 27-103"],
  );
});

test("proza: točka-zarez, zagrade, crtica kao separator, redni broj odvojka", () => {
  assert.deepEqual(
    describe("ČIČKA POLJANA od kč.br.116-204 i KUČE; ULICA FRANJE LUČIĆA 200 (ODRANSKI RIBIĆ)"),
    ["ČIČKA POLJANA 116-204", "KUČE", "ULICA FRANJE LUČIĆA 200"],
  );
  assert.deepEqual(
    describe("RIBNICA; ULICA HRVATSKOG PROLJEĆA od kč.br.116-140 i 153-181, MIRNA ULICA, GRADSKA ULICA, DROBNJAKOVA ULICA, GRGAREVA ULICA, KIŠEVA ULICA i KIŠEVA ULICA 1. ODVOJAK."),
    ["RIBNICA", "ULICA HRVATSKOG PROLJEĆA 116-140; 153-181", "MIRNA ULICA", "GRADSKA ULICA",
     "DROBNJAKOVA ULICA", "GRGAREVA ULICA", "KIŠEVA ULICA", "KIŠEVA ULICA 1. ODVOJAK"],
  );
  assert.deepEqual(describe("VUGROVEC GORNJI -Vukasova ulica"), ["VUGROVEC GORNJI", "Vukasova ulica"]);
  // "ULICA X" i "X ULICA" daju isti ključ kao korisnikova adresa
  const keys = parseStreetList("MIRNA ULICA, ULICA BRODEC").streets.map((s) => s.key);
  assert.deepEqual(keys, [normalizeStreet("Mirna ulica"), normalizeStreet("Brodec")]);
});

test("Zaprešić/Dugo Selo: dvotočka, zalijepljeni paritet, 'SVE ULICE', tipfeler", () => {
  // stvarni unos 12.10.2026., Elektra Zagreb, TJ Zaprešić
  assert.deepEqual(
    describe("BRDOVEC:BREGOVITA ULICA 125, ULICA ILIJE GREGORIĆA 134-152 par, 154-162 par, ŠUMSKA ULICA 2-42 parPRIGORJE BRDOVEČKO:ZAGREBAČKA 2-4 par, ŠUMSKA 1-1"),
    ["BRDOVEC", "BREGOVITA ULICA 125", "ULICA ILIJE GREGORIĆA 134-152 par; 154-162 par",
     "ŠUMSKA ULICA 2-42 par", "PRIGORJE BRDOVEČKO", "ZAGREBAČKA 2-4 par", "ŠUMSKA 1-1"],
  );
  assert.deepEqual(describe("BRDOVEC : BREGOVITA ULICA 125"), ["BRDOVEC", "BREGOVITA ULICA 125"]);
  assert.deepEqual(parseStreetList("SVE ULICE").streets, []);
  assert.equal(normalizeStreet("VOĆARSKAULICA"), normalizeStreet("Voćarska ulica"));

  // "SVE ULICE" za Kusanovec pogađa svaku adresu u Kusanovcu
  const all = notice(["KUSANOVEC"], "SVE ULICE");
  assert.equal(matchNotice(all, { place: "Kusanovec", street: "Bilo koja" }), "place");
  // Mjesto kao prefiks s dvotočkom ne znači cijelo mjesto
  const brd = notice(["BRDOVEC", "PRIGORJE BRDOVECKO"], "BRDOVEC:BREGOVITA ULICA 125, ŠUMSKA ULICA 2-42 parPRIGORJE BRDOVEČKO:ZAGREBAČKA 2-4 par");
  assert.equal(matchNotice(brd, { place: "Brdovec", street: "Šumska ulica", houseNumber: "10" }), "address");
  assert.equal(matchNotice(brd, { place: "Brdovec", street: "Lipova", houseNumber: "10" }), null);
});

test("proza: 'od X do Y' i opisni paritet", () => {
  assert.deepEqual(describe("Gajeva od 10 do 30 parni, od 1 do 15 neparni"), ["Gajeva 10-30 par; 1-15 nep"]);
});

test("poklapanje kućnih brojeva", () => {
  const specs = parseStreetList("X 2-24 par, 1-do kraja nep, 30/A").streets[0].specs;
  assert.equal(houseMatches(specs, "10"), true);
  assert.equal(houseMatches(specs, "26"), false); // izvan parnog raspona
  assert.equal(houseMatches(specs, "999"), true); // neparni do kraja
  assert.equal(houseMatches(specs, "30/A"), true);
  assert.equal(houseMatches(specs, "30"), false); // 30/A ≠ 30
  assert.equal(houseMatches(specs, "10B"), true); // 10B je u rasponu po osnovnom broju
  assert.equal(houseMatches(specs, undefined), true); // bez broja → javi
  assert.equal(houseMatches([], "5"), true); // cijela ulica
});

function notice(places: string[], raw: string): Notice {
  const { streets, partial } = parseStreetList(raw);
  return {
    id: "x", source: "hep", kind: "struja-planirano", date: "2026-10-15",
    start: "08:00", end: "12:00", places, streets, rawStreets: raw,
    note: null, partial, url: "",
  };
}

test("matchNotice: adresa u Samoboru i u selu", () => {
  const n = notice(["SAMOBOR"], "GRADA WIRGESA 2-20 par, PERKOVČEVA 1-15 nep");
  assert.equal(matchNotice(n, { place: "Samobor", street: "Ulica grada Wirgesa", houseNumber: "12" }), "address");
  assert.equal(matchNotice(n, { place: "Samobor", street: "Ulica grada Wirgesa", houseNumber: "13" }), null);
  assert.equal(matchNotice(n, { place: "Samobor", street: "Perkovčeva" }), "street");
  assert.equal(matchNotice(n, { place: "Samobor", street: "Gajeva", houseNumber: "1" }), null);

  // Selo gdje je ulica = naziv naselja ("Rude 92A")
  const rude = notice(["RUDE"], "RUDE 80-100 par");
  assert.equal(matchNotice(rude, { place: "Rude", street: "Rude", houseNumber: "92A" }), "address");
  assert.equal(matchNotice(rude, { place: "Rude", street: "Rude", houseNumber: "91" }), null);
  // Ista ulica u drugom naselju ne smije se poklopiti
  assert.equal(matchNotice(rude, { place: "Samobor", street: "Rude", houseNumber: "92" }), null);
});

test("matchNotice: cijelo naselje i skraćeni popis", () => {
  const whole = notice(["BREGANA"], "");
  assert.equal(matchNotice(whole, { place: "Bregana", street: "Bistračka" }), "place");
  assert.equal(matchNotice(whole, { place: "Samobor", street: "Bistračka" }), null);

  // Samo naziv sela = cijelo selo, bez obzira na korisnikovu ulicu
  const village = notice(["KRIZEVCEC"], "KRIŽEVĆEC");
  assert.equal(matchNotice(village, { place: "Križevćec", street: "Lipovečka" }), "place");
  assert.equal(matchNotice(village, { place: "Samobor", street: "Lipovečka" }), null);

  // Naziv mjesta kao prefiks ispred ulica NE znači cijelo mjesto
  const prefixed = notice(["RIBNICA"], "RIBNICA; ULICA BRODEC, MIRNA ULICA");
  assert.equal(matchNotice(prefixed, { place: "Ribnica", street: "Mirna ulica" }), "street");
  assert.equal(matchNotice(prefixed, { place: "Ribnica", street: "Gajeva" }), null);

  const cut = notice(["SAMOBOR"], "GAJEVA,LIVADIĆEVA,MLINSKA...");
  assert.equal(matchNotice(cut, { place: "Samobor", street: "Mlinska" }), "street");
  assert.equal(matchNotice(cut, { place: "Samobor", street: "Starogradska" }), "place");
});

test("skraćeni nazivi iz HEP-a: prezime, inicijal, bez 'grada'", () => {
  assert.equal(streetKeyMatches("NAZORA", "VLADIMIRA NAZORA"), true);
  assert.equal(streetKeyMatches("I PERKOVCA", "IVANA PERKOVCA"), true);
  assert.equal(streetKeyMatches("WIRGESA", "GRADA WIRGESA"), true);
  assert.equal(streetKeyMatches("V NAZORA", "VLADIMIRA NAZORA"), true);
  // ne smije spojiti različite ulice
  assert.equal(streetKeyMatches("NAZORA", "NAZOROVA ODVOJAK"), false);
  assert.equal(streetKeyMatches("ODVOJAK", "NAZOROVA ODVOJAK"), false);
  assert.equal(streetKeyMatches("GAJ", "SAVSKI GAJ"), false);
  assert.equal(streetKeyMatches("SAVSKI GAJ", "SAVSKI GAJ III"), false);
  assert.equal(streetKeyMatches("A PERKOVCA", "IVANA PERKOVCA"), false);
  assert.equal(streetKeyMatches("IVANA PERKOVCA", "PERKOVCA"), false);
});
