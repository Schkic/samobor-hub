import { dateRange, todayZagreb } from "./core/dates";
import { logRun, syncDay, upcomingNotices } from "./core/store";
import { matchNotice } from "./core/streets";
import type { Address, Notice } from "./core/types";
import {
  deleteSubscription,
  deliver,
  getSubscription,
  getVapidKey,
  saveSubscription,
  sendPush,
} from "./core/push";
import { fetchHepDay, HEP_SAMOBOR } from "./sources/hep";
import { fetchVio } from "./sources/vio";
import { fetchOdvoz, resolveZone, zoneOverview } from "./sources/odvoz";
import { buildTimeline, type MatchedNotice } from "./core/dashboard";
import { TOWN, TOWN_STREETS, VILLAGES } from "./data/addresses";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

/** Koliko dana unaprijed gledamo. HEP objavljuje otprilike tjedan dana. */
const HEP_DAYS_AHEAD = 7;

async function runHep(env: Env): Promise<{ found: number; added: Notice[] }> {
  const days = dateRange(todayZagreb(), HEP_DAYS_AHEAD);
  let found = 0;
  const added: Notice[] = [];
  try {
    for (const day of days) {
      const notices = await fetchHepDay(HEP_SAMOBOR, day);
      found += notices.length;
      added.push(...(await syncDay(env.DB, "hep", day, notices)));
    }
    await logRun(env.DB, "hep", true, found);
  } catch (err) {
    await logRun(env.DB, "hep", false, found, String(err));
    throw err;
  }
  return { found, added };
}

/**
 * VIO prekide vode objavljuje i istog dana, pa se gleda svaki sat. Sinkronizira se
 * svaki datum koji je u tablici (i onaj sa samo završenim radovima), da se završeni
 * i otkazani radovi uklone iz baze.
 */
async function runVio(env: Env): Promise<{ found: number; added: Notice[] }> {
  try {
    const { notices, dates } = await fetchVio();
    const added: Notice[] = [];
    for (const d of dates) {
      added.push(...(await syncDay(env.DB, "vio", d, notices.filter((n) => n.date === d))));
    }
    await logRun(env.DB, "vio", true, notices.length);
    return { found: notices.length, added };
  } catch (err) {
    await logRun(env.DB, "vio", false, 0, String(err));
    throw err;
  }
}

/** Sat u Zagrebu (0–23), za razlikovanje jutarnjeg i popodnevnog pokretanja. */
function zagrebHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zagreb", hour: "2-digit", hour12: false }).format(now),
  );
}

/** Cron izraz za HEP (vidi wrangler.toml); svi ostali okidaju samo VIO. */
const HEP_CRON = "0 4,14 * * *";

async function runAll(env: Env, cron: string) {
  // Izvori i slanje su odvojeni: ako jedan izvor padne, i dalje šaljemo za ono što već imamo
  const log: string[] = [];
  const jobs: [string, () => Promise<{ found: number; added: Notice[] }>][] = [["VIO", () => runVio(env)]];
  if (cron === HEP_CRON) jobs.unshift(["HEP", () => runHep(env)]);
  for (const [name, job] of jobs) {
    try {
      const { found, added } = await job();
      log.push(`${name}: ${found} obavijesti, ${added.length} novih`);
    } catch (e) {
      log.push(`${name} greška: ${e}`);
    }
  }
  const today = todayZagreb();
  const notices = await upcomingNotices(env.DB, today);
  const push = await deliver(env.DB, notices, today, zagrebHour() < 12);
  console.log(`${log.join("; ")}; push: ${push.sent} poslano, ${push.gone} odjavljeno, ${push.errors} grešaka`);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": cache,
    },
  });
}

const bad = (msg: string) => json({ error: msg }, 400);

/** Provjera adrese koju šalje korisnik: mora biti jedno od poznatih naselja. */
function parseAddress(a: any): Address | string {
  if (!a || typeof a !== "object") return "nedostaje adresa";
  const place = String(a.place ?? "").trim();
  const street = String(a.street ?? "").trim();
  const house = String(a.houseNumber ?? "").trim();
  if (place !== TOWN && !VILLAGES.includes(place)) return "nepoznato naselje";
  if (!street || street.length > 120) return "neispravna ulica";
  if (place === TOWN && !TOWN_STREETS.includes(street)) return "ulica nije na popisu ulica Samobora";
  if (house.length > 12 || (house && !/^\d+[\p{L}\d/ -]*$/u.test(house))) return "neispravan kućni broj";
  return { place, street, houseNumber: house || undefined };
}

function parseSubscription(s: any): { endpoint: string; p256dh: string; auth: string } | string {
  const endpoint = String(s?.endpoint ?? "");
  const p256dh = String(s?.keys?.p256dh ?? "");
  const auth = String(s?.keys?.auth ?? "");
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000) return "neispravan endpoint";
  if (!p256dh || !auth || p256dh.length > 200 || auth.length > 100) return "nedostaju ključevi pretplate";
  return { endpoint, p256dh, auth };
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  // GET /api/notices[?place=&street=&house=]
  if (path === "/api/notices" && req.method === "GET") {
    const all = await upcomingNotices(env.DB, todayZagreb());
    const place = url.searchParams.get("place");
    const street = url.searchParams.get("street");
    if (!place || !street) return json(all, 200, "public, max-age=60");
    const addr: Address = { place, street, houseNumber: url.searchParams.get("house") ?? undefined };
    const matched = all
      .map((n) => ({ ...n, match: matchNotice(n, addr) }))
      .filter((n) => n.match !== null);
    return json(matched, 200, "public, max-age=60");
  }

  // GET /api/dashboard?place=&street=&house=&zone= → sve za jednu adresu
  if (path === "/api/dashboard" && req.method === "GET") {
    const address = parseAddress({
      place: url.searchParams.get("place"),
      street: url.searchParams.get("street"),
      houseNumber: url.searchParams.get("house") ?? "",
    });
    if (typeof address === "string") return bad(address);
    const today = todayZagreb();
    const until = dateRange(today, 15).pop()!;

    const all = await upcomingNotices(env.DB, today);
    const matched: MatchedNotice[] = [];
    for (const n of all) {
      const m = matchNotice(n, address);
      if (m) matched.push({ ...n, match: m });
    }

    const odvozData = await fetchOdvoz(env.DB);
    let odvoz = null;
    if (odvozData) {
      const zone = resolveZone(odvozData.data, address.place, address.street, address.houseNumber, url.searchParams.get("zone") ?? undefined);
      const overview = zone.zone ? zoneOverview(odvozData.data, zone.zone, today, until) : null;
      odvoz = { zone: zone.zone, options: zone.options, overview, fetchedAt: odvozData.fetchedAt };
    }

    const runs = await env.DB.prepare(
      "SELECT source, MAX(ran_at) AS ran_at FROM source_runs WHERE ok = 1 GROUP BY source",
    ).all<{ source: string; ran_at: string }>();
    const lastRun = Object.fromEntries(runs.results.map((r) => [r.source, r.ran_at]));

    return json({
      address,
      today,
      timeline: buildTimeline(matched, odvoz?.overview ?? null, today, until),
      struja: matched.filter((n) => n.source === "hep"),
      voda: matched.filter((n) => n.source === "vio"),
      odvoz,
      sources: { hep: lastRun.hep ?? null, vio: lastRun.vio ?? null, odvoz: odvozData?.fetchedAt ?? null },
    }, 200, "private, max-age=60");
  }

  // GET /api/addresses → popis naselja i ulica za odabir adrese
  if (path === "/api/addresses" && req.method === "GET") {
    return json({ town: TOWN, streets: TOWN_STREETS, villages: VILLAGES }, 200, "public, max-age=86400");
  }

  // GET /api/vapid → javni ključ za pushManager.subscribe()
  if (path === "/api/vapid" && req.method === "GET") {
    const { publicKey } = await getVapidKey(env.DB);
    return json({ publicKey }, 200, "public, max-age=3600");
  }

  // POST /api/subscribe { subscription, address }
  if (path === "/api/subscribe" && req.method === "POST") {
    const body = await req.json<any>().catch(() => null);
    const sub = parseSubscription(body?.subscription);
    if (typeof sub === "string") return bad(sub);
    const address = parseAddress(body?.address);
    if (typeof address === "string") return bad(address);
    await saveSubscription(env.DB, { ...sub, address });
    return json({ ok: true });
  }

  // POST /api/unsubscribe { endpoint }
  if (path === "/api/unsubscribe" && req.method === "POST") {
    const body = await req.json<any>().catch(() => null);
    if (!body?.endpoint) return bad("nedostaje endpoint");
    await deleteSubscription(env.DB, String(body.endpoint));
    return json({ ok: true });
  }

  // POST /api/test { endpoint } → probna obavijest samo na taj uređaj
  if (path === "/api/test" && req.method === "POST") {
    const body = await req.json<any>().catch(() => null);
    const sub = body?.endpoint ? await getSubscription(env.DB, String(body.endpoint)) : null;
    if (!sub) return json({ error: "pretplata nije pronađena" }, 404);
    const { privateJwk } = await getVapidKey(env.DB);
    const result = await sendPush(privateJwk, sub, {
      title: "Obavijesti rade ✓",
      body: `Javit ćemo vam kad HEP najavi isključenje struje za ${sub.address.street}${sub.address.houseNumber ? " " + sub.address.houseNumber : ""}.`,
      tag: "test",
      url: "/",
    }, 600);
    if (result === "gone") await deleteSubscription(env.DB, sub.endpoint);
    return json({ result });
  }

  // GET /api/status → zadnja pokretanja izvora i broj pretplata
  if (path === "/api/status" && req.method === "GET") {
    const runs = await env.DB.prepare("SELECT * FROM source_runs ORDER BY ran_at DESC LIMIT 20").all();
    const subs = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions").first<{ n: number }>();
    return json({ subscriptions: subs?.n ?? 0, runs: runs.results });
  }

  return json({ error: "not found" }, 404);
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runAll(env, event.cron));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, env, url);
      } catch (e) {
        console.error(e);
        return json({ error: "interna greška" }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
