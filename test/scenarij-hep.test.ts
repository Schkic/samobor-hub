// Scenarij prije objave: nova HEP najava za Samobor (u stvarnom obliku HEP-ove stranice)
// mora stići točno onim adresama koje pogađa, a ne cijelom gradu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHepHtml, toNotices } from "../src/sources/hep";
import { planPushes, pushPayload, type Subscription } from "../src/core/push";

const unos = (mjesto: string, ulice: string, kada: string) => `
  <div class="mjesto tipR">
    <div class="grad"><strong>Mjesto:</strong> ${mjesto}</div>
    <div class="ulica"><strong>Ulica:</strong> ${ulice} </div>
  </div>
  <div class="vrijeme tipR"><strong>Očekivano trajanje:</strong>
    <div class="kada">${kada}</div>
    <div class="tip">Radovi: planirani</div>
  </div>
  <div class="clear"></div><hr>`;

const HTML = `<html><body><h1>Bez struje</h1><div Class="radwrap">
  ${unos("SAMOBOR", "WIRGESA 2-20 par, MLINSKA 1-15 nep, I. PERKOVCA", "08:30 - 13:00")}
  ${unos("RUDE", "RUDE 80-100 par", "09:00 - 11:00")}
</div></body></html>`;

const sub = (id: string, place: string, street: string, houseNumber?: string): Subscription => ({
  id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a",
  address: { place, street, houseNumber }, topics: ["struja", "voda"],
});

test("scenarij: nova HEP najava pogađa samo navedene ulice i kućne brojeve", async () => {
  const notices = await toNotices(parseHepHtml(HTML), "2026-10-20", "u");
  assert.equal(notices.length, 2);

  const pretplate = [
    sub("wirges12", "Samobor", "Ulica grada Wirgesa", "12"), // parni u 2-20 → da
    sub("wirges13", "Samobor", "Ulica grada Wirgesa", "13"), // neparni → ne
    sub("wirges22", "Samobor", "Ulica grada Wirgesa", "22"), // izvan raspona → ne
    sub("mlinska5", "Samobor", "Mlinska ulica", "5"),        // neparni u 1-15 → da
    sub("mlinska6", "Samobor", "Mlinska ulica", "6"),        // parni → ne
    sub("perkovca", "Samobor", "Ulica Ivana Perkovca", "30"),// cijela ulica → da
    sub("bez-broja", "Samobor", "Ulica grada Wirgesa"),      // ulica bez broja → da (radije javi)
    sub("drugaulica", "Samobor", "Gajeva ulica", "1"),       // nije na popisu → ne
    sub("rude92a", "Rude", "Rude", "92A"),                   // 92 parni u 80-100 → da
    sub("rude101", "Rude", "Rude", "101"),                   // → ne
    sub("bregana", "Bregana", "Bregana", "1"),               // drugo naselje → ne
  ];
  const plan = planPushes(notices, pretplate, new Set(), "2026-10-15", false);
  const kome = Object.fromEntries(plan.map((p) => [p.sub.id, p.match]));
  assert.deepEqual(kome, {
    wirges12: "address", mlinska5: "address", perkovca: "street", "bez-broja": "street", rude92a: "address",
  });

  // tekst obavijesti: dan i vrijeme isključenja
  const rude = plan.find((p) => p.sub.id === "rude92a")!;
  const poruka = pushPayload(rude, "2026-10-15");
  assert.equal(poruka.title, "Uto 20.10. bez struje 09:00–11:00");
  assert.equal(poruka.body, "Radovi HEP-a obuhvaćaju Rude 92A.");

  // isti podaci u sljedećem pokretanju: nema ponovnog slanja
  const poslano = new Set(plan.map((p) => `${p.notice.id}|${p.sub.id}|${p.kind}`));
  assert.deepEqual(planPushes(notices, pretplate, poslano, "2026-10-15", false), []);
});
