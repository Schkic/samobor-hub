import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveZone, zoneNoteSpecs, zoneOverview, type OdvozData } from "../src/sources/odvoz";
import { houseMatches } from "../src/core/streets";

// Isječak stvarnog data.json (odvoz-otpada-samobor.opticora.hr, 14.10.2026.)
const DATA: OdvozData = {
  y: [2026],
  x: { "2026-11-21": "2026-11-18", "2026-12-26": "2026-12-25" },
  l: [],
  p: {
    Rude: {
      pa: ["2026-09-11", "2026-10-09", "2026-11-06", "2026-12-04"],
      pe: ["2026-09-25", "2026-10-23", "2026-11-20", "2026-12-18"],
      m: ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"],
      r: [["2026-10-27", "14–16", "centar"]],
    },
    "Samobor 2": {
      b: ["2026-10-05", "2026-10-19", "2026-11-02", "2026-11-16"],
      p: ["2026-10-07", "2026-10-21", "2026-11-04", "2026-11-21"],
      m: ["2026-10-12", "2026-10-19", "2026-10-26"],
    },
    "Samobor 4": { m: ["2026-10-19"] },
    "Samobor 3": { m: ["2026-10-19"] },
    "Samobor 5": { m: ["2026-10-19"] },
    "Samobor 6": { m: ["2026-10-19"] },
    "Samobor 7": { m: ["2026-10-19"] },
    "Samobor 8": { m: ["2026-10-19"] },
  },
  s: {
    "ljudevita gaja": { n: "Ulica Ljudevita Gaja", z: [["Samobor 3", ""]] },
    "josipa jelacica": { n: "Ulica Josipa Jelačića", z: [
      ["Samobor 2", "od kbr. 2 do 52 - parni i od kbr. 1 do 139 – neparni"],
      ["Samobor 4", "od kbr. 54 do 178 - parni i od kbr. 141 do 205 – neparni"]] },
    "mlinska": { n: "Mlinska ulica", z: [
      ["Samobor 3", "od Ulice Ivana Perkovca do Ulice Ferka Ivanščaka"],
      ["Samobor 7", "od Ulice Ferka Ivanščaka do Ulice grada Wirgesa - od kbr. 16A do 34 i 34/1 - parni i kbr. 7 do 23 – neparni"]] },
    "grada wirgesa": { n: "Ulica grada Wirgesa", z: [
      ["Samobor 3", "od kbr. 12 do 24 – parni"],
      ["Samobor 4", "od Ulica Ante Starčevića do Ulice sveta Helena"],
      ["Samobor 6", "od kbr. 4 do broja 10 (potoka Gradna) - parni"],
      ["Samobor 7", "neparna strana kbr. 3, 5A, 5B, 5C i 5D"],
      ["Samobor 8", "od kbr. 2C do 2H"]] },
    "ivana perkovca": { n: "Ulica Ivana Perkovca", z: [
      ["Samobor 3", "od kbr. 1 do 33 - neparni i od kbr. 2 do 48 - parni"],
      ["Samobor 7", "od kbr. 50 do 106 - parni i do kbr. 35 do 87 – neparni"],
      ["Samobor 8", "od kbr. 108 do kraja ulice - parni i od kbr. 89 do kraja ulice - neparni"]] },
    "obrtnicka": { n: "Obrtnička ulica", z: [["Samobor 3", ""], ["Samobor 5", "1 i 1A"]] },
    "zrinsko frankopanska": { n: "Zrinsko – Frankopanska ulica", z: [["Samobor 6", ""]] },
  },
};

test("napomene o zonama: rasponi, paritet, 'do kraja', pojedinačni brojevi", () => {
  const show = (note: string) =>
    zoneNoteSpecs(note)?.map((s) =>
      s.kind === "range" ? `${s.from}-${s.to ?? "*"}${s.parity === "obje" ? "" : " " + s.parity}` : s.number);

  assert.deepEqual(show("od kbr. 2 do 52 - parni i od kbr. 1 do 139 – neparni"), ["2-52 par", "1-139 nep"]);
  assert.deepEqual(show("od kbr. 50 do 106 - parni i do kbr. 35 do 87 – neparni"), ["50-106 par", "35-87 nep"]);
  assert.deepEqual(show("od kbr. 108 do kraja ulice - parni i od kbr. 89 do kraja ulice - neparni"), ["108-* par", "89-* nep"]);
  assert.deepEqual(show("od kbr. 4 do broja 10 (potoka Gradna) - parni"), ["4-10 par"]);
  assert.deepEqual(show("neparna strana kbr. 3, 5A, 5B, 5C i 5D"), ["3", "5A", "5B", "5C", "5D"]);
  assert.deepEqual(show("kbr. 2 i od kbr. 7 do 13 - neparni"), ["7-13 nep", "2"]);
  assert.deepEqual(show("1 i 1A"), ["1", "1A"]);
  assert.deepEqual(show("od kbr. 1 do 8"), ["1-8"]);
  assert.deepEqual(show("od kbr. 20 do 40 - parni i od kbr. 19a do 31 – neparni odnosno do Halaburščak"), ["20-40 par", "19-31 nep"]);
  assert.deepEqual(show("od Ferka Ivanščaka do Wirgesa - od kbr. 16A do 34 i 34/1 - parni i kbr. 7 do 23 – neparni"), ["16-34", "7-23 nep", "34/1"]);
  assert.equal(zoneNoteSpecs("od Ulice Ivana Perkovca do Ulice Ferka Ivanščaka"), null);
  assert.equal(zoneNoteSpecs("(od Obrtničke ulice)"), null);
  assert.deepEqual(zoneNoteSpecs(""), []);
});

test("zona za selo je samo naziv sela", () => {
  assert.deepEqual(resolveZone(DATA, "Rude", "Rude", "92A"), { zone: "Rude", options: [] });
  assert.equal(resolveZone(DATA, "Nepostojeće", "X").zone, null);
});

test("zona za gradsku ulicu: jedna zona, ili odabir prema kućnom broju", () => {
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Ljudevita Gaja").zone, "Samobor 3");
  assert.equal(resolveZone(DATA, "Samobor", "ZRINSKO-FRANKOPANSKA").zone, "Samobor 6");

  // Jelačićeva: parni do 52 → zona 2, parni od 54 → zona 4, neparni do 139 → zona 2
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Josipa Jelačića", "30").zone, "Samobor 2");
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Josipa Jelačića", "60").zone, "Samobor 4");
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Josipa Jelačića", "141").zone, "Samobor 4");
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Josipa Jelačića", "5B").zone, "Samobor 2");

  // Perkovčeva "do kraja": 120 parni → zona 8
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Ivana Perkovca", "120").zone, "Samobor 8");

  // Bez broja ili s brojem koji napomene ne pokrivaju → korisnik bira
  const bez = resolveZone(DATA, "Samobor", "Ulica Josipa Jelačića");
  assert.equal(bez.zone, null);
  assert.equal(bez.options.length, 2);
  assert.equal(resolveZone(DATA, "Samobor", "Mlinska ulica", "3").zone, null);

  // Mlinska 20 je jedino u zoni 7 (prva zona nema brojeve, pa se ne može usporediti)
  assert.equal(resolveZone(DATA, "Samobor", "Mlinska ulica", "20").zone, "Samobor 7");

  // Ručno odabrana zona ima prednost kad je valjana
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Josipa Jelačića", undefined, "Samobor 4").zone, "Samobor 4");
  assert.equal(resolveZone(DATA, "Samobor", "Ulica Josipa Jelačića", undefined, "Samobor 9").zone, null);
});

test("grada Wirgesa: pet zona, kućni broj bira točno jednu", () => {
  assert.equal(resolveZone(DATA, "Samobor", "Ulica grada Wirgesa", "16").zone, "Samobor 3");
  assert.equal(resolveZone(DATA, "Samobor", "Ulica grada Wirgesa", "8").zone, "Samobor 6");
  assert.equal(resolveZone(DATA, "Samobor", "Ulica grada Wirgesa", "5B").zone, "Samobor 7");
  assert.equal(resolveZone(DATA, "Samobor", "Ulica grada Wirgesa", "2D").zone, "Samobor 8");
  // 2C–2H je raspon unutar broja 2: "2" sam ne odgovara zoni 8, nego nijednoj
  assert.ok(houseMatches(zoneNoteSpecs("od kbr. 2C do 2H")!, "2E"));
});

test("pregled zone: sljedeći odvozi po vrsti, dani, blagdani, reciklažno dvorište", () => {
  const rude = zoneOverview(DATA, "Rude", "2026-10-14", "2026-10-31")!;
  assert.deepEqual(rude.next.map((n) => `${n.type}:${n.date}`), ["m:2026-10-19", "pa:2026-11-06", "pe:2026-10-23"]);
  assert.deepEqual(rude.days.map((d) => `${d.date}:${d.types.join("+")}`), [
    "2026-10-19:m", "2026-10-23:pe", "2026-10-26:m",
  ]);
  assert.deepEqual(rude.yard, [{ date: "2026-10-27", time: "14–16", place: "centar" }]);

  // Gradska zona: "p" znači papir i plastika isti dan; studeni ima blagdanski pomak
  const s2 = zoneOverview(DATA, "Samobor 2", "2026-11-15", "2026-11-30")!;
  assert.deepEqual(s2.days, [
    { date: "2026-11-16", types: ["b"] },
    { date: "2026-11-21", types: ["pa", "pe"], movedFrom: "2026-11-18" },
  ]);
  assert.equal(s2.lastDate, "2026-11-21");
  assert.equal(zoneOverview(DATA, "Nema", "2026-10-14", "2026-10-31"), null);
});

test("podsjetnik večer prije odvoza: samo pretplate s temom odvoz, bez duplikata", async () => {
  const { planOdvozReminders, odvozPayload } = await import("../src/core/push");
  const base = { endpoint: "e", p256dh: "k", auth: "a" };
  const subs = [
    { ...base, id: "da", address: { place: "Rude", street: "Rude", houseNumber: "92A" }, topics: ["odvoz"] as const },
    { ...base, id: "ne", address: { place: "Rude", street: "Rude", houseNumber: "92A" }, topics: ["struja", "voda"] as const },
    // ulica s dvije zone bez kućnog broja i bez odabrane zone: ne nagađamo
    { ...base, id: "nejasno", address: { place: "Samobor", street: "Ulica Josipa Jelačića" }, topics: ["odvoz"] as const },
    { ...base, id: "zona", address: { place: "Samobor", street: "Ulica Josipa Jelačića" }, topics: ["odvoz"] as const, zone: "Samobor 4" },
  ].map((s) => ({ ...s, topics: [...s.topics] }));

  // 19.10. je miješani u Rudama i Samobor 4
  const plan = planOdvozReminders(DATA, subs, new Set(), "2026-10-19");
  assert.deepEqual(plan.map((p) => [p.sub.id, p.zone, p.types]), [
    ["da", "Rude", ["m"]],
    ["zona", "Samobor 4", ["m"]],
  ]);
  assert.match(odvozPayload(plan[0]).title, /^Sutra je odvoz: miješani/i);

  // već poslano → ne šalje opet
  const again = planOdvozReminders(DATA, subs, new Set(["odvoz:Rude:2026-10-19|da|vecer"]), "2026-10-19");
  assert.deepEqual(again.map((p) => p.sub.id), ["zona"]);

  // dan bez odvoza
  assert.equal(planOdvozReminders(DATA, subs, new Set(), "2026-10-20").length, 0);
});

test("podsjetnik za odvoz: svaka zona uređaja jednom, s nazivom adrese", async () => {
  const { planOdvozReminders, odvozPayload } = await import("../src/core/push");
  const s = {
    id: "v", endpoint: "e", p256dh: "k", auth: "a", topics: ["odvoz" as const],
    address: { place: "Rude", street: "Rude" },
    addresses: [
      { label: "Dom", address: { place: "Rude", street: "Rude" } },
      { label: "Roditelji", address: { place: "Samobor", street: "Ulica Josipa Jelačića" }, zone: "Samobor 4" },
      { label: "Vikendica", address: { place: "Rude", street: "Rude", houseNumber: "5" } }, // ista zona kao Dom
    ],
  };
  const plan = planOdvozReminders(DATA, [{ ...s, topics: ["odvoz"] }], new Set(), "2026-10-19");
  assert.deepEqual(plan.map((p) => [p.zone, p.label]), [["Rude", "Dom"], ["Samobor 4", "Roditelji"]]);
  assert.match(odvozPayload(plan[1]).title, /^Sutra je odvoz \(Roditelji\): miješani/i);
});
