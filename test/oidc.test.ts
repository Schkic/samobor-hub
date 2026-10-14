import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGithubOidc, resetJwksCache, GITHUB_ISSUER } from "../src/core/oidc";

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

async function setup() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const jwks = { keys: [{ ...pub, kid: "k1", use: "sig" }] };
  const fetcher = (async () => new Response(JSON.stringify(jwks))) as unknown as typeof fetch;
  const sign = async (claims: Record<string, unknown>, kid = "k1", key = pair.privateKey) => {
    const data = `${enc({ alg: "RS256", typ: "JWT", kid })}.${enc(claims)}`;
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data)));
    return `${data}.${Buffer.from(sig).toString("base64url")}`;
  };
  return { fetcher, sign };
}

const NOW = 1_800_000_000;
const good = {
  iss: GITHUB_ISSUER, aud: "samobor-hub", repository: "Schkic/samobor-hub",
  ref: "refs/heads/main", exp: NOW + 300, nbf: NOW - 10,
};
const expect = { audience: "samobor-hub", repository: "Schkic/samobor-hub", ref: "refs/heads/main", now: NOW };

test("valjan GitHub OIDC token iz našeg repozitorija prolazi", async () => {
  resetJwksCache();
  const { fetcher, sign } = await setup();
  const claims = await verifyGithubOidc(await sign(good), expect, fetcher);
  assert.equal(claims.repository, "Schkic/samobor-hub");
});

test("odbija tuđi repozitorij, krivu publiku, granu, istekao token, krivotvoren potpis", async () => {
  resetJwksCache();
  const { fetcher, sign } = await setup();
  const reject = async (claims: Record<string, unknown>, re: RegExp, token?: string) =>
    assert.rejects(verifyGithubOidc(token ?? (await sign(claims)), expect, fetcher), re);

  await reject({ ...good, repository: "netko/drugi" }, /repozitorij/);
  await reject({ ...good, aud: "nesto" }, /publika/);
  await reject({ ...good, ref: "refs/heads/test" }, /grana/);
  await reject({ ...good, exp: NOW - 3600 }, /istekao/);
  await reject({ ...good, iss: "https://evil.example" }, /izdavatelj/);

  // potpisano drugim ključem, ali s našim kid-om
  const other = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  )) as CryptoKeyPair;
  await reject(good, /potpis/, await sign(good, "k1", other.privateKey));

  // izmijenjen sadržaj nakon potpisa
  const t = (await sign(good)).split(".");
  t[1] = enc({ ...good, repository: "Schkic/samobor-hub", ref: "refs/heads/main", aud: "samobor-hub", extra: 1 });
  await reject(good, /potpis/, t.join("."));

  await reject(good, /JWT/, "nije.token");
});
