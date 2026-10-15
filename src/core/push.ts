// aes128gcm (RFC 8291) + VAPID (RFC 8292): jedino što prihvaćaju svi push servisi, uključujući Appleov za iPhone
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { matchNotice, type MatchLevel } from "./streets";
import type { Address, Notice } from "./types";
import { noticeId } from "./id";
import { resolveZone, zoneOverview, WASTE_LABEL, type OdvozData, type WasteType } from "../sources/odvoz";

// ---------------------------------------------------------------------------
// Tipovi
// ---------------------------------------------------------------------------

/** Teme obavijesti koje korisnik može uključiti. */
export type Topic = "struja" | "voda" | "odvoz";
export const TOPICS: Topic[] = ["struja", "voda", "odvoz"];
export const DEFAULT_TOPICS: Topic[] = ["struja", "voda"]; // odvoz već šalje aplikacija za odvoz

export interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  address: Address;
  topics: Topic[];
  zone?: string; // ručno odabrana zona odvoza (ulice s više zona)
}

export type DeliveryKind = "najava" | "danas" | "vecer";

/** Kojoj temi pripada obavijest iz izvora. */
export const topicOf = (n: Notice): Topic => (n.source === "vio" ? "voda" : "struja");

export interface PlannedPush {
  notice: Notice;
  sub: Subscription;
  kind: DeliveryKind;
  match: Exclude<MatchLevel, null>;
}

// ---------------------------------------------------------------------------
// Plan: tko dobiva što (čista funkcija, bez mreže i baze)
// ---------------------------------------------------------------------------

/**
 * - "najava": čim se obavijest prvi put pojavi (ili čim se korisnik pretplati),
 *   za svako nadolazeće isključenje koje pogađa njegovu adresu.
 * - "danas": jutarnji podsjetnik na dan isključenja (samo u jutarnjem pokretanju).
 *   Ne šalje se ako je najava poslana istog jutra, da korisnik ne dobije dvije poruke zaredom.
 */
export function planPushes(
  notices: Notice[],
  subs: Subscription[],
  delivered: Set<string>, // ključevi `${noticeId}|${subId}|${kind}`
  today: string,
  isMorningRun: boolean,
): PlannedPush[] {
  const plan: PlannedPush[] = [];
  for (const notice of notices) {
    if (notice.date < today) continue;
    for (const sub of subs) {
      if (!sub.topics.includes(topicOf(notice))) continue;
      const match = matchNotice(notice, sub.address);
      if (!match) continue;
      // "Možda i vi" za cijeli grad Samobor bila bi poruka tisućama ljudi zbog jedne ulice:
      // takve obavijesti prikazujemo u aplikaciji, ali ih ne šaljemo kao push.
      if (match === "place" && sub.address.place === "Samobor" && notice.partial) continue;
      const key = (k: DeliveryKind) => `${notice.id}|${sub.id}|${k}`;

      const announced = delivered.has(key("najava"));
      if (!announced) {
        plan.push({ notice, sub, kind: "najava", match });
        continue; // ista runda: samo jedna poruka po obavijesti
      }
      if (isMorningRun && notice.date === today && !delivered.has(key("danas"))) {
        plan.push({ notice, sub, kind: "danas", match });
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Tekst obavijesti
// ---------------------------------------------------------------------------

const DAYS = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"];

export function formatDay(iso: string, today: string): string {
  if (iso === today) return "Danas";
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
  if (diff === 1) return "Sutra";
  const dow = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow.charAt(0).toUpperCase()}${dow.slice(1)} ${d}.${m}.`;
}

export function pushPayload(p: PlannedPush, today: string) {
  const { notice, kind } = p;
  const water = notice.source === "vio";
  const what = water ? "vode" : "struje";
  const who = water ? "VIO" : "HEP";
  const when = formatDay(notice.date, today);
  const time = notice.start && notice.end ? ` ${notice.start}–${notice.end}` : "";
  const fault = notice.kind === "struja-kvar";
  const title =
    kind === "danas"
      ? `Danas bez ${what}${time}`
      : fault
        ? `Kvar: ${when.toLowerCase()} bez ${what}${time}`
        : `${when} bez ${what}${time}`;
  const addr = `${p.sub.address.street}${p.sub.address.houseNumber ? " " + p.sub.address.houseNumber : ""}`;
  let body =
    p.match === "place"
      ? `Radovi u naselju ${p.sub.address.place}. Moguće je da obuhvaćaju i tvoju adresu.`
      : `Radovi ${who === "HEP" ? "HEP-a" : "VIO-a"} obuhvaćaju ${addr}.`;
  if (water && notice.note && /cistern/i.test(notice.note)) body += " Autocisterna će biti na terenu.";
  return {
    title,
    body,
    tag: `${notice.id}-${kind}`,
    url: `/?n=${notice.id}`,
  };
}

// ---------------------------------------------------------------------------
// VAPID ključ: generira ga sam Worker i čuva u D1, bez ručnih tajnih ključeva
// ---------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

/** Javni ključ za pushManager.subscribe(): nekomprimirana točka 0x04 || x || y. */
export function publicKeyFromJwk(jwk: JsonWebKey): string {
  const x = b64urlDecode(jwk.x!);
  const y = b64urlDecode(jwk.y!);
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(x, 1);
  raw.set(y, 33);
  return b64url(raw);
}

export async function getVapidKey(db: D1Database): Promise<{ privateJwk: JsonWebKey; publicKey: string }> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid_jwk'").first<{ value: string }>();
  let jwk: JsonWebKey;
  if (row) {
    jwk = JSON.parse(row.value);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const generated = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    // INSERT OR IGNORE + ponovno čitanje: ako dva zahtjeva istovremeno generiraju ključ, pobjeđuje prvi
    await db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_jwk', ?)")
      .bind(JSON.stringify(generated))
      .run();
    const saved = await db.prepare("SELECT value FROM settings WHERE key = 'vapid_jwk'").first<{ value: string }>();
    jwk = JSON.parse(saved!.value);
  }
  return { privateJwk: jwk, publicKey: publicKeyFromJwk(jwk) };
}

// ---------------------------------------------------------------------------
// Pretplate
// ---------------------------------------------------------------------------

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  place: string;
  street: string;
  house: string | null;
  topics: string | null;
  zone: string | null;
}

export function parseTopics(v: string | null | undefined): Topic[] {
  if (v == null) return [...DEFAULT_TOPICS];
  return v.split(",").map((t) => t.trim()).filter((t): t is Topic => (TOPICS as string[]).includes(t));
}

const toSub = (r: SubRow): Subscription => ({
  id: r.id,
  endpoint: r.endpoint,
  p256dh: r.p256dh,
  auth: r.auth,
  address: { place: r.place, street: r.street, houseNumber: r.house ?? undefined },
  topics: parseTopics(r.topics),
  zone: r.zone ?? undefined,
});

export async function subscriptionId(endpoint: string): Promise<string> {
  return noticeId("sub", "", endpoint);
}

export async function saveSubscription(
  db: D1Database,
  input: { endpoint: string; p256dh: string; auth: string; address: Address; topics?: Topic[]; zone?: string },
): Promise<Subscription> {
  const id = await subscriptionId(input.endpoint);
  const now = new Date().toISOString();
  const a = input.address;
  const topics = input.topics ?? [...DEFAULT_TOPICS];
  await db
    .prepare(
      `INSERT INTO subscriptions (id, endpoint, p256dh, auth, place, street, house, topics, zone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh, auth = excluded.auth, place = excluded.place,
         street = excluded.street, house = excluded.house, topics = excluded.topics,
         zone = excluded.zone, updated_at = excluded.updated_at`,
    )
    .bind(id, input.endpoint, input.p256dh, input.auth, a.place, a.street, a.houseNumber ?? null,
      topics.join(","), input.zone ?? null, now, now)
    .run();
  return { id, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, address: a, topics, zone: input.zone };
}

export async function deleteSubscription(db: D1Database, endpoint: string): Promise<void> {
  const id = await subscriptionId(endpoint);
  await db.batch([
    db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id),
    db.prepare("DELETE FROM deliveries WHERE sub_id = ?").bind(id),
  ]);
}

export async function getSubscription(db: D1Database, endpoint: string): Promise<Subscription | null> {
  const r = await db.prepare("SELECT * FROM subscriptions WHERE endpoint = ?").bind(endpoint).first<SubRow>();
  return r ? toSub(r) : null;
}

export async function getSubscriptionById(db: D1Database, id: string): Promise<Subscription | null> {
  const r = await db.prepare("SELECT * FROM subscriptions WHERE id = ?").bind(id).first<SubRow>();
  return r ? toSub(r) : null;
}

// ---------------------------------------------------------------------------
// Slanje
// ---------------------------------------------------------------------------

export type SendResult = "sent" | "gone" | "error";

export async function sendPush(
  vapid: JsonWebKey,
  sub: Subscription,
  payload: Record<string, string>,
  ttlSeconds = 86400,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  const request = await buildPushPayload(
    { data: payload, options: { ttl: Math.min(ttlSeconds, 86400), urgency: "normal" } },
    { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    { subject: "mailto:info@opticora.hr", publicKey: publicKeyFromJwk(vapid), privateKey: vapid.d },
  );
  const res = await fetcher(sub.endpoint, request);
  if (res.status === 404 || res.status === 410) return "gone"; // korisnik se odjavio u pregledniku
  return res.ok ? "sent" : "error";
}

/**
 * Pošalje sve planirane obavijesti. Pretplate koje push servis prijavi kao
 * nepostojeće (404/410) briše. Vraća broj poslanih.
 */
export async function deliver(
  db: D1Database,
  notices: Notice[],
  today: string,
  isMorningRun: boolean,
  fetcher: typeof fetch = fetch,
): Promise<{ sent: number; gone: number; errors: number }> {
  const subs = (await db.prepare("SELECT * FROM subscriptions").all<SubRow>()).results.map(toSub);
  if (subs.length === 0 || notices.length === 0) return { sent: 0, gone: 0, errors: 0 };

  const ids = notices.map((n) => n.id);
  const placeholders = ids.map(() => "?").join(",");
  const done = await db
    .prepare(`SELECT notice_id, sub_id, kind FROM deliveries WHERE notice_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ notice_id: string; sub_id: string; kind: string }>();
  const delivered = new Set(done.results.map((d) => `${d.notice_id}|${d.sub_id}|${d.kind}`));

  const plan = planPushes(notices, subs, delivered, today, isMorningRun);
  if (plan.length === 0) return { sent: 0, gone: 0, errors: 0 };

  const { privateJwk } = await getVapidKey(db);
  let sent = 0, gone = 0, errors = 0;
  const goneSubs = new Set<string>();

  for (const p of plan) {
    if (goneSubs.has(p.sub.id)) continue;
    let result: SendResult;
    try {
      result = await sendPush(privateJwk, p.sub, pushPayload(p, today), 86400, fetcher);
    } catch {
      result = "error";
    }
    if (result === "sent") {
      sent++;
      await db
        .prepare("INSERT OR IGNORE INTO deliveries (notice_id, sub_id, kind, sent_at) VALUES (?, ?, ?, ?)")
        .bind(p.notice.id, p.sub.id, p.kind, new Date().toISOString())
        .run();
    } else if (result === "gone") {
      gone++;
      goneSubs.add(p.sub.id);
      await deleteSubscription(db, p.sub.endpoint);
    } else {
      errors++; // pokušat će ponovno u sljedećem pokretanju
    }
  }
  return { sent, gone, errors };
}

// ---------------------------------------------------------------------------
// Odvoz otpada: podsjetnik večer prije
// ---------------------------------------------------------------------------

export interface PlannedOdvoz {
  sub: Subscription;
  zone: string;
  date: string;
  types: WasteType[];
  key: string; // "odvoz:<zona>:<datum>", za tablicu deliveries
}

/** Tko dobiva podsjetnik da je sutra odvoz (samo pretplate s temom "odvoz"). */
export function planOdvozReminders(
  data: OdvozData,
  subs: Subscription[],
  delivered: Set<string>, // `${key}|${subId}|vecer`
  tomorrow: string,
): PlannedOdvoz[] {
  const plan: PlannedOdvoz[] = [];
  for (const sub of subs) {
    if (!sub.topics.includes("odvoz")) continue;
    const { zone } = resolveZone(data, sub.address.place, sub.address.street, sub.address.houseNumber, sub.zone);
    if (!zone) continue; // ulica s više zona bez odabrane zone: ne nagađamo
    const day = zoneOverview(data, zone, tomorrow, tomorrow)?.days[0];
    if (!day) continue;
    const key = `odvoz:${zone}:${tomorrow}`;
    if (delivered.has(`${key}|${sub.id}|vecer`)) continue;
    plan.push({ sub, zone, date: tomorrow, types: day.types, key });
  }
  return plan;
}

export function odvozPayload(p: PlannedOdvoz) {
  const list = p.types.map((t) => WASTE_LABEL[t].toLowerCase()).join(", ");
  return {
    title: `Sutra je odvoz: ${list}`,
    body: "Iznesi spremnik večeras ili sutra do 6 sati ujutro.",
    tag: p.key,
    url: "/",
  };
}

export async function deliverOdvoz(
  db: D1Database,
  data: OdvozData,
  tomorrow: string,
  fetcher: typeof fetch = fetch,
): Promise<{ sent: number; gone: number; errors: number }> {
  const subs = (await db.prepare("SELECT * FROM subscriptions WHERE topics LIKE '%odvoz%'").all<SubRow>()).results.map(toSub);
  if (!subs.length) return { sent: 0, gone: 0, errors: 0 };
  const done = await db
    .prepare("SELECT notice_id, sub_id, kind FROM deliveries WHERE kind = 'vecer' AND notice_id LIKE ?")
    .bind(`odvoz:%:${tomorrow}`)
    .all<{ notice_id: string; sub_id: string; kind: string }>();
  const delivered = new Set(done.results.map((d) => `${d.notice_id}|${d.sub_id}|${d.kind}`));
  const plan = planOdvozReminders(data, subs, delivered, tomorrow);
  if (!plan.length) return { sent: 0, gone: 0, errors: 0 };

  const { privateJwk } = await getVapidKey(db);
  let sent = 0, gone = 0, errors = 0;
  for (const p of plan) {
    let result: SendResult;
    try {
      // vrijedi do sutra ujutro; poslije toga podsjetnik više nema smisla
      result = await sendPush(privateJwk, p.sub, odvozPayload(p), 12 * 3600, fetcher);
    } catch {
      result = "error";
    }
    if (result === "sent") {
      sent++;
      await db
        .prepare("INSERT OR IGNORE INTO deliveries (notice_id, sub_id, kind, sent_at) VALUES (?, ?, 'vecer', ?)")
        .bind(p.key, p.sub.id, new Date().toISOString())
        .run();
    } else if (result === "gone") {
      gone++;
      await deleteSubscription(db, p.sub.endpoint);
    } else errors++;
  }
  return { sent, gone, errors };
}
