import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchHepDay, HEP_SAMOBOR, hepUrl, parseHepHtml, toNotices } from "../src/sources/hep";
import { dateRange, todayZagreb } from "../src/core/dates";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf-8");

test("URL za Samobor", () => {
  assert.equal(
    hepUrl(HEP_SAMOBOR, "2026-10-15"),
    "https://www.hep.hr/ods/bez-struje/19?dp=zagreb&el=115&datum=15.10.2026",
  );
});

test("prazan dan ('Nema planiranih prekida')", () => {
  assert.deepEqual(parseHepHtml(fixture("hep-samobor-14.10.2026.html")), []);
});

test("promijenjena struktura stranice baca grešku umjesto tihog praznog rezultata", () => {
  assert.throws(() => parseHepHtml("<html><body>Održavanje</body></html>"), /radwrap/);
});

test("stvarni podaci 14.10.2026: 4 unosa, vremena, ulice", async () => {
  const raw = parseHepHtml(fixture("hep-zg-14.10.2026.html"));
  assert.equal(raw.length, 4);
  assert.equal(raw[0].mjesto, "SESVETE");
  assert.equal(raw[0].kada, "09:00 - 10:00");
  assert.equal(raw[0].tip, "planirani");

  const notices = await toNotices(raw, "2026-10-14", "u");
  assert.equal(notices[0].start, "09:00");
  assert.equal(notices[0].end, "10:00");
  assert.deepEqual(notices[0].places, ["SESVETE"]);
  assert.deepEqual(
    notices[0].streets.map((s) => s.name),
    ["ČAKOVEČKA", "MARIBORSKA", "MARIBORSKI ODVOJAK", "PLANINSKA", "TRAKOŠČANSKA", "PAVLA LONČARA"],
  );
  // ID-ovi su jedinstveni i stabilni
  const again = await toNotices(raw, "2026-10-14", "u");
  assert.deepEqual(notices.map((n) => n.id), again.map((n) => n.id));
  assert.equal(new Set(notices.map((n) => n.id)).size, 4);
});

test("stvarni podaci 10.10.2026: kvar s napomenom i skraćenim popisom", async () => {
  const notices = await toNotices(parseHepHtml(fixture("hep-zg-10.10.2026.html")), "2026-10-10", "u");
  assert.equal(notices.length, 2);
  assert.equal(notices[0].note, "KVAR NA 10kV VODU");
  assert.equal(notices[0].kind, "struja-kvar"); // označeno kao "planirani", ali je kvar
  assert.equal(notices[0].partial, true);
  assert.equal(notices[1].kind, "struja-planirano");
  assert.equal(notices[1].note, null);
});

test("stvarni podaci 15. i 16.10.2026: svi unosi se parsiraju bez gubitaka", async () => {
  const d15 = await toNotices(parseHepHtml(fixture("hep-zg-15.10.2026.html")), "2026-10-15", "u");
  assert.equal(d15.length, 7);
  const d16 = await toNotices(parseHepHtml(fixture("hep-zg-16.10.2026.html")), "2026-10-16", "u");
  assert.equal(d16.length, 4);
  assert.deepEqual(d16[0].places, ["IVANJA REKA", "SESVETE"]);
  assert.deepEqual(
    d16[1].streets.map((s) => s.name),
    ["REMETINEČKA CESTA", "SAVSKI GAJ I", "SAVSKI GAJ II", "SAVSKI GAJ III", "SAVSKI GAJ IV", "SAVSKI GAJ V"],
  );
  // Nijedna "ulica" ne smije biti broj ili paritet, to bi značilo da je parser pogriješio
  for (const n of [...d15, ...d16]) {
    for (const s of n.streets) {
      assert.match(s.name, /[A-ZČĆĐŠŽ]{2,}/, `sumnjiv naziv ulice: "${s.name}"`);
      assert.doesNotMatch(s.name, /\b(par|nep|obje)\b/);
    }
  }
});

test("fetchHepDay koristi ispravan URL i parsira odgovor", async () => {
  let called = "";
  const fakeFetch = (async (url: string) => {
    called = url;
    return new Response(fixture("hep-zg-16.10.2026.html"), { status: 200 });
  }) as unknown as typeof fetch;
  const notices = await fetchHepDay(HEP_SAMOBOR, "2026-10-16", fakeFetch);
  assert.match(called, /el=115&datum=16\.10\.2026$/);
  assert.equal(notices.length, 4);
});

test("datumi u zagrebačkoj zoni", () => {
  // 23:30 UTC 14.10. je već 15.10. u Zagrebu (UTC+2)
  assert.equal(todayZagreb(new Date("2026-10-14T23:30:00Z")), "2026-10-15");
  assert.deepEqual(dateRange("2026-10-30", 3), ["2026-10-30", "2026-10-31", "2026-11-01"]);
});
