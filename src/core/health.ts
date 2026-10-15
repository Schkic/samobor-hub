/**
 * Provjera rade li izvori; ako ne rade, administrator (Marko) dobiva push obavijest.
 * Čista funkcija, da se pravila mogu testirati bez baze.
 */
export interface RunRow {
  ok: number | boolean;
  error: string | null;
  ran_at: string;
}

export interface Alert {
  key: string; // jedna obavijest po ključu na dan
  title: string;
  body: string;
}

const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Zagreb", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    : "nikad";

/**
 * - voda: zadnji uspješan VIO dohvat stariji od 3 sata, samo između 10 i 22 h
 *   (prvo pokretanje je u 7:20, pa ujutro još nema smisla uzbunjivati);
 * - struja: zadnja dva HEP pokretanja nisu uspjela.
 */
export function healthAlerts(now: Date, zagrebHour: number, lastVioOk: string | null, hepRuns: RunRow[]): Alert[] {
  const out: Alert[] = [];
  if (zagrebHour >= 10 && zagrebHour <= 22) {
    if (!lastVioOk || now.getTime() - Date.parse(lastVioOk) > 3 * 3600_000) {
      out.push({
        key: "vio-stale",
        title: "MojSamobor: voda se ne osvježava",
        body: `Zadnji uspješan dohvat VIO tablice: ${fmt(lastVioOk)}. Provjeri GitHub Actions (VIO prekidi vode) i ključ GITHUB_DISPATCH_TOKEN.`,
      });
    }
  }
  if (hepRuns.length >= 2 && hepRuns.slice(0, 2).every((r) => !r.ok)) {
    out.push({
      key: "hep-fail",
      title: "MojSamobor: HEP se ne može pročitati",
      body: `Dva pokretanja zaredom nisu uspjela. Zadnja greška: ${(hepRuns[0].error ?? "nepoznata").slice(0, 140)}`,
    });
  }
  return out;
}
