import { dateRange, todayZagreb } from "./core/dates";
import { logRun, syncDay, upcomingNotices } from "./core/store";
import { matchNotice } from "./core/streets";
import type { Address, Notice } from "./core/types";
import { fetchHepDay, HEP_SAMOBOR } from "./sources/hep";

export interface Env {
  DB: D1Database;
}

/** Koliko dana unaprijed gledamo. HEP objavljuje otprilike tjedan dana. */
const HEP_DAYS_AHEAD = 7;

async function runHep(env: Env): Promise<{ found: number; added: Notice[] }> {
  const days = dateRange(todayZagreb(), HEP_DAYS_AHEAD);
  let found = 0;
  const added: Notice[] = [];
  try {
    for (const day of days) {
      const notices = await fetchHepDay(HEP_SAMOBOR, day);
      found += notices.length;
      added.push(...(await syncDay(env.DB, "hep", day, notices)));
    }
    await logRun(env.DB, "hep", true, found);
  } catch (err) {
    await logRun(env.DB, "hep", false, found, String(err));
    throw err;
  }
  return { found, added };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}

export default {
  /**
   * Cron (vidi wrangler.toml). Nove obavijesti ostaju u bazi s notified=0;
   * push servis iz aplikacije za odvoz otpada ih može pokupiti i poslati
   * pretplatnicima čija adresa odgovara (matchNotice).
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runHep(env).then(({ found, added }) =>
        console.log(`HEP: ${found} obavijesti, ${added.length} novih`),
      ),
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // GET /api/notices                          → sve nadolazeće obavijesti
    // GET /api/notices?place=Samobor&street=Ulica%20grada%20Wirgesa&house=12
    //                                           → samo one koje pogađaju adresu
    if (url.pathname === "/api/notices" && req.method === "GET") {
      const all = await upcomingNotices(env.DB, todayZagreb());
      const place = url.searchParams.get("place");
      const street = url.searchParams.get("street");
      if (!place || !street) return json(all);

      const addr: Address = {
        place,
        street,
        houseNumber: url.searchParams.get("house") ?? undefined,
      };
      const matched = all
        .map((n) => ({ ...n, match: matchNotice(n, addr) }))
        .filter((n) => n.match !== null);
      return json(matched);
    }

    // GET /api/status → zadnja pokretanja izvora, za praćenje
    if (url.pathname === "/api/status") {
      const runs = await env.DB.prepare(
        "SELECT * FROM source_runs ORDER BY ran_at DESC LIMIT 20",
      ).all();
      return json(runs.results);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
