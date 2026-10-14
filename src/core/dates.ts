const TZ = "Europe/Zagreb";

/** Današnji datum u Zagrebu kao YYYY-MM-DD (Worker radi u UTC-u). */
export function todayZagreb(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Niz od `days` uzastopnih datuma počevši od `start` (YYYY-MM-DD). */
export function dateRange(start: string, days: number): string[] {
  const [y, m, d] = start.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
