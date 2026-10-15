import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { articlesToItems, isEventLike, parseArticle, parseNewsLinks } from "../src/sources/gradnovosti";
import { najaveOverview } from "../src/sources/najave";

const here = dirname(fileURLToPath(import.meta.url));
const ART = readFileSync(join(here, "fixtures/samobor-novost-n12766.html"), "utf8");
const LIST = readFileSync(join(here, "fixtures/samobor-visit-isjecak.html"), "utf8");
const URL_ = "https://www.samobor.hr/grad/proslava-dana-grada-samobora-n12766";

test("popis: poveznice na novosti, apsolutne, bez ponavljanja i bez kalendara", () => {
  assert.deepEqual(parseNewsLinks(LIST).map((l) => l.id), [12781, 12766, 12671]);
  assert.equal(parseNewsLinks(LIST)[1].url, URL_);
});

test("novost: naslov, uvod, datum objave, program (PDF), entiteti", () => {
  const a = parseArticle(ART, URL_, true)!;
  assert.equal(a.id, 12766);
  assert.equal(a.title, "Proslava Dana grada Samobora");
  assert.equal(a.intro, "Samobor slavi 784. rođendan uz koncerte, tradiciju i bogat program za sve generacije");
  assert.equal(a.published, "2026-10-06");
  assert.deepEqual(a.pdf, { url: "https://www.samobor.hr/storage/upload/novosti/gradsamobor_program_online_143746.pdf", label: "Program proslave Dana grada Samobora" });
  assert.match(a.text, /središnja događanja/);
  assert.match(a.text, /„Plac pod cirkvom“ – Festival/);
  assert.equal(parseArticle("<html>nije novost</html>", URL_, true), null);
});

test("Dan grada se prikazuje do 18. 10., s izvorom i programom", () => {
  const a = parseArticle(ART, URL_, true)!;
  assert.ok(isEventLike(a)); // s /grad, ali je o koncertima
  const n = najaveOverview(articlesToItems([a]), "2026-10-15");
  assert.equal(n.length, 1);
  assert.equal(n[0].from, "2026-10-16");
  assert.equal(n[0].until, "2026-10-18");
  assert.equal(n[0].source, "samobor.hr");
  assert.equal(n[0].pdf?.label, "Program proslave Dana grada Samobora");
  assert.equal(najaveOverview(articlesToItems([a]), "2026-10-19").length, 0);
});

test("novost s /grad koja nije o događanju se ne prikazuje", () => {
  const a = parseArticle(ART.replace(/Proslava Dana grada Samobora<\/h1>/, "Stipendije za učenike i studente</h1>").replace(/<p class="intro">[^<]*/, '<p class="intro">Natječaj je otvoren do 30. listopada'), URL_, true)!;
  assert.ok(!isEventLike(a));
  assert.ok(isEventLike({ ...a, eventsOnly: false })); // s /visit se prikazuje
});
