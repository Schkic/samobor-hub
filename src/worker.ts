import { dateRange, todayZagreb } from "./core/dates";
import { logRun, syncDay, upcomingNotices } from "./core/store";
import { matchNotice } from "./core/streets";
import type { Address, Notice } from "./core/types";
import {
  deleteSubscription,
  deliver,
  deliverOdvoz,
  getSubscription,
  getSubscriptionById,
  getVapidKey,
  saveSubscription,
  sendPush,
  TOPICS,
  type Topic,
} from "./core/push";
import { fetchHepDay, HEP_SAMOBOR } from "./sources/hep";
import { parseVioHtml, vioToNotices } from "./sources/vio";
import { verifyGithubOidc } from "./core/oidc";
import { fetchOdvoz, resolveZone, zoneOverview } from "./sources/odvoz";
import { busOverview, fetchBus, nowMinutesZagreb } from "./sources/bus";
import { eventsOverview, fetchEvents } from "./sources/events";
import { fetchNajave, najaveOverview } from "./sources/najave";
import { articlesToItems, fetchGradNovosti } from "./sources/gradnovosti";
import { buildTimeline, type MatchedNotice } from "./core/dashboard";
import { TOWN, TOWN_STREETS, VILLAGES } from "./data/addresses";
import { healthAlerts, type Alert, type RunRow } from "./core/health";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /**
   * Fine-grained GitHub token (samo Schkic/samobor-hub, Actions: read & write).
   * Upisuje se kao tajna u Cloudflareu, nikad u repozitorij. Bez njega VIO ovisi
   * samo o GitHubovom rasporedu, koji zna kasniti satima.
   */
  GITHUB_DISPATCH_TOKEN?: string;
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
 * VIO vraća prazan odgovor Cloudflareovim poslužiteljima, pa tablicu svaki sat
 * dohvaća GitHub Actions (.github/workflows/vio.yml) i šalje je na /api/ingest/vio.
 * Sinkronizira se svaki datum koji je u tablici (i onaj sa samo završenim radovima),
 * da se završeni i otkazani radovi uklone iz baze.
 */
async function ingestVio(env: Env, html: string): Promise<{ found: number; added: Notice[] }> {
  try {
    const { notices, dates } = await vioToNotices(parseVioHtml(html));
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

async function pushAll(env: Env) {
  const today = todayZagreb();
  return deliver(env.DB, await upcomingNotices(env.DB, today), today, zagrebHour() < 12);
}

async function runAll(env: Env) {
  // Izvor i slanje su odvojeni: ako HEP padne, i dalje šaljemo za ono što već imamo
  let hep: string;
  try {
    const { found, added } = await runHep(env);
    hep = `HEP: ${found} obavijesti, ${added.length} novih`;
  } catch (e) {
    hep = `HEP greška: ${e}`;
  }
  const push = await pushAll(env);
  console.log(`${hep}; push: ${push.sent} poslano, ${push.gone} odjavljeno, ${push.errors} grešaka`);
  await cleanup(env);
}

/** Rokovi čuvanja iz /privatnost/: evidencija poslanih obavijesti 60 dana, zapisi pokretanja 90 dana. */
async function cleanup(env: Env) {
  const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries WHERE sent_at < ?").bind(days(60)),
    env.DB.prepare("DELETE FROM source_runs WHERE ran_at < ?").bind(days(90)),
  ]);
}

/** Navečer: podsjetnik da je sutra odvoz, samo za one koji su to uključili. */
async function runOdvozReminders(env: Env) {
  const odvoz = await fetchOdvoz(env.DB);
  if (!odvoz) {
    console.log("odvoz: data.json nedostupan, podsjetnici preskočeni");
    return { sent: 0, gone: 0, errors: 0 };
  }
  const tomorrow = dateRange(todayZagreb(), 2)[1];
  const r = await deliverOdvoz(env.DB, odvoz.data, tomorrow);
  console.log(`odvoz ${tomorrow}: ${r.sent} poslano, ${r.gone} odjavljeno, ${r.errors} grešaka`);
  return r;
}

/** Cron za večernji podsjetnik (wrangler.toml). */
const ODVOZ_CRON = "0 17 * * *";
/** Cron koji svaki sat pokreće VIO workflow na GitHubu (wrangler.toml). */
const VIO_CRON = "20 5-19 * * *";

/**
 * Pokreće .github/workflows/vio.yml preko GitHub API-ja (workflow_dispatch).
 * GitHubov vlastiti raspored kasni satima, a Cloudflareov cron je točan.
 * Workflow zatim sam pošalje VIO tablicu na /api/ingest/vio.
 */
async function dispatchVio(env: Env, fetcher: typeof fetch = fetch): Promise<string> {
  if (!env.GITHUB_DISPATCH_TOKEN) return "preskočeno: nema GITHUB_DISPATCH_TOKEN";
  const res = await fetcher("https://api.github.com/repos/Schkic/samobor-hub/actions/workflows/vio.yml/dispatches", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "samobor-hub",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (res.status === 204) return "pokrenuto";
  const msg = `GitHub dispatch: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
  await sendAlert(env, {
    key: "vio-dispatch",
    title: "MojSamobor: GitHub odbija pokretanje VIO-a",
    body: `HTTP ${res.status}. Ključ GITHUB_DISPATCH_TOKEN je možda istekao ili nema prava Actions (read & write) na Schkic/samobor-hub.`,
  });
  await logRun(env.DB, "vio", false, 0, msg); // vidi se u /api/status
  return msg;
}

/**
 * Uzbuna administratoru: push na pretplate navedene u D1 settings.admin_subs (id-jevi odvojeni zarezom),
 * najviše jednom dnevno po ključu (tablica deliveries, kind 'alert').
 */
async function sendAlert(env: Env, a: Alert): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_subs'").first<{ value: string }>();
    const ids = (row?.value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length) { console.warn(`uzbuna bez primatelja: ${a.title}`); return; }
    const key = `alert:${a.key}:${todayZagreb()}`;
    const { privateJwk } = await getVapidKey(env.DB);
    for (const id of ids) {
      const done = await env.DB.prepare("SELECT 1 FROM deliveries WHERE notice_id = ? AND sub_id = ? AND kind = 'alert'").bind(key, id).first();
      if (done) continue;
      const sub = await getSubscriptionById(env.DB, id);
      if (!sub) continue;
      const r = await sendPush(privateJwk, sub, { title: a.title, body: a.body, tag: key, url: "/api/status" }, 6 * 3600);
      if (r === "sent") {
        await env.DB.prepare("INSERT OR IGNORE INTO deliveries (notice_id, sub_id, kind, sent_at) VALUES (?, ?, 'alert', ?)")
          .bind(key, id, new Date().toISOString()).run();
      }
    }
  } catch (e) {
    console.error("uzbuna nije poslana", e);
  }
}

/** Rade li izvori? Pokreće se uz svaki cron. */
async function checkHealth(env: Env): Promise<void> {
  const vio = await env.DB.prepare("SELECT MAX(ran_at) AS t FROM source_runs WHERE source = 'vio' AND ok = 1").first<{ t: string | null }>();
  const hep = await env.DB.prepare("SELECT ok, error, ran_at FROM source_runs WHERE source = 'hep' ORDER BY ran_at DESC LIMIT 2").all<RunRow>();
  for (const a of healthAlerts(new Date(), zagrebHour(), vio?.t ?? null, hep.results)) await sendAlert(env, a);
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

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

/** Teme obavijesti: podskup od TOPICS; bez polja = zadane (struja, voda). */
function parseTopicList(t: unknown): Topic[] | undefined | string {
  if (t == null) return undefined;
  if (!Array.isArray(t)) return "neispravne teme";
  const out = [...new Set(t.map(String))];
  if (out.some((x) => !(TOPICS as string[]).includes(x))) return "nepoznata tema";
  return out as Topic[];
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

    // Autobusi: vozni red iz aplikacije Autobusi (samo čitanje). Greška ne ruši pregled.
    const busData = await fetchBus(env.DB).catch(() => null);
    const nowMin = nowMinutesZagreb();
    const bus = busData ? busOverview(busData.data, address, today, nowMin) : null;

    // Događanja: gradski kalendar (isti za sve adrese)
    const evData = await fetchEvents(env.DB).catch(() => null);
    const hhmm = `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`;
    const najData = await fetchNajave(env.DB).catch(() => null);
    const gradData = await fetchGradNovosti(env.DB).catch(() => null);
    const events = evData || najData || gradData
      ? {
          ...(evData ? eventsOverview(evData.events, today, 7, hhmm) : { upcoming: [], ongoing: [] }),
          calendarOk: !!evData,
          najave: najaveOverview([...(najData?.items ?? []), ...articlesToItems(gradData?.articles ?? [])], today),
          fetchedAt: evData?.fetchedAt ?? null,
        }
      : null;

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
      bus,
      events,
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
    const topics = parseTopicList(body?.topics);
    if (typeof topics === "string") return bad(topics);
    const zone = body?.zone == null || body.zone === "" ? undefined : String(body.zone);
    if (zone && (zone.length > 40 || !/^[\p{L}\d .-]+$/u.test(zone))) return bad("neispravna zona");
    await saveSubscription(env.DB, { ...sub, address, topics, zone });
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
      body: `Stizat će vam obavijesti za ${sub.address.street}${sub.address.houseNumber ? " " + sub.address.houseNumber : ""}: ${
        sub.topics.map((t) => ({ struja: "struja", voda: "voda", odvoz: "odvoz otpada" })[t]).join(", ") || "ništa nije odabrano"
      }.`,
      tag: "test",
      url: "/",
    }, 600);
    if (result === "gone") await deleteSubscription(env.DB, sub.endpoint);
    return json({ result });
  }

  // POST /api/ingest/vio  (tijelo: sirovi HTML VIO stranice)
  // Šalje ga samo GitHub Actions iz repozitorija Schkic/samobor-hub; dokaz je
  // GitHubov potpisani OIDC token, pa nikakvi tajni ključevi nisu potrebni.
  if (path === "/api/ingest/vio" && req.method === "POST") {
    const auth = req.headers.get("authorization") ?? "";
    try {
      await verifyGithubOidc(auth.replace(/^Bearer\s+/i, ""), {
        audience: "samobor-hub",
        repository: "Schkic/samobor-hub",
        ref: "refs/heads/main",
      });
    } catch (e) {
      return json({ error: `neovlašteno: ${(e as Error).message}` }, 401);
    }
    const html = await req.text();
    if (html.length > 2_000_000) return bad("prevelik sadržaj");
    try {
      const { found, added } = await ingestVio(env, html);
      const push = await pushAll(env);
      return json({ found, added: added.length, push });
    } catch (e) {
      return json({ error: (e as Error).message }, 422);
    }
  }

  // POST /api/admin/run → ručno pokretanje HEP-a i slanja (za provjere).
  // Ključ je u D1 (settings.admin_token); bez njega ruta ne postoji.
  if (path === "/api/admin/run" && req.method === "POST") {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_token'").first<{ value: string }>();
    const given = req.headers.get("x-admin-token") ?? "";
    if (!row || !row.value || given.length !== row.value.length || !timingSafeEqual(given, row.value)) {
      return json({ error: "not found" }, 404);
    }
    const out: Record<string, unknown> = {};
    out.hep = await runHep(env).then((r) => ({ found: r.found, added: r.added.length })).catch((e) => String(e));
    out.push = await pushAll(env);
    if (url.searchParams.get("odvoz") === "1") out.odvoz = await runOdvozReminders(env);
    if (url.searchParams.get("vio") === "1") out.vio = await dispatchVio(env);
    return json(out);
  }

  // GET /api/status → zadnja pokretanja izvora i broj pretplata
  if (path === "/api/status" && req.method === "GET") {
    const runs = await env.DB.prepare("SELECT * FROM source_runs ORDER BY ran_at DESC LIMIT 20").all();
    const subs = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions").first<{ n: number }>();
    return json({ subscriptions: subs?.n ?? 0, vioDispatch: !!env.GITHUB_DISPATCH_TOKEN, runs: runs.results });
  }

  return json({ error: "not found" }, 404);
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const job =
      event.cron === ODVOZ_CRON ? runOdvozReminders(env)
      : event.cron === VIO_CRON ? dispatchVio(env).then((r) => console.log(`VIO dispatch: ${r}`))
      : runAll(env);
    ctx.waitUntil(job.then(() => checkHealth(env)));
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
