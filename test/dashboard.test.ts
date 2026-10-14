import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, type MatchedNotice } from "../src/core/dashboard";
import { planPushes, pushPayload, type Subscription } from "../src/core/push";
import { parseStreetList } from "../src/core/streets";
import type { Notice } from "../src/core/types";
import type { ZoneOverview } from "../src/sources/odvoz";

const mk = (id: string, source: "hep" | "vio", date: string, places: string[], raw: string, extra: Partial<Notice> = {}): Notice => {
  const { streets, partial } = parseStreetList(raw);
  return { id, source, kind: source === "vio" ? "voda" : "struja-planirano", date, start: "08:00", end: "12:00",
    places, streets, rawStreets: raw, note: null, partial, url: "", ...extra };
};

const odvoz: ZoneOverview = {
  zone: "Rude",
  next: [],
  days: [
    { date: "2026-10-19", types: ["m"] },
    { date: "2026-11-21", types: ["pa", "pe"], movedFrom: "2026-11-18" },
  ],
  yard: [{ date: "2026-10-19", time: "14–16", place: "centar" }],
  lastDate: "2026-12-28",
};

test("vremenska crta: isključenja prije odvoza, po danu i satu, s blagdanskim pomakom", () => {
  const struja = { ...mk("s1", "hep", "2026-10-19", ["RUDE"], "RUDE 80-100 par"), match: "address" } as MatchedNotice;
  const voda = { ...mk("v1", "vio", "2026-10-15", ["RUDE"], "RUDE", { start: "10:55", end: "15:00" }), match: "street" } as MatchedNotice;
  const mozda = { ...mk("v2", "vio", "2026-10-16", ["SAMOBOR"], "NAZORA", { partial: true }), match: "place" } as MatchedNotice;

  const t = buildTimeline([struja, voda, mozda], odvoz, "2026-10-14", "2026-11-30");
  assert.deepEqual(t.map((i) => `${i.date} ${i.kind}: ${i.title}`), [
    "2026-10-15 voda: Bez vode 10:55–15:00",
    "2026-10-16 voda: Moguće bez vode 08:00–12:00",
    "2026-10-19 struja: Bez struje 08:00–12:00",
    "2026-10-19 odvoz: Odvoz: miješani otpad",
    "2026-10-19 reciklaza: Mobilno reciklažno dvorište",
    "2026-11-21 odvoz: Odvoz: papir i karton, plastika i metal",
  ]);
  assert.equal(t[0].urgent, true);
  assert.equal(t[1].urgent, false);
  assert.equal(t[5].detail, "Pomaknuto zbog blagdana (umjesto 18. 11.).");
  assert.equal(t[4].detail, "14–16 h, centar");

  // prozor: samo od-do
  assert.equal(buildTimeline([struja, voda], odvoz, "2026-10-16", "2026-10-18").length, 0);
});

const sub = (id: string, place: string, street: string, houseNumber?: string): Subscription =>
  ({ id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a", address: { place, street, houseNumber } });

test("push: 'okolne ulice' u gradu ne ide cijelom gradu, ali ide pogođenoj ulici i selu", () => {
  const grad = mk("v1", "vio", "2026-10-15", ["SAMOBOR"], "VLADIMIRA NAZORA", { partial: true });
  const selo = mk("v2", "vio", "2026-10-15", ["RUDE"], "", { partial: true });
  const subs = [
    sub("nazora", "Samobor", "Ulica Vladimira Nazora", "5"),
    sub("gaja", "Samobor", "Ulica Ljudevita Gaja", "3"),
    sub("rude", "Rude", "Rude", "92A"),
  ];
  const plan = planPushes([grad, selo], subs, new Set(), "2026-10-14", false);
  assert.deepEqual(plan.map((p) => `${p.notice.id}->${p.sub.id}`), ["v1->nazora", "v2->rude"]);
});

test("push: tekst za vodu spominje VIO i autocisternu", () => {
  const v = mk("v1", "vio", "2026-10-15", ["SAMOBOR"], "VLADIMIRA NAZORA", { note: "Autocisterna će biti na terenu." });
  const [p] = planPushes([v], [sub("n", "Samobor", "Ulica Vladimira Nazora", "5")], new Set(), "2026-10-14", false);
  const msg = pushPayload(p, "2026-10-14");
  assert.equal(msg.title, "Sutra bez vode 08:00–12:00");
  assert.match(msg.body, /VIO-a obuhvaćaju Ulica Vladimira Nazora 5/);
  assert.match(msg.body, /Autocisterna/);
});
