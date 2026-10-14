import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVioHtml, parseVioTime, vioToNotices, isSamoborRow, type VioRow } from "../src/sources/vio";
import { matchNotice } from "../src/core/streets";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vio-14.10.2026.html"), "utf-8");
const row = (ulica: string, status = "NAJAVLJENO", naselje = "SAMOBOR", vrijeme = "08:00 - 12:00"): VioRow =>
  ({ datum: "15.10.2026", ulica, naselje, autocisterna: "DA", vrijeme, status });

test("stvarna VIO tablica: 10 redaka, zaglavlje preskočeno", () => {
  const rows = parseVioHtml(html);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], {
    datum: "14.10.2026", ulica: "VLADIMIRA NAZORA I OKOLNE ULICE", naselje: "SAMOBOR",
    autocisterna: "DA", vrijeme: "10:55 - 15:00", status: "U TIJEKU",
  });
  assert.equal(rows.filter(isSamoborRow).length, 3);
  assert.throws(() => parseVioHtml("<html>održavanje</html>"), /tablica/);
});

test("vremena: dvotočka, točka, višednevni radovi", () => {
  assert.deepEqual(parseVioTime("10:55 - 15:00"), { start: "10:55", end: "15:00" });
  assert.deepEqual(parseVioTime("09.00 - 15.00"), { start: "09:00", end: "15:00" });
  assert.deepEqual(parseVioTime("08.30 - 12:00"), { start: "08:30", end: "12:00" });
  assert.deepEqual(parseVioTime("14.10.2026\n21:50 - 15:00"), { start: "21:50", end: "15:00" });
  assert.deepEqual(parseVioTime("cijeli dan"), { start: null, end: null });
});

test("samo samoborski redovi, završeni se ne prikazuju, ali im se datum pamti", async () => {
  const { notices, dates } = await vioToNotices(parseVioHtml(html));
  assert.deepEqual(dates, ["2026-10-13", "2026-10-14"]); // zbog brisanja završenih iz baze
  assert.equal(notices.length, 1);
  const n = notices[0];
  assert.equal(n.kind, "voda");
  assert.equal(n.date, "2026-10-14");
  assert.equal(n.partial, true); // "i okolne ulice"
  assert.deepEqual(n.streets.map((s) => s.name), ["VLADIMIRA NAZORA"]);
  assert.match(n.note!, /Autocisterna/);
  assert.match(n.note!, /u tijeku/);
});

test("adrese: ulica u gradu, selo u stupcu ULICA, 'okolne ulice'", async () => {
  const { notices } = await vioToNotices([
    row("VLADIMIRA NAZORA I OKOLNE ULICE"),
    row("LJUDEVITA POSAVSKOG, LUG K.BR 2"),
    row("Bogumila Tonija, Samobor"),
    row("RUDE 80-100"),
  ]);
  const [nazora, lug, tonija, rude] = notices;

  assert.equal(matchNotice(nazora, { place: "Samobor", street: "Ulica Vladimira Nazora", houseNumber: "5" }), "street");
  assert.equal(matchNotice(nazora, { place: "Samobor", street: "Gajeva" }), "place"); // okolne ulice
  assert.equal(matchNotice(nazora, { place: "Rude", street: "Rude" }), null);

  assert.deepEqual(lug.places, ["LUG SAMOBORSKI"]);
  assert.equal(matchNotice(lug, { place: "Lug Samoborski", street: "Lug Samoborski", houseNumber: "2" }), "address");
  assert.equal(matchNotice(lug, { place: "Lug Samoborski", street: "Lug Samoborski", houseNumber: "4" }), null);

  assert.deepEqual(tonija.streets.map((s) => s.name), ["Bogumila Tonija"]);
  assert.equal(matchNotice(tonija, { place: "Samobor", street: "Ulica Bogumila Tonija" }), "street");

  assert.deepEqual(rude.places, ["RUDE"]);
  assert.equal(matchNotice(rude, { place: "Rude", street: "Rude", houseNumber: "92A" }), "address");
});
