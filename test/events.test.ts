import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eventsOverview, parseCalendarHtml } from "../src/sources/events";

const here = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(here, "fixtures/samobor-kalendar-2026-10-15.html"), "utf8");

test("kalendar: parsiranje stvarnih kartica", () => {
  const ev = parseCalendarHtml(HTML);
  assert.equal(ev.length, 4);
  const [kreativni, izlozba, viking, mia] = ev;

  assert.equal(kreativni.title, "Kreativni ponedjeljak");
  assert.equal(kreativni.category, "Radionice");
  assert.deepEqual(kreativni.dates, [{ date: "2026-10-05", time: "17:00" }]);
  assert.equal(kreativni.location, null);
  assert.equal(kreativni.organizer, "Gradska knjižnica Samobor Odjel za odrasle");
  assert.equal(kreativni.url, "https://www.samobor.hr/knjiznica/kreativni-ponedjeljak-n12723");

  assert.equal(izlozba.dates.length, 32); // desktop popis se ne broji dvaput
  assert.deepEqual(izlozba.dates[0], { date: "2026-10-14", time: "19:00" });
  assert.deepEqual(izlozba.dates[31], { date: "2026-11-14", time: null });

  assert.equal(viking.location, "Kino dvorana POU Samobor");
  assert.equal(viking.note, "Prodaja ulaznica na ulaznice.hr i blagajna Kina Samobor");
  assert.equal(viking.url, "https://teatarexit.hr/predstave/viking-slabog-zdravlja");

  assert.equal(mia.title, "HALLOWEEN U KINU: Čudovišna Mia");
  assert.deepEqual(mia.dates.map((d) => d.time), ["11:00", "17:00"]);
  assert.equal(mia.url, null); // nema "opširnije"
});

test("kalendar: otkazani događaj", () => {
  const html = HTML.replace("Viking slabog zdravlja</div>", "Građanski utorak: Otkazano zbog nepredvidivih okolnosti Stanovnici i predaja Samobora</div>");
  const e = parseCalendarHtml(html)[2];
  assert.equal(e.cancelled, true);
  assert.equal(e.title, "Građanski utorak: Stanovnici i predaja Samobora");
});

test("pregled: sljedećih 7 dana i izložbe u tijeku", () => {
  const ev = parseCalendarHtml(HTML);
  const o = eventsOverview(ev, "2026-10-14", 7, "09:00");
  assert.deepEqual(o.upcoming.map((u) => `${u.date} ${u.time} ${u.title}`), [
    "2026-10-14 19:00 Otvorenje: Autoportret grada",
    "2026-10-14 20:00 Viking slabog zdravlja",
  ]);
  assert.deepEqual(o.ongoing.map((x) => `${x.title} do ${x.until}`), ["Autoportret grada do 2026-11-14"]);

  // navečer je predstava već počela, a sutra je samo izložba u tijeku
  assert.equal(eventsOverview(ev, "2026-10-14", 7, "20:30").upcoming.length, 1);
  const sutra = eventsOverview(ev, "2026-10-15", 7);
  assert.equal(sutra.upcoming.length, 0);
  assert.equal(sutra.ongoing.length, 1);

  // Halloween ulazi u prozor tek tjedan ranije, oba termina
  assert.deepEqual(eventsOverview(ev, "2026-10-25", 7).upcoming.map((u) => u.time), ["11:00", "17:00"]);
});

test("kalendar: prazna ili promijenjena stranica je greška", () => {
  assert.throws(() => parseCalendarHtml("<html><body>Održavanje</body></html>"), /struktura/);
});
