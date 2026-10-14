import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDay,
  planPushes,
  publicKeyFromJwk,
  pushPayload,
  sendPush,
  type Subscription,
} from "../src/core/push";
import { parseStreetList, normalizeStreet } from "../src/core/streets";
import type { Notice } from "../src/core/types";
import { TOWN_STREETS, VILLAGES } from "../src/data/addresses";

function notice(id: string, date: string, places: string[], raw: string): Notice {
  const { streets, partial } = parseStreetList(raw);
  return {
    id, source: "hep", kind: "struja-planirano", date, start: "08:00", end: "12:00",
    places, streets, rawStreets: raw, note: null, partial, url: "",
  };
}

const sub = (id: string, place: string, street: string, houseNumber?: string): Subscription => ({
  id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a",
  address: { place, street, houseNumber },
});

const TODAY = "2026-10-14";
const marko = sub("m", "Rude", "Rude", "92A");
const ana = sub("a", "Samobor", "Ulica grada Wirgesa", "12");
const ivo = sub("i", "Samobor", "Mlinska ulica", "5");

const nRude = notice("n1", "2026-10-16", ["RUDE"], "RUDE 80-100 par");
const nWirges = notice("n2", "2026-10-14", ["SAMOBOR"], "GRADA WIRGESA 2-20 par");
const nOld = notice("n3", "2026-10-13", ["SAMOBOR"], "MLINSKA");

test("najava ide samo pogođenim adresama, prošle obavijesti se preskaču", () => {
  const plan = planPushes([nRude, nWirges, nOld], [marko, ana, ivo], new Set(), TODAY, false);
  assert.deepEqual(
    plan.map((p) => `${p.notice.id}->${p.sub.id}:${p.kind}:${p.match}`),
    ["n1->m:najava:address", "n2->a:najava:address"],
  );
});

test("bez duplikata: već poslana najava se ne ponavlja, a 'danas' samo ujutro na dan isključenja", () => {
  const delivered = new Set(["n1|m|najava", "n2|a|najava"]);
  assert.deepEqual(planPushes([nRude, nWirges], [marko, ana], delivered, TODAY, false), []);

  const morning = planPushes([nRude, nWirges], [marko, ana], delivered, TODAY, true);
  assert.deepEqual(morning.map((p) => `${p.notice.id}->${p.sub.id}:${p.kind}`), ["n2->a:danas"]);

  delivered.add("n2|a|danas");
  assert.deepEqual(planPushes([nRude, nWirges], [marko, ana], delivered, TODAY, true), []);
});

test("nova pretplata ujutro dobije samo najavu, ne i 'danas' u istoj rundi", () => {
  const plan = planPushes([nWirges], [ana], new Set(), TODAY, true);
  assert.deepEqual(plan.map((p) => p.kind), ["najava"]);
});

test("tekst obavijesti", () => {
  assert.equal(formatDay("2026-10-14", TODAY), "Danas");
  assert.equal(formatDay("2026-10-15", TODAY), "Sutra");
  assert.equal(formatDay("2026-10-16", TODAY), "Pet 16.10.");
  assert.equal(formatDay("2026-11-02", "2026-10-31"), "Pon 2.11."); // preko kraja mjeseca

  const [p] = planPushes([nRude], [marko], new Set(), TODAY, false);
  const msg = pushPayload(p, TODAY);
  assert.equal(msg.title, "Pet 16.10. bez struje 08:00–12:00");
  assert.match(msg.body, /Rude 92A/);
  assert.equal(msg.url, "/?n=n1");

  const fault = { ...nWirges, kind: "struja-kvar" };
  const [pf] = planPushes([fault], [ana], new Set(), TODAY, false);
  assert.equal(pushPayload(pf, TODAY).title, "Kvar: danas bez struje 08:00–12:00");

  const whole = notice("n4", "2026-10-15", ["BREGANA"], "");
  const [pw] = planPushes([whole], [sub("b", "Bregana", "Bregana")], new Set(), TODAY, false);
  assert.match(pushPayload(pw, TODAY).body, /naselju Bregana/);
});

test("VAPID: javni ključ iz JWK-a je 65-bajtna nekomprimirana točka", async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const pub = publicKeyFromJwk(jwk);
  const raw = Uint8Array.from(atob(pub.replace(/-/g, "+").replace(/_/g, "/") + "="), (c) => c.charCodeAt(0));
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4);
  const exported = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  assert.deepEqual(raw, exported);
});

test("sendPush gradi šifrirani zahtjev i prepoznaje odjavljene pretplate", async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const vapid = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  // Ključevi preglednika: stvarni P-256 javni ključ i 16-bajtni auth
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const s: Subscription = {
    ...ana,
    p256dh: b64(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer)),
    auth: b64(crypto.getRandomValues(new Uint8Array(16))),
  };

  let seen: { url: string; headers: Record<string, string>; size: number } | null = null;
  const ok = (async (url: string, init: any) => {
    const body = init.body as ArrayBuffer | Uint8Array;
    seen = { url, headers: Object.fromEntries(new Headers(init.headers)), size: body.byteLength };
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  assert.equal(await sendPush(vapid, s, { title: "x" }, 3600, ok), "sent");
  assert.equal(seen!.url, s.endpoint);
  assert.equal(seen!.headers["content-encoding"], "aes128gcm");
  assert.match(seen!.headers["authorization"], /^vapid t=.+, k=.+/);
  assert.equal(seen!.headers["ttl"], "3600");
  assert.ok(seen!.size > 86); // zaglavlje aes128gcm + šifrirani sadržaj

  const goneFetch = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
  assert.equal(await sendPush(vapid, s, { title: "x" }, 3600, goneFetch), "gone");
  const errFetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
  assert.equal(await sendPush(vapid, s, { title: "x" }, 3600, errFetch), "error");
});

test("preglednik može dešifrirati poruku (RFC 8291 aes128gcm, kao Chrome/Firefox/Safari)", async () => {
  const vapidPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const vapid = (await crypto.subtle.exportKey("jwk", vapidPair.privateKey)) as JsonWebKey;

  // "Preglednik": ECDH par i auth tajna
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPub = new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const s: Subscription = { ...ana, p256dh: b64(uaPub), auth: b64(authSecret) };

  let body!: Uint8Array;
  let authz = "";
  const capture = (async (_url: string, init: any) => {
    body = new Uint8Array(init.body);
    authz = new Headers(init.headers).get("authorization")!;
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const payload = { title: "Sutra bez struje 08:00–12:00", body: "Radovi HEP-a obuhvaćaju Rude 92A.", url: "/?n=x" };
  assert.equal(await sendPush(vapid, s, payload, 3600, capture), "sent");

  // aes128gcm zaglavlje: salt(16) | rs(4) | idlen(1) | keyid = javni ključ servera
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  assert.equal(idlen, 65);

  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as any, ua.privateKey, 256));
  const hkdf = async (saltB: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltB, info }, k, len * 8));
  };
  const enc = (t: string) => new TextEncoder().encode(t);
  const keyInfo = new Uint8Array([...enc("WebPush: info\0"), ...uaPub, ...asPub]);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));

  // ukloni padding: sadržaj, zatim delimiter 0x02, zatim nule
  let end = plain.length - 1;
  while (plain[end] === 0) end--;
  assert.equal(plain[end], 2, "nedostaje delimiter zadnjeg zapisa");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain.slice(0, end))), payload);

  // VAPID: k= je naš javni ključ, a JWT je potpisan za origin push servisa
  assert.ok(authz.includes(`k=${publicKeyFromJwk(vapid)}`));
  const jwt = authz.match(/t=([^,]+)/)![1];
  const claims = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  assert.equal(claims.aud, "https://push.example");
  assert.equal(claims.sub, "mailto:info@opticora.hr");
  const sig = Uint8Array.from(atob(jwt.split(".")[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, vapidPair.publicKey, sig,
    enc(jwt.split(".").slice(0, 2).join(".")),
  );
  assert.ok(ok, "VAPID potpis nije valjan");
});

test("popis adresa: 245 ulica, 56 naselja, svi ključevi jedinstveni i neprazni", () => {
  assert.equal(TOWN_STREETS.length, 245);
  assert.equal(VILLAGES.length, 56);
  const keys = TOWN_STREETS.map(normalizeStreet);
  assert.ok(keys.every((k) => k.length > 1));
  assert.equal(new Set(keys).size, keys.length, "dvije ulice daju isti ključ");
  // tipični HEP zapisi daju isti ključ kao Komunalčevi nazivi
  assert.equal(normalizeStreet("ZRINSKO-FRANKOPANSKA"), normalizeStreet("Zrinsko – Frankopanska ulica"));
  assert.equal(normalizeStreet("DR. MIJE JURATOVIĆA"), normalizeStreet("Ulica dr. Mije Juratovića"));
  assert.equal(normalizeStreet("ŠENOINA ULICA"), normalizeStreet("Šenoina"));
  assert.equal(normalizeStreet("HRVOJA VUKČIĆA HRVATINIĆA"), normalizeStreet("Ulica Hrvoja Vukčića – Hrvatinića"));
});
