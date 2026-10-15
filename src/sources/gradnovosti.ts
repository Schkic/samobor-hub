import type { RssItem } from "./najave";

/**
 * Najave iz novosti Grada Samobora (npr. "Proslava Dana grada Samobora" s koncertima),
 * kojih nema u gradskom kalendaru.
 *
 * robots.txt na samobor.hr zabranjuje URL-ove s upitom ("Disallow: /*?"), a popis novosti
 * se učitava upravo tako (?cmd=news…). Zato ga ne koristimo, nego čitamo poveznice na
 * novosti sa stranica /visit i /grad (dopuštene, bez upita) i same novosti (također bez upita).
 * sitemap.xml je zastario i ne sadrži nove novosti.
 */
export const LIST_PAGES: { url: string; eventsOnly: boolean }[] = [
  { url: "https://www.samobor.hr/visit", eventsOnly: false }, // turistička stranica: sve su najave
  { url: "https://www.samobor.hr/grad", eventsOnly: true }, // gradske novosti: samo one o događanjima
];

export interface Article {
  id: number;
  url: string;
  title: string;
  intro: string;
  text: string; // početak teksta novosti
  published: string; // YYYY-MM-DD
  pdf: { url: string; label: string } | null; // npr. "Program proslave Dana grada Samobora"
  eventsOnly: boolean; // došla samo s /grad: prikazati tek ako je o događanjima
}

const ENT: Record<string, string> = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", hellip: "…",
  bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", scaron: "š", Scaron: "Š", zcaron: "ž", Zcaron: "Ž",
};
export const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|[a-zA-Z]+);/g, (m, e: string) => (e[0] === "#" ? String.fromCharCode(+e.slice(1)) : ENT[e] ?? m))
    .replace(/\s+/g, " ")
    .trim();

/** Poveznice na novosti ("...-n12766") s popisne stranice, apsolutne i bez ponavljanja. */
export function parseNewsLinks(html: string): { id: number; url: string }[] {
  const seen = new Map<number, string>();
  for (const m of html.matchAll(/href="((?:https?:\/\/www\.samobor\.hr)?\/[^"?#]*-n(\d+))"/g)) {
    const id = +m[2];
    if (!seen.has(id)) seen.set(id, new URL(m[1], "https://www.samobor.hr/").toString());
  }
  return [...seen].map(([id, url]) => ({ id, url }));
}

export function parseArticle(html: string, url: string, eventsOnly: boolean): Article | null {
  const id = +(/-n(\d+)$/.exec(url)?.[1] ?? NaN);
  const title = decode(/<h1 class="main-title">([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
  const pub = /class="text-date">\s*Objavljeno:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(html);
  if (!title || !pub || isNaN(id)) return null;
  const body = /<div class="my-texts">([\s\S]*?)<p class="text-date">/.exec(html)?.[1] ?? "";
  const pdfM = [...html.matchAll(/<a href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => /program/i.test(decode(m[2])));
  return {
    id,
    url,
    title,
    intro: decode(/<p class="intro">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? ""),
    text: decode(body).slice(0, 2500),
    published: `${pub[3]}-${pub[2].padStart(2, "0")}-${pub[1].padStart(2, "0")}`,
    pdf: pdfM ? { url: new URL(pdfM[1], "https://www.samobor.hr/").toString(), label: decode(pdfM[2]) } : null,
    eventsOnly,
  };
}

/** Je li novost o nekom događanju (za novosti sa stranice /grad)? */
const EVENT_WORDS = /koncert|festival|proslav|manifestacij|sajam|izložb|predstav|dan grada|advent|fašnik|događanj|smotr|natjecanj|utrk|program/i;
export const isEventLike = (a: Article) => !a.eventsOnly || EVENT_WORDS.test(`${a.title} ${a.intro}`);

/** Novosti kao stavke za najaveOverview (isti datumski filter kao kod Radio Samobora). */
export const articlesToItems = (arts: Article[]): RssItem[] =>
  arts.filter(isEventLike).map((a) => ({
    title: a.title,
    url: a.url,
    published: a.published,
    text: `${a.intro}. ${a.text}`,
    source: "samobor.hr",
    pdf: a.pdf,
  }));

// ---------------------------------------------------------------------------
// Dohvat: popisne stranice svakih 6 h, svaka novost samo jednom (predmemorija u D1)
// ---------------------------------------------------------------------------

type Cached = { articles: Article[]; fetchedAt: string; triedAt?: string };
const UA = { headers: { "User-Agent": "MojSamobor/1.0 (+https://mojsamobor.opticora.hr)", "Accept": "text/html", "Accept-Language": "hr" } };

export async function fetchGradNovosti(
  db: D1Database,
  fetcher: typeof fetch = fetch,
  maxAgeMs = 6 * 3600_000,
): Promise<{ articles: Article[]; fetchedAt: string } | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'gradnovosti_data'").first<{ value: string }>();
  const cached = row ? (JSON.parse(row.value) as Cached) : null;
  const last = cached ? Math.max(Date.parse(cached.fetchedAt), cached.triedAt ? Date.parse(cached.triedAt) + 3600_000 - maxAgeMs : 0) : 0;
  if (cached && Date.now() - last < maxAgeMs) return { articles: cached.articles, fetchedAt: cached.fetchedAt };
  const save = (v: Cached) =>
    db
      .prepare("INSERT INTO settings (key, value) VALUES ('gradnovosti_data', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(v))
      .run();
  try {
    // popis: najnovije novosti s obje stranice (s /visit ima prednost, jer je tamo sve najava)
    const links = new Map<number, { url: string; eventsOnly: boolean }>();
    for (const p of LIST_PAGES) {
      const res = await fetcher(p.url, UA);
      if (!res.ok) throw new Error(`${p.url}: HTTP ${res.status}`);
      for (const l of parseNewsLinks(await res.text())) {
        const prev = links.get(l.id);
        links.set(l.id, { url: l.url, eventsOnly: prev ? prev.eventsOnly && p.eventsOnly : p.eventsOnly });
      }
    }
    if (!links.size) throw new Error("na popisnim stranicama nema novosti; izgled se vjerojatno promijenio");
    const have = new Map((cached?.articles ?? []).map((a) => [a.id, a]));
    const newest = [...links].sort((a, b) => b[0] - a[0]).slice(0, 20);
    const articles: Article[] = [];
    let fetched = 0;
    for (const [id, l] of newest) {
      const old = have.get(id);
      if (old) { articles.push({ ...old, eventsOnly: l.eventsOnly }); continue; }
      if (fetched >= 8) continue; // ostale u idućem krugu, da jedan zahtjev ne traje predugo
      fetched++;
      const res = await fetcher(l.url, UA);
      if (!res.ok) continue;
      const a = parseArticle(await res.text(), l.url, l.eventsOnly);
      if (a) articles.push(a);
    }
    const fresh = { articles, fetchedAt: new Date().toISOString() };
    await save(fresh);
    return fresh;
  } catch (e) {
    console.warn("novosti grada: dohvat nije uspio, koristim spremljenu kopiju", e);
    if (!cached) return null;
    await save({ ...cached, triedAt: new Date().toISOString() }).catch(() => {});
    return { articles: cached.articles, fetchedAt: cached.fetchedAt };
  }
}
