import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mentionedDates, najaveOverview, parseRss } from "../src/sources/najave";

const here = dirname(fileURLToPath(import.meta.url));
const ITEMS = parseRss(readFileSync(join(here, "fixtures/radiosamobor-najave.xml"), "utf8"));

test("RSS: naslov, poveznica, datum objave, opis bez [...]", () => {
  assert.equal(ITEMS.length, 5);
  assert.equal(ITEMS[0].title, "Povezivanje tradicije s glazbom koja tek nastaje");
  assert.equal(ITEMS[0].published, "2026-09-16");
  assert.match(ITEMS[2].text, /"Greblicu"/);
  assert.doesNotMatch(ITEMS[0].text, /…$/);
});

test("datumi iz teksta: rasponi, dani u tjednu, prijelaz godine", () => {
  assert.deepEqual(mentionedDates(ITEMS[0].text, ITEMS[0].published), ["2026-09-27"]); // "od 18. do 27. rujna": 18. nema mjesec
  assert.deepEqual(mentionedDates(ITEMS[3].text, ITEMS[3].published), ["2026-07-03", "2026-07-12"]);
  assert.deepEqual(mentionedDates(ITEMS[2].text, ITEMS[2].published), []); // "dolazeće subote"
  assert.deepEqual(mentionedDates("Koncert 5. siječnja", "2026-12-20"), ["2027-01-05"]);
  assert.deepEqual(mentionedDates("Ožujak: 12. ožujka i 1. Studenoga", "2026-03-01"), ["2026-03-12", "2026-11-01"]);
});

test("što se prikazuje: samo buduće, bez datuma tek 10 dana", () => {
  assert.deepEqual(najaveOverview(ITEMS, "2026-09-20").map((n) => `${n.title} ${n.from}–${n.until}`), [
    "Povezivanje tradicije s glazbom koja tek nastaje 2026-09-27–2026-09-27",
  ]);
  assert.equal(najaveOverview(ITEMS, "2026-09-28").length, 0);
  // 2. 7.: Greblica (bez datuma, objavljeno 1. 7.) i Ljeto (3.–12. 7.); jazz je prošao, Youngmasters je izvještaj
  assert.deepEqual(najaveOverview(ITEMS, "2026-07-02").map((n) => n.title), ["Greblica u najboljim godinama", "Ljeto za sve generacije"]);
  assert.deepEqual(najaveOverview(ITEMS, "2026-07-15").map((n) => n.title), []);
  // izvještaj (spominje samo datum prije objave) se ne prikazuje ni odmah nakon objave
  assert.ok(!najaveOverview(ITEMS, "2026-08-25").some((n) => n.title === "Samobor ponovno u znaku glazbe"));
});
