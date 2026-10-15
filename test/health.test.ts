import { test } from "node:test";
import assert from "node:assert/strict";
import { healthAlerts } from "../src/core/health";

const now = new Date("2026-10-15T10:20:00Z"); // 12:20 u Zagrebu
const ok = (ran_at: string) => ({ ok: 1, error: null, ran_at });
const bad = (ran_at: string) => ({ ok: 0, error: "HEP: HTTP 503", ran_at });

test("voda: uzbuna tek kad nema uspješnog dohvata 3 sata, i ne ujutro", () => {
  assert.deepEqual(healthAlerts(now, 12, "2026-10-15T09:20:00Z", []), []);
  const a = healthAlerts(now, 12, "2026-10-15T07:00:00Z", []);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, "vio-stale");
  assert.match(a[0].body, /15\. 10\..*09:00/); // vrijeme po Zagrebu
  assert.deepEqual(healthAlerts(now, 8, "2026-10-14T19:20:00Z", []), []); // prije 10 h nema uzbune
  assert.equal(healthAlerts(now, 12, null, [])[0].key, "vio-stale");
});

test("struja: uzbuna nakon dva neuspjela pokretanja zaredom", () => {
  const vio = "2026-10-15T10:00:00Z";
  assert.deepEqual(healthAlerts(now, 12, vio, [bad("b"), ok("a")]), []);
  const a = healthAlerts(now, 12, vio, [bad("b"), bad("a")]);
  assert.deepEqual(a.map((x) => x.key), ["hep-fail"]);
  assert.match(a[0].body, /HTTP 503/);
});
