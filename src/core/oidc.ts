/**
 * Provjera GitHub Actions OIDC tokena, bez ikakvih tajnih ključeva:
 * GitHub potpisuje JWT svojim ključem (RS256), a mi provjeravamo potpis prema
 * javnim ključevima (JWKS) i da token dolazi iz točno našeg repozitorija i grane.
 * https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect
 */

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`;

export interface OidcExpectations {
  audience: string; // npr. "samobor-hub"
  repository: string; // npr. "Schkic/samobor-hub"
  ref?: string; // npr. "refs/heads/main"
  now?: number; // sekunde, za testove
}

interface Jwks {
  keys: (JsonWebKey & { kid?: string })[];
}

let jwksCache: { at: number; jwks: Jwks } | null = null;

async function getJwks(fetcher: typeof fetch): Promise<Jwks> {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.jwks;
  const res = await fetcher(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS: HTTP ${res.status}`);
  const jwks = (await res.json()) as Jwks;
  jwksCache = { at: Date.now(), jwks };
  return jwks;
}

/** Samo za testove. */
export function resetJwksCache() {
  jwksCache = null;
}

const b64urlBytes = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

export async function verifyGithubOidc(
  token: string,
  expect: OidcExpectations,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("token nije JWT");
  const [h, p, sig] = parts;
  const header = b64urlJson(h) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") throw new Error(`nepodržan alg ${header.alg}`);

  const jwks = await getJwks(fetcher);
  let jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // GitHub je možda rotirao ključeve: osvježi jednom
    jwksCache = null;
    jwk = (await getJwks(fetcher)).keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("nepoznat kid");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error("neispravan potpis");

  const claims = b64urlJson(p) as Record<string, any>;
  const now = expect.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== GITHUB_ISSUER) throw new Error("pogrešan izdavatelj");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expect.audience)) throw new Error("pogrešna publika");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("token je istekao");
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new Error("token još ne vrijedi");
  if (String(claims.repository).toLowerCase() !== expect.repository.toLowerCase()) {
    throw new Error(`pogrešan repozitorij ${claims.repository}`);
  }
  if (expect.ref && claims.ref !== expect.ref) throw new Error(`pogrešna grana ${claims.ref}`);
  return claims;
}
