import type { Notice, SourceId } from "./types";

interface NoticeRow {
  id: string;
  source: string;
  kind: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  places: string;
  streets: string;
  raw_streets: string;
  note: string | null;
  partial: number;
  url: string;
  first_seen: string;
  notified: number;
}

export function rowToNotice(r: NoticeRow): Notice & { firstSeen: string; notified: boolean } {
  return {
    id: r.id,
    source: r.source as SourceId,
    kind: r.kind,
    date: r.date,
    start: r.start_time,
    end: r.end_time,
    places: JSON.parse(r.places),
    streets: JSON.parse(r.streets),
    rawStreets: r.raw_streets,
    note: r.note,
    partial: r.partial === 1,
    url: r.url,
    firstSeen: r.first_seen,
    notified: r.notified === 1,
  };
}

/**
 * Zamijeni obavijesti jednog izvora za jedan dan. Postojeće (isti id) ostaju
 * netaknute pa im se ne mijenja first_seen/notified; nove se dodaju; one kojih
 * više nema na stranici brišu se (HEP zna otkazati radove).
 * Vraća samo nove obavijesti.
 */
export async function syncDay(
  db: D1Database,
  source: SourceId,
  date: string,
  notices: Notice[],
): Promise<Notice[]> {
  const existing = await db
    .prepare("SELECT id FROM notices WHERE source = ? AND date = ?")
    .bind(source, date)
    .all<{ id: string }>();
  const existingIds = new Set(existing.results.map((r) => r.id));
  const freshIds = new Set(notices.map((n) => n.id));

  const added = notices.filter((n) => !existingIds.has(n.id));
  const removed = [...existingIds].filter((id) => !freshIds.has(id));
  const now = new Date().toISOString();

  const stmts: D1PreparedStatement[] = [];
  for (const n of added) {
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO notices
           (id, source, kind, date, start_time, end_time, places, streets, raw_streets, note, partial, url, first_seen, notified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .bind(
          n.id, n.source, n.kind, n.date, n.start, n.end,
          JSON.stringify(n.places), JSON.stringify(n.streets), n.rawStreets,
          n.note, n.partial ? 1 : 0, n.url, now,
        ),
    );
  }
  for (const id of removed) {
    stmts.push(db.prepare("DELETE FROM notices WHERE id = ?").bind(id));
  }
  if (stmts.length) await db.batch(stmts);
  return added;
}

export async function upcomingNotices(db: D1Database, fromDate: string) {
  const res = await db
    .prepare("SELECT * FROM notices WHERE date >= ? ORDER BY date, start_time")
    .bind(fromDate)
    .all<NoticeRow>();
  return res.results.map(rowToNotice);
}

export async function logRun(
  db: D1Database,
  source: SourceId,
  ok: boolean,
  found: number,
  error?: string,
) {
  await db
    .prepare("INSERT INTO source_runs (source, ran_at, ok, found, error) VALUES (?, ?, ?, ?, ?)")
    .bind(source, new Date().toISOString(), ok ? 1 : 0, found, error ?? null)
    .run();
}
