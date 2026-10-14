import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { busOverview, dayType, easter, nowMinutesZagreb, stopMatchesAddress, type BusData } from "../src/sources/bus";

// Isječak stvarnog data.json aplikacije Autobusi (12.10.2026.): linije S1, S2, S6, S15, S16
const here = dirname(fileURLToPath(import.meta.url));
const DATA: BusData = JSON.parse(readFileSync(join(here, "fixtures/autobusi-2026-10-12.json"), "utf8"));
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

test("vrsta dana: radni, subota, nedjelja i blagdani (i pomični)", () => {
  assert.equal(easter(2026), "2026-04-05");
  assert.equal(easter(2027), "2027-03-28");
  assert.equal(dayType("2026-10-14"), "r"); // srijeda
  assert.equal(dayType("2026-10-17"), "s");
  assert.equal(dayType("2026-10-18"), "n");
  assert.equal(dayType("2026-11-18"), "n"); // Dan sjećanja na Vukovar, srijeda
  assert.equal(dayType("2026-04-06"), "n"); // Uskrsni ponedjeljak
  assert.equal(dayType("2026-06-04"), "n"); // Tijelovo
  assert.equal(dayType("2026-08-05"), "n");
});

test("stanice ↔ adresa: sela, 'Gornje Rude', ulice u gradu", () => {
  const rude = { place: "Rude", street: "Rude", houseNumber: "92A" };
  assert.ok(stopMatchesAddress("Rude – centar", rude));
  assert.ok(stopMatchesAddress("Gornje Rude", rude));
  assert.ok(!stopMatchesAddress("Rudarska draga – Kristal", rude));
  assert.ok(stopMatchesAddress("Lug Samoborski", { place: "Lug Samoborski", street: "Lug Samoborski" }));
  assert.ok(stopMatchesAddress("Cerje – k.br. 57", { place: "Cerje Samoborsko", street: "Cerje Samoborsko" }));
  assert.ok(stopMatchesAddress("Sv. Martin – pošta", { place: "Sveti Martin pod Okićem", street: "Sveti Martin pod Okićem" }));
  assert.ok(stopMatchesAddress("Otok – okretište", { place: "Samoborski Otok", street: "Samoborski Otok" }));
  assert.ok(stopMatchesAddress("Smerovišće 1", { place: "Smerovišće", street: "Smerovišće" }));
  const grad = (street: string) => ({ place: "Samobor", street });
  assert.ok(stopMatchesAddress("Zagrebačka ulica", grad("Zagrebačka ulica")));
  assert.ok(stopMatchesAddress("Ulica Ivana Perkovca – k.br. 11", grad("Ulica Ivana Perkovca")));
  assert.ok(stopMatchesAddress("Ulica Sv. Ane – groblje", grad("Ulica svete Ane")));
  assert.ok(stopMatchesAddress("Mirnovečka – vojarna", grad("Mirnovečka cesta")));
  assert.ok(stopMatchesAddress("Samobor – Šmidhenova", grad("Ulica Ljudevita Šmidhena")));
  assert.ok(stopMatchesAddress("Samobor – Gajeva-pošta", grad("Ulica Ljudevita Gaja")));
  assert.ok(!stopMatchesAddress("Samobor – Gajeva-pošta", grad("Ulica grada Wirgesa")));
  assert.ok(!stopMatchesAddress("Rude – centar", grad("Zagrebačka ulica")));
  assert.ok(!stopMatchesAddress("Samobor – Gajeva-pošta", grad("Ulica Gaj")));
  assert.ok(!stopMatchesAddress("Kladje – Prigorska ulica", grad("Prigorska ulica")));
  assert.ok(stopMatchesAddress("Celine – centar", { place: "Celine Samoborske", street: "Celine Samoborske" }));
  assert.equal(busOverview(DATA, { place: "Slapnica", street: "Slapnica" }, "2026-10-14", 600).mode, "nema");
});

test("Rude u srijedu u 15:00: S6 u oba smjera, sljedeća tri polaska", () => {
  const o = busOverview(DATA, { place: "Rude", street: "Rude", houseNumber: "92A" }, "2026-10-14", hm("15:00"));
  assert.equal(o.mode, "stanica");
  assert.equal(o.day, "r");
  assert.deepEqual(o.lines.map((l) => l.id), ["S6"]);
  const [iz, prema] = o.lines[0].dirs;
  assert.equal(iz.h, "Iz Samobora");
  assert.deepEqual(iz.next.map((d) => d.time), ["15:20", "16:30", "17:20"]);
  assert.equal(prema.to, "Samobor AK");
  assert.deepEqual(prema.next.map((d) => d.time), ["15:25", "15:50", "16:55"]);
  assert.equal(prema.tomorrow, false);
});

test("kasno navečer: sutrašnji polasci, i to prema vrsti sutrašnjeg dana", () => {
  // petak 16.10. u 23:00 → sutra je subota
  const o = busOverview(DATA, { place: "Rude", street: "Rude" }, "2026-10-16", hm("23:00"));
  const iz = o.lines[0].dirs[0];
  assert.equal(iz.tomorrow, true);
  assert.deepEqual(iz.next.map((d) => d.time), ["3:55", "5:10", "6:10"]);
});

test("fusnote i linija koja vikendom ne vozi", () => {
  const lug = busOverview(DATA, { place: "Lug Samoborski", street: "Lug Samoborski" }, "2026-10-14", hm("4:30"));
  const s2 = lug.lines.find((l) => l.id === "S2")!;
  assert.equal(s2.dirs.length, 2); // smjer bez stanica ("Iz Grdanjaca") se ne prikazuje
  assert.deepEqual(s2.dirs[0].next[0], { time: "4:35", note: "vozi do Grdanjaca" });

  // S15 u subotu: nema polazaka danas; nedjelja je također prazna, pa prazan popis + napomena
  const g = busOverview(DATA, { place: "Grdanjci", street: "Grdanjci" }, "2026-10-17", hm("8:00"));
  const s15 = g.lines.find((l) => l.id === "S15")!;
  assert.equal(s15.note, "Subotom, nedjeljom i blagdanima linija ne prometuje!");
  assert.equal(s15.dirs[0].next.length, 0);
});

test("ulica u gradu bez stanice: sljedeći polasci s kolodvora", () => {
  const o = busOverview(DATA, { place: "Samobor", street: "Ulica grada Wirgesa", houseNumber: "12" }, "2026-10-14", hm("15:00"));
  assert.equal(o.mode, "kolodvor");
  assert.equal(o.lines.length, 0);
  assert.equal(o.board.length, 8);
  assert.deepEqual(o.board.slice(0, 3).map((b) => `${b.time} ${b.line}`), ["15:00 S2", "15:15 S2", "15:20 S6"]);
  assert.ok(o.board.every((b) => b.line !== "S1")); // kružna linija nije "odlazak"
  // ulica sa stanicom: linija
  const z = busOverview(DATA, { place: "Samobor", street: "Zagrebačka ulica" }, "2026-10-14", hm("15:00"));
  assert.deepEqual(z.lines.map((l) => l.id), ["S1"]);
});

test("minute u Zagrebu", () => {
  assert.equal(nowMinutesZagreb(new Date("2026-10-14T13:05:00Z")), 15 * 60 + 5); // CEST
  assert.equal(nowMinutesZagreb(new Date("2026-12-14T23:30:00Z")), 30); // CET, iza ponoći
});
