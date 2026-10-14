import type { Notice } from "./types";
import type { MatchLevel } from "./streets";
import type { ZoneOverview, WasteType } from "../sources/odvoz";
import { WASTE_LABEL } from "../sources/odvoz";

/**
 * Vremenska crta za jednu adresu: sve što je vezano uz nju, poredano po danu i satu.
 * Čista funkcija: ulaz su već poklopljene obavijesti i raspored odvoza.
 */

export type TimelineKind = "struja" | "voda" | "odvoz" | "reciklaza";

export interface TimelineItem {
  date: string;
  start: string | null;
  end: string | null;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  urgent: boolean; // isključenje koje pogađa adresu (ne samo "moguće")
  waste?: WasteType[];
  noticeId?: string;
}

export type MatchedNotice = Notice & { match: Exclude<MatchLevel, null> };

const range = (n: { start: string | null; end: string | null }) =>
  n.start && n.end ? `${n.start}–${n.end}` : null;

function noticeItem(n: MatchedNotice): TimelineItem {
  const water = n.source === "vio";
  const what = water ? "vode" : "struje";
  const possible = n.match === "place";
  const fault = n.kind === "struja-kvar";
  return {
    date: n.date,
    start: n.start,
    end: n.end,
    kind: water ? "voda" : "struja",
    title: possible
      ? `Moguće bez ${what}${range(n) ? " " + range(n) : ""}`
      : `Bez ${what}${range(n) ? " " + range(n) : ""}${fault ? " (kvar)" : ""}`,
    detail: possible
      ? `${water ? "VIO" : "HEP"} najavljuje radove u blizini; popis ulica nije potpun.`
      : n.note,
    urgent: !possible,
    noticeId: n.id,
  };
}

function wasteList(types: WasteType[]): string {
  // nazivi već sadrže "i" ("papir i karton"), pa ih odvajamo zarezom
  return types.map((t) => WASTE_LABEL[t].toLowerCase()).join(", ");
}

export function buildTimeline(
  notices: MatchedNotice[],
  odvoz: ZoneOverview | null,
  from: string,
  until: string,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const n of notices) {
    if (n.date >= from && n.date <= until) items.push(noticeItem(n));
  }
  if (odvoz) {
    for (const d of odvoz.days) {
      if (d.date < from || d.date > until) continue;
      const list = wasteList(d.types);
      items.push({
        date: d.date,
        start: null,
        end: null,
        kind: "odvoz",
        title: `Odvoz: ${list}`,
        detail: d.movedFrom ? `Pomaknuto zbog blagdana (umjesto ${d.movedFrom.split("-").reverse().slice(0, 2).map(Number).join(". ")}.).` : null,
        urgent: false,
        waste: d.types,
      });
    }
    for (const y of odvoz.yard) {
      if (y.date < from || y.date > until) continue;
      items.push({
        date: y.date,
        start: null,
        end: null,
        kind: "reciklaza",
        title: "Mobilno reciklažno dvorište",
        detail: `${y.time} h, ${y.place}`,
        urgent: false,
      });
    }
  }
  // Po danu; unutar dana: isključenja prije odvoza, pa po satu
  const rank: Record<TimelineKind, number> = { struja: 0, voda: 0, odvoz: 1, reciklaza: 2 };
  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      rank[a.kind] - rank[b.kind] ||
      (a.start ?? "99").localeCompare(b.start ?? "99"),
  );
}
