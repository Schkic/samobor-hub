/**
 * Događanja iz gradskog kalendara: https://www.samobor.hr/kalendar-dogadjanja
 * (kino, predstave, izložbe, predavanja, knjižnica, muzej). Jedan kalendar za sve
 * gradske ustanove; "visit" i "kultura" prikazuju isti popis.
 *
 * robots.txt na samobor.hr: općim botovima kalendar je dopušten, ali ne URL-ovi s
 * upitom ("Disallow: /*?"). Zato čitamo samo /kalendar-dogadjanja, bez parametara,
 * i najviše svakih nekoliko sati (predmemorija u D1).
 */
export const EVENTS_URL = "https://www.samobor.hr/kalendar-dogadjanja";

export interface EventDate {
  date: string; // YYYY-MM-DD
  time: string | null; // "20:00"
}

export interface CityEvent {
  id: string;
  title: string;
  category: string | null; // "Filmovi", "Izložbe", "Predstave"…
  dates: EventDate[];
  location: string | null;
  organizer: string | null;
  note: string | null; // kratak opis ispod naslova
  url: string | null;
  cancelled: boolean;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const iso = (d: string) => {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(d);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

function hashId(s: string): string {
  // FNV-1a, dovoljno za stabilan ključ događaja
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function parseCalendarHtml(html: string): CityEvent[] {
  const articles = [...html.matchAll(/<article class="media-small[^"]*">([\s\S]*?)<\/article>/g)];
  if (!articles.length) throw new Error("kalendar: nema događanja na stranici, struktura se možda promijenila");
  const events: CityEvent[] = [];
  for (const [, body] of articles) {
    // Svaki podatak je u kartici dvaput (mobilni i desktop prikaz); uzimamo samo prvi dio.
    const part = body.split('<span class="ovrl-box')[0];
    const title = decode(/<div class="h4">([\s\S]*?)<\/div>/.exec(part)?.[1] ?? "");
    if (!title) continue;
    const dates: EventDate[] = [];
    for (const m of part.matchAll(/<span style="display: block;">([\s\S]*?)<\/span>/g)) {
      const text = decode(m[1]);
      const date = iso(text);
      if (!date) continue;
      const time = /(\d{1,2}):(\d{2})/.exec(text.replace(/^\S+/, ""));
      dates.push({ date, time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : null });
    }
    if (!dates.length) continue;
    const field = (cls: string, label: string) => {
      const m = new RegExp(`<p class="${cls}">[\\s\\S]*?${label}:<\\/b>([\\s\\S]*?)<\\/p>`).exec(part);
      return m ? decode(m[1]) || null : null;
    };
    const url = /<a href="([^"]+)"[^>]*class="link-all lnk"/.exec(part)?.[1] ?? null;
    const note = decode(/<div class="h4">[\s\S]*?<\/div>\s*<p>([\s\S]*?)<\/p>/.exec(part)?.[1] ?? "") || null;
    const category = decode(/<label>([\s\S]*?)<\/label>/.exec(part)?.[1] ?? "") || null;
    events.push({
      id: hashId(`${title}|${dates[0].date}|${dates[0].time ?? ""}`),
      title: title.replace(/\s*Otkazano zbog [^A-ZČĆŠŽĐ]*/u, " ").replace(/\s+/g, " ").trim(),
      category,
      dates,
      location: field("lokacija", "Lokacija"),
      organizer: field("organizator", "Organizator"),
      note,
      url: url ? new URL(url.replace(/&amp;/g, "&"), "https://www.samobor.hr/").toString() : null,
      cancelled: /otkazan/i.test(title),
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Pregled za aplikaciju
// ---------------------------------------------------------------------------

export interface Occurrence {
  id: string;
  date: string;
  time: string | null;
  title: string;
  category: string | null;
  location: string | null;
  url: string | null;
  cancelled: boolean;
}

export interface Ongoing {
  id: string;
  title: string;
  category: string | null;
  from: string;
  until: string;
  location: string | null;
  organizer: string | null;
  url: string | null;
}

export interface EventsOverview {
  upcoming: Occurrence[]; // od danas do `days` dana unaprijed
  ongoing: Ongoing[]; // izložbe i slično što traje danima
}

const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};

/** Traje li događaj danima (izložba): puno datuma, većinom bez sata. */
const isRunning = (e: CityEvent) => {
  const days = new Set(e.dates.map((d) => d.date));
  return days.size > 7 && e.dates.filter((d) => !d.time).length >= days.size / 2;
};

export function eventsOverview(events: CityEvent[], today: string, days = 7, nowTime?: string): EventsOverview {
  const until = addDays(today, days); // isključivo
  const upcoming: Occurrence[] = [];
  const ongoing: Ongoing[] = [];
  for (const e of events) {
    const sorted = [...e.dates].sort((a, b) => a.date.localeCompare(b.date));
    const from = sorted[0].date, last = sorted[sorted.length - 1].date;
    if (isRunning(e)) {
      if (from <= today && last >= today) {
        ongoing.push({ id: e.id, title: e.title, category: e.category, from, until: last, location: e.location, organizer: e.organizer, url: e.url });
      }
      // otvorenje (datum sa satom) ide i u popis, ako je u prozoru
      for (const d of e.dates.filter((x) => x.time && x.date >= today && x.date < until)) {
        upcoming.push({ id: e.id, date: d.date, time: d.time, title: `Otvorenje: ${e.title}`, category: e.category, location: e.location, url: e.url, cancelled: e.cancelled });
      }
      continue;
    }
    for (const d of e.dates) {
      if (d.date < today || d.date >= until) continue;
      if (d.date === today && nowTime && d.time && d.time < nowTime) continue; // već počelo
      upcoming.push({ id: e.id, date: d.date, time: d.time, title: e.title, category: e.category, location: e.location, url: e.url, cancelled: e.cancelled });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99") || a.title.localeCompare(b.title, "hr"));
  ongoing.sort((a, b) => a.until.localeCompare(b.until));
  return { upcoming, ongoing };
}

// ---------------------------------------------------------------------------
// Dohvat (predmemorija u D1)
// ---------------------------------------------------------------------------

type Cached = { events: CityEvent[]; fetchedAt: string; triedAt?: string };

export async function fetchEvents(
  db: D1Database,
  fetcher: typeof fetch = fetch,
  maxAgeMs = 6 * 3600_000,
): Promise<{ events: CityEvent[]; fetchedAt: string } | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'events_data'").first<{ value: string }>();
  const cached = row ? (JSON.parse(row.value) as Cached) : null;
  // nakon neuspjeha ne pokušavaj pri svakom otvaranju stranice, nego tek za sat
  const last = cached ? Math.max(Date.parse(cached.fetchedAt), cached.triedAt ? Date.parse(cached.triedAt) + 3600_000 - maxAgeMs : 0) : 0;
  if (cached && Date.now() - last < maxAgeMs) return { events: cached.events, fetchedAt: cached.fetchedAt };
  const save = (v: Cached) =>
    db
      .prepare("INSERT INTO settings (key, value) VALUES ('events_data', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(v))
      .run();
  try {
    const res = await fetcher(EVENTS_URL, {
      headers: {
        "User-Agent": "MojSamobor/1.0 (+https://mojsamobor.opticora.hr)",
        "Accept": "text/html",
        "Accept-Language": "hr",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = parseCalendarHtml(await res.text());
    const fresh = { events, fetchedAt: new Date().toISOString() };
    await save(fresh);
    return fresh;
  } catch (e) {
    console.warn("kalendar: dohvat nije uspio, koristim spremljenu kopiju", e);
    if (!cached) return null;
    await save({ ...cached, triedAt: new Date().toISOString() }).catch(() => {});
    return { events: cached.events, fetchedAt: cached.fetchedAt };
  }
}
