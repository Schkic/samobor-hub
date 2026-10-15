/**
 * Najave s Radio Samobora: rubrika "Kultura → Najave", RSS
 * https://www.radiosamobor.hr/category/kultura/kultura_najave/feed/
 * (robots.txt dopušta; RSS je namijenjen preuzimanju). Pokriva ono čega u gradskom
 * kalendaru nema: festivale, Greblicu, događanja po selima.
 *
 * Datum događaja piše samo u tekstu ("od 18. do 27. rujna", "u nedjelju, 21. lipnja"),
 * pa ga čitamo iz naslova i opisa. Prikazujemo samo najave koje još nisu prošle.
 */
export const NAJAVE_URL = "https://www.radiosamobor.hr/category/kultura/kultura_najave/feed/";

export interface RssItem {
  title: string;
  url: string;
  published: string; // YYYY-MM-DD
  text: string;
}

export interface Najava {
  title: string;
  url: string;
  published: string;
  from: string | null; // prvi spomenuti datum (ne prije objave)
  until: string | null; // zadnji spomenuti datum
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8230;/g, "…")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(body)?.[1] ?? "";
    const pub = new Date(decode(tag("pubDate")));
    if (isNaN(+pub)) continue;
    items.push({
      title: decode(tag("title")),
      url: decode(tag("link")),
      published: pub.toISOString().slice(0, 10),
      text: decode(tag("description")).replace(/\s*\[…\]\s*$/, ""),
    });
  }
  return items;
}

const MJESECI: Record<string, number> = {
  sijecnja: 1, veljace: 2, ozujka: 3, travnja: 4, svibnja: 5, lipnja: 6,
  srpnja: 7, kolovoza: 8, rujna: 9, listopada: 10, studenog: 11, studenoga: 11, prosinca: 12,
};
const bezKvacica = (s: string) => s.toLowerCase().replace(/[čć]/g, "c").replace(/š/g, "s").replace(/ž/g, "z").replace(/đ/g, "d");

/** Svi datumi "21. lipnja" u tekstu, uz godinu objave (ili iduću, ako je mjesec već prošao). */
export function mentionedDates(text: string, published: string): string[] {
  const [py, pm] = published.split("-").map(Number);
  const out: string[] = [];
  for (const m of bezKvacica(text).matchAll(/\b(\d{1,2})\.\s*(sijecnja|veljace|ozujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga?|prosinca)\b/g)) {
    const day = +m[1], month = MJESECI[m[2]];
    if (day < 1 || day > 31) continue;
    const year = month < pm - 1 ? py + 1 : py; // najava u prosincu za siječanj
    out.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return [...new Set(out)].sort();
}

const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};

/**
 * Što prikazati danas: najave s datumom koji nije prošao (i nije dalje od 60 dana),
 * a one bez datuma ("dolazeće subote") samo 10 dana od objave.
 */
export function najaveOverview(items: RssItem[], today: string): Najava[] {
  const out: Najava[] = [];
  for (const it of items) {
    if (it.published > today) continue;
    const all = mentionedDates(`${it.title}. ${it.text}`, it.published);
    const dates = all.filter((d) => d >= addDays(it.published, -1));
    if (all.length && !dates.length) continue; // spominje samo prošle datume: izvještaj, ne najava
    if (dates.length) {
      const until = dates[dates.length - 1];
      if (until < today || dates[0] > addDays(today, 60)) continue;
      out.push({ title: it.title, url: it.url, published: it.published, from: dates[0], until });
    } else if (it.published >= addDays(today, -10)) {
      out.push({ title: it.title, url: it.url, published: it.published, from: null, until: null });
    }
  }
  return out.sort((a, b) => (a.from ?? a.published).localeCompare(b.from ?? b.published));
}

// ---------------------------------------------------------------------------
// Dohvat (predmemorija u D1)
// ---------------------------------------------------------------------------

type Cached = { items: RssItem[]; fetchedAt: string; triedAt?: string };

export async function fetchNajave(
  db: D1Database,
  fetcher: typeof fetch = fetch,
  maxAgeMs = 6 * 3600_000,
): Promise<{ items: RssItem[]; fetchedAt: string } | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'najave_data'").first<{ value: string }>();
  const cached = row ? (JSON.parse(row.value) as Cached) : null;
  const last = cached ? Math.max(Date.parse(cached.fetchedAt), cached.triedAt ? Date.parse(cached.triedAt) + 3600_000 - maxAgeMs : 0) : 0;
  if (cached && Date.now() - last < maxAgeMs) return { items: cached.items, fetchedAt: cached.fetchedAt };
  const save = (v: Cached) =>
    db
      .prepare("INSERT INTO settings (key, value) VALUES ('najave_data', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(v))
      .run();
  try {
    const res = await fetcher(NAJAVE_URL, {
      headers: { "User-Agent": "MojSamobor/1.0 (+https://mojsamobor.opticora.hr)", "Accept": "application/rss+xml, application/xml" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseRss(await res.text());
    if (!items.length) throw new Error("prazan feed");
    const fresh = { items, fetchedAt: new Date().toISOString() };
    await save(fresh);
    return fresh;
  } catch (e) {
    console.warn("najave: dohvat nije uspio, koristim spremljenu kopiju", e);
    if (!cached) return null;
    await save({ ...cached, triedAt: new Date().toISOString() }).catch(() => {});
    return { items: cached.items, fetchedAt: cached.fetchedAt };
  }
}
