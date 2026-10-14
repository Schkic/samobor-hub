// Samobor hub – modul Struja. Bez build koraka; čisti ES moduli.

const $ = (id) => document.getElementById(id);
const KEY = "samobor.adresa";

// ---------------------------------------------------------------- pomoćno

const normalize = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[.\-–—]/g, " ").replace(/\s+/g, " ").trim();

const DANI = ["nedjelja", "ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota"];

function todayZagreb() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** "Danas", "Sutra", "U petak, 16. 10." */
function kada(iso, { velikoSlovo = true } = {}) {
  const today = todayZagreb();
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
  let t;
  if (diff === 0) t = "danas";
  else if (diff === 1) t = "sutra";
  else t = akuzativ(`u ${DANI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d}. ${m}.`);
  return velikoSlovo ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// "u srijeda" → "u srijedu", "u nedjelja" → "u nedjelju", "u subota" → "u subotu"
function akuzativ(s) {
  return s.replace(/\b(u|U) (srijeda|nedjelja|subota)\b/, (_, u, d) => `${u} ${d.slice(0, -1)}u`);
}

const vrijeme = (n) => (n.start && n.end ? `od ${n.start} do ${n.end}` : "tijekom dana");
const opisAdrese = (a) => (a ? `${a.street}${a.houseNumber ? " " + a.houseNumber : ""}${a.place !== "Samobor" && a.street !== a.place ? ", " + a.place : ""}` : "");

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function ucitajAdresu() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function spremiAdresu(a) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* privatni način rada */ }
}

// ---------------------------------------------------------------- adrese

let ADRESE = { town: "Samobor", streets: [], villages: [] };
let adresa = ucitajAdresu();

function popuniNaselja() {
  const sel = $("naselje");
  sel.innerHTML = "";
  sel.append(new Option("Samobor (grad)", ADRESE.town));
  const grupa = document.createElement("optgroup");
  grupa.label = "Ostala naselja";
  for (const v of ADRESE.villages) grupa.append(new Option(v, v));
  sel.append(grupa);
}

function prilagodiUlicu() {
  const place = $("naselje").value;
  const ulica = $("ulica");
  const dl = $("ulice");
  dl.innerHTML = "";
  if (place === ADRESE.town) {
    for (const s of ADRESE.streets) dl.append(new Option(s));
    ulica.placeholder = "Počnite tipkati, npr. Gajeva";
    $("ulica-pomoc").textContent = "";
    if (ADRESE.villages.includes(ulica.value)) ulica.value = "";
  } else {
    ulica.placeholder = place;
    $("ulica-pomoc").textContent = "Ako vaše naselje nema ulice, ostavite naziv naselja.";
    if (!ulica.value || ADRESE.villages.includes(ulica.value) || ADRESE.streets.includes(ulica.value)) ulica.value = place;
  }
}

/** Službeni naziv ulice za upis korisnika: "ljudevita gaja", "Ulica Ljudevita Gaja" i "ul. ljudevita gaja" daju isto. */
function pronadiUlicu(upis) {
  const n = normalize(upis).replace(/^(ulica|ul) /, "").replace(/ ulica$/, "");
  return ADRESE.streets.find((s) => normalize(s).replace(/^(ulica|ul) /, "").replace(/ ulica$/, "") === n) || null;
}

function prikaziObrazac(prikazi) {
  $("adresa-obrazac").hidden = !prikazi;
  $("adresa-sazetak").hidden = prikazi;
  if (!prikazi) $("adresa-tekst").textContent = opisAdrese(adresa);
}

function popuniObrazac() {
  if (!adresa) { prilagodiUlicu(); return; }
  $("naselje").value = adresa.place;
  $("ulica").value = adresa.street;
  $("kbr").value = adresa.houseNumber || "";
  prilagodiUlicu();
}

$("naselje").addEventListener("change", prilagodiUlicu);
$("adresa-promijeni").addEventListener("click", () => {
  prikaziObrazac(true);
  $("ulica").focus();
});

$("adresa-obrazac").addEventListener("submit", async (e) => {
  e.preventDefault();
  const greska = $("adresa-greska");
  greska.hidden = true;
  $("ulica").removeAttribute("aria-invalid");

  const place = $("naselje").value;
  let street = $("ulica").value.trim();
  const houseNumber = $("kbr").value.trim().toUpperCase();

  if (place === ADRESE.town) {
    const sluzbeno = pronadiUlicu(street);
    if (!sluzbeno) {
      greska.textContent = street
        ? `Ulica „${street}" nije na popisu ulica Samobora. Odaberite je s popisa koji se pojavi dok tipkate.`
        : "Upišite ulicu.";
      greska.hidden = false;
      $("ulica").setAttribute("aria-invalid", "true");
      $("ulica").focus();
      return;
    }
    street = sluzbeno;
  } else if (!street) {
    street = place;
  }
  if (houseNumber && !/^\d+[\p{L}\d/ -]*$/u.test(houseNumber)) {
    greska.textContent = "Kućni broj mora počinjati brojem, npr. 12 ili 12A.";
    greska.hidden = false;
    return;
  }

  adresa = { place, street, houseNumber: houseNumber || undefined };
  spremiAdresu(adresa);
  prikaziObrazac(false);
  $("dio-obavijesti").hidden = false;
  await osvjezi();
  // Ako su obavijesti već uključene, pretplati se na novu adresu
  const sub = await trenutnaPretplata();
  if (sub) await pretplati(sub, true);
});

// ---------------------------------------------------------------- isključenja

let sve = [];

function renderStanje(moje) {
  const box = $("stanje");
  const naslov = $("stanje-naslov");
  const tekst = $("stanje-tekst");
  const dalje = $("stanje-dalje");
  box.classList.remove("prazno", "mrak", "kvar");
  dalje.hidden = true;
  dalje.innerHTML = "";

  if (!adresa) {
    box.classList.add("prazno");
    naslov.textContent = "Hoćete li imati struje?";
    tekst.textContent = "Upišite adresu i javit ćemo vam čim HEP najavi isključenje u vašoj ulici.";
    return;
  }

  if (moje.length === 0) {
    naslov.textContent = "Struje će biti.";
    tekst.innerHTML = "";
    tekst.append("HEP za ", Object.assign(document.createElement("span"), { className: "adresa-tag", textContent: opisAdrese(adresa) }), " ne najavljuje isključenja u sljedećih sedam dana.");
    return;
  }

  const [prvo, ...ostalo] = moje;
  box.classList.add("mrak");
  if (prvo.kind === "struja-kvar") box.classList.add("kvar");
  const dan = kada(prvo.date);
  naslov.textContent = `${dan} ${vrijeme(prvo)} nema struje.`;
  tekst.textContent =
    prvo.match === "place"
      ? `HEP najavljuje radove u naselju ${adresa.place}. Popis ulica ${prvo.partial ? "je skraćen" : "ne navodi pojedine ulice"}, pa je moguće da su obuhvaćeni i vi.`
      : `HEP najavljuje radove koji obuhvaćaju ${opisAdrese(adresa)}.`;
  if (prvo.note) tekst.textContent += ` Napomena: ${prvo.note}`;
  if (ostalo.length) {
    dalje.hidden = false;
    for (const n of ostalo) {
      const d = document.createElement("div");
      d.textContent = `Također ${kada(n.date, { velikoSlovo: false })} ${vrijeme(n)}`;
      dalje.append(d);
    }
  }
}

function renderPopis(mojiId) {
  const ul = $("svi-popis");
  ul.innerHTML = "";
  if (sve.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Trenutno nema najavljenih isključenja na području Samobora.";
    ul.append(li);
    return;
  }
  const istaknuto = new URLSearchParams(location.search).get("n");
  for (const n of sve) {
    const li = document.createElement("li");
    if (mojiId.has(n.id)) li.classList.add("moje");
    if (n.id === istaknuto) li.id = "odabrano";
    const k = document.createElement("div");
    k.className = "kad";
    k.textContent = `${kada(n.date)} ${vrijeme(n)}`;
    if (n.kind === "struja-kvar") {
      k.append(" ", Object.assign(document.createElement("span"), { className: "tip-kvar", textContent: "kvar" }));
    }
    const g = document.createElement("div");
    g.className = "gdje";
    const mjesta = n.places.map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(", ");
    g.textContent = `${mjesta}${n.rawStreets ? ": " + n.rawStreets : ""}`;
    li.append(k, g);
    ul.append(li);
  }
  $("odabrano")?.scrollIntoView({ block: "center" });
}

async function osvjezi() {
  try {
    sve = await api("/api/notices");
    let moje = [];
    if (adresa) {
      const q = new URLSearchParams({ place: adresa.place, street: adresa.street });
      if (adresa.houseNumber) q.set("house", adresa.houseNumber);
      moje = await api(`/api/notices?${q}`);
    }
    renderStanje(moje);
    renderPopis(new Set(moje.map((n) => n.id)));
  } catch (e) {
    $("svi-popis").innerHTML = "";
    $("svi-napomena").textContent = `Isključenja se trenutno ne mogu učitati (${e.message}). Pokušajte ponovno za nekoliko minuta.`;
  }
  try {
    const status = await api("/api/status");
    const zadnje = status.runs?.find((r) => r.source === "hep" && r.ok);
    $("provjereno").textContent = zadnje
      ? `Zadnja provjera: ${new Date(zadnje.ran_at).toLocaleString("hr-HR", { timeZone: "Europe/Zagreb", weekday: "long", hour: "2-digit", minute: "2-digit" })}.`
      : "Prva provjera kod HEP-a je danas u 16:00.";
  } catch { /* nije bitno */ }
}

// ---------------------------------------------------------------- obavijesti

const podrzano = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const instalirano = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const poruka = (t) => { $("obavijesti-poruka").textContent = t; };

let registracija = null;

async function trenutnaPretplata() {
  if (!podrzano) return null;
  registracija ??= await navigator.serviceWorker.ready;
  return registracija.pushManager.getSubscription();
}

function base64UrlToBytes(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function pretplati(postojeca, tiho = false) {
  try {
    let sub = postojeca;
    if (!sub) {
      const dozvola = await Notification.requestPermission();
      if (dozvola !== "granted") {
        poruka("Obavijesti nisu dopuštene. Možete ih dopustiti u postavkama preglednika za ovu stranicu.");
        return;
      }
      const { publicKey } = await api("/api/vapid");
      registracija ??= await navigator.serviceWorker.ready;
      sub = await registracija.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
    }
    await api("/api/subscribe", { subscription: sub.toJSON(), address: adresa });
    if (!tiho) poruka(`Uključeno. Javit ćemo vam isključenja za ${opisAdrese(adresa)}.`);
    else poruka(`Obavijesti sada stižu za ${opisAdrese(adresa)}.`);
  } catch (e) {
    poruka(`Obavijesti se nisu uključile: ${e.message}.`);
  }
  await renderObavijesti();
}

async function renderObavijesti() {
  const sub = await trenutnaPretplata();
  const ukljuceno = !!sub && Notification.permission === "granted";
  $("obavijesti-stanje").hidden = !ukljuceno;
  $("ukljuci").hidden = ukljuceno;
  $("proba").hidden = !ukljuceno;
  $("iskljuci").hidden = !ukljuceno;
}

function postaviObavijesti() {
  if (iOS && !instalirano) {
    $("ios-uputa").hidden = false;
    $("ukljuci").hidden = true;
    return;
  }
  if (!podrzano) {
    $("ukljuci").hidden = true;
    poruka("Ovaj preglednik ne podržava obavijesti. Pokušajte u Chromeu, Firefoxu ili Safariju.");
    return;
  }
  $("ukljuci").addEventListener("click", () => pretplati(null));
  $("proba").addEventListener("click", async () => {
    const sub = await trenutnaPretplata();
    if (!sub) return renderObavijesti();
    $("proba").disabled = true;
    try {
      const r = await api("/api/test", { endpoint: sub.endpoint });
      poruka(r.result === "sent" ? "Probna obavijest je poslana. Trebala bi stići za nekoliko sekundi." : "Probna obavijest nije poslana. Isključite pa ponovno uključite obavijesti.");
    } catch (e) {
      poruka(e.message === "pretplata nije pronađena" ? "Ovaj uređaj nije prijavljen. Uključite obavijesti ponovno." : `Probna obavijest nije poslana: ${e.message}.`);
    }
    $("proba").disabled = false;
  });
  $("iskljuci").addEventListener("click", async () => {
    const sub = await trenutnaPretplata();
    if (sub) {
      await api("/api/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    poruka("Obavijesti su isključene na ovom uređaju.");
    renderObavijesti();
  });
  renderObavijesti();
}

// ---------------------------------------------------------------- pokretanje

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

(async () => {
  try {
    ADRESE = await api("/api/addresses");
  } catch { /* obrazac ostaje s gradom */ }
  popuniNaselja();
  popuniObrazac();
  if (adresa) {
    prikaziObrazac(false);
    $("dio-obavijesti").hidden = false;
  }
  postaviObavijesti();
  await osvjezi();
})();
