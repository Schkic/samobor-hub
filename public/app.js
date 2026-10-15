// Samobor hub: struja, voda i odvoz za jednu adresu. Bez build koraka; čisti ES moduli.

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) e.append(c);
  return e;
};
const KEY = "samobor.adresa";

// ---------------------------------------------------------------- pomoćno

const normalize = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[.\-–—]/g, " ").replace(/\s+/g, " ").trim();
const bezUlica = (s) => normalize(s).replace(/^(ulica|ul) /, "").replace(/ ulica$/, "");

const DANI = ["nedjelja", "ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota"];
const DANI_KRATKO = ["Ned", "Pon", "Uto", "Sri", "Čet", "Pet", "Sub"];

function todayZagreb() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const utc = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const razlika = (iso) => Math.round((utc(iso) - utc(todayZagreb())) / 86400000);
const dm = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d}. ${m}.`; };

/** "Danas", "Sutra", "U subotu, 17. 10." */
function kada(iso, velikoSlovo = true) {
  const n = razlika(iso);
  let t;
  if (n === 0) t = "danas";
  else if (n === 1) t = "sutra";
  else t = `u ${DANI[new Date(utc(iso)).getUTCDay()]}, ${dm(iso)}`.replace(/\bu (srijeda|nedjelja|subota)\b/, (_, d) => `u ${d.slice(0, -1)}u`);
  return velikoSlovo ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
/** Oznaka dana u vremenskoj crti: "Danas", "Sutra", "Pon" + "19. 10." */
function danOznaka(iso) {
  const n = razlika(iso);
  const naslov = n === 0 ? "Danas" : n === 1 ? "Sutra" : DANI_KRATKO[new Date(utc(iso)).getUTCDay()];
  return [naslov, dm(iso)];
}
const vrijeme = (n) => (n.start && n.end ? `od ${n.start} do ${n.end}` : "tijekom dana");
const opisAdrese = (a) => (a ? `${a.street}${a.houseNumber ? " " + a.houseNumber : ""}${a.place !== "Samobor" && a.street !== a.place ? ", " + a.place : ""}` : "");

async function api(path, body) {
  // GET uvijek provjerava svježinu, da se dijelovi stranice ne razilaze
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-cache" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function ucitajAdresu() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
function spremiAdresu(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* privatni način */ } }

// ---------------------------------------------------------------- ikone

const SVG_NS = "http://www.w3.org/2000/svg";
const PUTEVI = {
  struja: "M13 2 4 14h7l-1 8 9-12h-7z",
  voda: "M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11z",
  kanta: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  reciklaza: "M7 19H4l3-5M17 19h3l-3-5M12 4l-2 3.5M12 4l2 3.5M8 12l-2-3.5M16 12l2-3.5M9 19h6",
  dogadjaj: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  bus: "M6 17V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v11M6 17h12M6 17v3M18 17v3M6 12h12M9 15h.01M15 15h.01",
};
const BOJA = { struja: "#C99A00", voda: "var(--voda)", m: "var(--k-m)", b: "var(--k-b)", pa: "var(--k-pa)", pe: "var(--k-pe)", reciklaza: "var(--k-r)", bus: "var(--gradna)", dogadjaj: "var(--dogadjaj)" };

function ikona(vrsta, boja) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", PUTEVI[vrsta]);
  const puno = vrsta === "struja" || vrsta === "voda";
  p.setAttribute("fill", puno ? boja : "none");
  p.setAttribute("stroke", boja);
  p.setAttribute("stroke-width", puno ? "1" : "2");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}
/** Ikona za stavku crte: kanta u boji spremnika (ili više kanti za više vrsta). */
function ikonaStavke(s) {
  if (s.kind !== "odvoz") return el("span", { className: "ikone" }, ikona(s.kind, BOJA[s.kind]));
  // jedna kanta po vrsti, u boji spremnika
  return el("span", { className: "ikone" }, ...(s.waste ?? ["m"]).map((t) => ikona("kanta", BOJA[t])));
}

// ---------------------------------------------------------------- adrese

let ADRESE = { town: "Samobor", streets: [], villages: [] };
let adresa = ucitajAdresu();

function popuniNaselja() {
  const sel = $("naselje");
  sel.innerHTML = "";
  sel.append(new Option("Samobor (grad)", ADRESE.town));
  const g = el("optgroup", { label: "Ostala naselja" });
  for (const v of ADRESE.villages) g.append(new Option(v, v));
  sel.append(g);
}
function prilagodiUlicu() {
  const place = $("naselje").value;
  const ulica = $("ulica");
  const dl = $("ulice");
  dl.innerHTML = "";
  if (place === ADRESE.town) {
    for (const s of ADRESE.streets) dl.append(new Option(s));
    ulica.placeholder = "Počnite tipkati, npr. Ljudevita Gaja";
    $("ulica-pomoc").textContent = "";
    if (ADRESE.villages.includes(ulica.value)) ulica.value = "";
  } else {
    ulica.placeholder = place;
    $("ulica-pomoc").textContent = "Ako tvoje naselje nema ulice, ostavi naziv naselja.";
    if (!ulica.value || ADRESE.villages.includes(ulica.value) || ADRESE.streets.includes(ulica.value)) ulica.value = place;
  }
}
const pronadiUlicu = (upis) => ADRESE.streets.find((s) => bezUlica(s) === bezUlica(upis)) || null;

/**
 * Obrazac adrese živi na jednom mjestu u DOM-u i seli se: bez adrese je na početnoj,
 * pri promjeni u postavkama, inače skriven u spremniku.
 */
function prikaziObrazac(prikazi) {
  const f = $("dio-adresa");
  const cilj = !adresa ? $("mjesto-obrasca") : prikazi ? $("mjesto-obrasca-postavke") : document.querySelector(".spremnik-obrasca");
  if (f.parentElement !== cilj) cilj.append(f);
  f.hidden = !(prikazi || !adresa);
  $("adresa-odustani").hidden = !adresa;
  $("adresa-sazetak").hidden = !adresa || prikazi;
  $("adresa-link").hidden = !adresa;
  document.querySelector("nav.dolje").hidden = !adresa;
  if (adresa) {
    $("adresa-tekst").textContent = opisAdrese(adresa);
    $("adresa-sazetak-tekst").textContent = opisAdrese(adresa);
  }
}
function popuniObrazac() {
  if (adresa) {
    $("naselje").value = adresa.place;
    $("ulica").value = adresa.street;
    $("kbr").value = adresa.houseNumber || "";
  }
  prilagodiUlicu();
}

$("naselje").addEventListener("change", prilagodiUlicu);
$("adresa-promijeni").addEventListener("click", () => { prikaziObrazac(true); $("ulica").focus(); });
// ikone pločica
for (const sp of document.querySelectorAll(".pl-ik")) {
  const k = sp.dataset.ik;
  if (k === "voda-struja") sp.append(ikona("voda", BOJA.voda), ikona("struja", BOJA.struja));
  else sp.append(ikona(k, k === "kanta" ? "var(--k-r)" : BOJA[k]));
}
$("adresa-odustani").addEventListener("click", () => { popuniObrazac(); prikaziObrazac(false); });

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
        ? `Ulica „${street}" nije na popisu ulica Samobora. Odaberi je s popisa koji se pojavi dok tipkaš.`
        : "Upiši ulicu.";
      greska.hidden = false;
      $("ulica").setAttribute("aria-invalid", "true");
      $("ulica").focus();
      return;
    }
    street = sluzbeno;
  } else if (!street) street = place;
  if (houseNumber && !/^\d+[\p{L}\d/ -]*$/u.test(houseNumber)) {
    greska.textContent = "Kućni broj mora počinjati brojem, npr. 12 ili 12A.";
    greska.hidden = false;
    return;
  }
  const ista = adresa && adresa.place === place && adresa.street === street;
  adresa = { place, street, houseNumber: houseNumber || undefined, ...(ista && adresa.zone ? { zone: adresa.zone } : {}) };
  spremiAdresu(adresa);
  prikaziObrazac(false);
  if (location.hash.startsWith("#/postavke")) location.hash = "#/";
  await osvjezi();
  await osvjeziPretplatu();
});

/** Ako je uređaj prijavljen, pošalji novu adresu/zonu/teme. */
async function osvjeziPretplatu() {
  const sub = await trenutnaPretplata().catch(() => null);
  if (sub && Notification.permission === "granted") await pretplati(sub, true);
}

// ---------------------------------------------------------------- dashboard

function renderStanje(d) {
  const box = $("stanje");
  box.classList.remove("prazno", "mrak", "kvar");
  const danas = new Date(utc(todayZagreb()));
  $("stanje-dan").textContent = `${DANI[danas.getUTCDay()].charAt(0).toUpperCase()}${DANI[danas.getUTCDay()].slice(1)}, ${dm(todayZagreb())}`;

  if (!d) {
    box.classList.add("prazno");
    $("stanje-naslov").textContent = "Što se događa na tvojoj adresi?";
    $("stanje-tekst").textContent = "Upiši adresu i na jednom mjestu vidjet ćeš isključenja struje i vode, odvoz otpada, autobuse i događanja u gradu.";
    return;
  }

  const blizu = d.timeline.filter((s) => razlika(s.date) <= 1);
  const iskljucenje = blizu.find((s) => s.urgent);
  const odvoz = blizu.find((s) => s.kind === "odvoz");

  if (iskljucenje) {
    box.classList.add("mrak");
    const izvor = [...d.struja, ...d.voda].find((n) => n.id === iskljucenje.noticeId);
    if (izvor?.kind === "struja-kvar") box.classList.add("kvar");
    const sto = iskljucenje.kind === "voda" ? "vode" : "struje";
    $("stanje-naslov").textContent = `${kada(iskljucenje.date)} ${vrijeme(iskljucenje)} nema ${sto}.`;
    const ostalo = blizu.filter((s) => s !== iskljucenje).map((s) => `${kada(s.date)}: ${s.title.charAt(0).toLowerCase()}${s.title.slice(1)}`);
    $("stanje-tekst").textContent = [iskljucenje.detail, ...ostalo].filter(Boolean).join(". ") || `Najava se odnosi na ${opisAdrese(adresa)}.`;
    return;
  }

  // moguće isključenje (radovi u naselju, popis ulica nije potpun): ne "mrak", ali ni "sve po starom"
  const moguce = blizu.find((s) => s.kind === "struja" || s.kind === "voda");
  if (moguce) {
    const sto = moguce.kind === "voda" ? "vode" : "struje";
    $("stanje-naslov").textContent = `${kada(moguce.date)} je moguće isključenje ${sto}, ${vrijeme(moguce)}.`;
    $("stanje-tekst").textContent = [moguce.detail, odvoz ? `${kada(odvoz.date)} je odvoz: ${bezOdvoz(odvoz.title).toLowerCase()}` : null]
      .filter(Boolean).map((t) => t.replace(/[.\s]+$/, "")).join(". ") + ".";
    return;
  }

  if (odvoz) {
    $("stanje-naslov").textContent = `${kada(odvoz.date)} je odvoz: ${odvoz.title.replace(/^Odvoz: /, "")}.`;
    $("stanje-tekst").textContent = razlika(odvoz.date) === 1
      ? "Iznesi spremnik večeras ili sutra do 6 sati. Struja i voda: nema najavljenih isključenja."
      : "Struja i voda: nema najavljenih isključenja za danas i sutra.";
    return;
  }

  const sljedeci = d.timeline.find((s) => s.kind === "odvoz");
  $("stanje-naslov").textContent = "Danas i sutra sve po starom.";
  $("stanje-tekst").textContent = sljedeci
    ? `Nema najavljenih isključenja struje ni vode. Sljedeći odvoz ${kada(sljedeci.date, false)}: ${sljedeci.title.replace(/^Odvoz: /, "")}.`
    : "Nema najavljenih isključenja struje ni vode.";
}

function renderCrta(d) {
  const ol = $("crta");
  ol.innerHTML = "";
  const poDanu = new Map();
  for (const s of d.timeline) poDanu.set(s.date, [...(poDanu.get(s.date) ?? []), s]);
  // Danas i sutra uvijek su prikazani, i kad su prazni
  const t = todayZagreb();
  const sutra = new Date(utc(t) + 86400000).toISOString().slice(0, 10);
  for (const dan of [t, sutra]) if (!poDanu.has(dan)) poDanu.set(dan, []);
  const dani = [...poDanu.keys()].sort();
  for (const dan of dani) {
    const [naslov, datum] = danOznaka(dan);
    const stavke = poDanu.get(dan);
    const ul = el("ul");
    if (!stavke.length) ul.append(el("li", { className: "prazan-dan", textContent: "Ništa najavljeno" }));
    for (const s of stavke) {
      ul.append(el("li", { className: "stavka" + (s.urgent ? " hitno" : "") },
        ikonaStavke(s),
        el("div", {}, el("b", { textContent: s.title }), s.detail ? el("span", { className: "opis", textContent: s.detail }) : null),
      ));
    }
    ol.append(el("li", {}, el("div", { className: "kad" }, naslov, el("small", { textContent: datum })), ul));
  }
}

function provjereno(iso, prazno) {
  if (!iso) return prazno;
  return `Provjereno ${new Date(iso).toLocaleString("hr-HR", { timeZone: "Europe/Zagreb", weekday: "long", hour: "2-digit", minute: "2-digit" })}.`;
}

function temaIskljucenja(id, naziv, vrsta, popis, izvor, zadnje) {
  const box = $(id);
  box.innerHTML = "";
  box.append(el("div", { className: "tema-glava" }, ikona(vrsta, BOJA[vrsta]), el("h3", { textContent: naziv })));
  if (!popis.length) {
    box.append(el("p", { textContent: `${izvor} ne najavljuje isključenja za tvoju adresu.` }));
  } else {
    for (const n of popis) {
      const moguce = n.match === "place";
      box.append(el("p", {},
        el("b", { textContent: `${kada(n.date)} ${vrijeme(n)}` }),
        moguce ? " (moguće, popis ulica nije potpun)" : n.kind === "struja-kvar" ? " (kvar)" : "",
        n.note ? el("span", { className: "sitno", textContent: ` ${n.note}` }) : null,
      ));
    }
  }
  box.append(el("p", { className: "sitno", textContent: provjereno(zadnje, "Prva provjera je u tijeku.") }));
}

const OZNAKE = { m: "Miješani otpad", b: "Biootpad", pa: "Papir i karton", pe: "Plastika i metal" };

function temaOtpad(d) {
  const box = $("tema-otpad");
  box.innerHTML = "";
  box.append(el("div", { className: "tema-glava" }, ikona("kanta", "var(--k-m)"), el("h3", { textContent: "Odvoz otpada" })));
  const o = d.odvoz;
  if (!o) {
    box.append(el("p", { textContent: "Raspored odvoza se trenutno ne može učitati." }));
    return;
  }
  if (!o.zone && o.options.length) {
    box.append(el("p", { textContent: `${adresa.street} je podijeljena u više zona odvoza. Odaberi dio ulice u kojem živiš:` }));
    const zone = el("div", { className: "zone" });
    for (const z of o.options) {
      const b = el("button", { className: "gumb-tihi", type: "button" }, el("b", { textContent: z.zone }), z.note || "cijela ulica");
      b.addEventListener("click", async () => { adresa = { ...adresa, zone: z.zone }; spremiAdresu(adresa); await osvjezi(); await osvjeziPretplatu(); });
      zone.append(b);
    }
    box.append(zone);
    return;
  }
  if (!o.overview) {
    box.append(el("p", { textContent: "Za ovu adresu nema rasporeda odvoza u Komunalčevoj obavijesti." }));
    return;
  }
  const ul = el("ul", { className: "vrste" });
  const poDatumu = [...o.overview.next].sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
  for (const n of poDatumu) {
    const kad = !n.date ? "nema termina" : razlika(n.date) <= 1 ? danOznaka(n.date)[0] : danOznaka(n.date).join(" ");
    ul.append(el("li", {}, ikona("kanta", BOJA[n.type]), el("span", { textContent: OZNAKE[n.type] }),
      el("span", { textContent: kad })));
  }
  box.append(ul);
  const yard = o.overview.yard[0];
  if (yard) box.append(el("p", {}, `Mobilno reciklažno dvorište ${kada(yard.date, false)}, ${yard.time} h, ${yard.place}.`));
  box.append(el("p", { className: "sitno" },
    `Zona ${o.zone}. Podsjetnik večer prije odvoza možeš uključiti u postavkama obavijesti. Cijeli raspored je u `,
    el("a", { href: "https://odvoz-otpada-samobor.opticora.hr/", textContent: "aplikaciji Odvoz otpada" }), "."));
  if (o.options.length > 1) {
    const b = el("button", { className: "gumb-tihi", type: "button", textContent: "Promijeni zonu" });
    b.style.marginTop = "8px";
    b.addEventListener("click", async () => { const { zone, ...bez } = adresa; adresa = bez; spremiAdresu(adresa); await osvjezi(); await osvjeziPretplatu(); });
    box.append(b);
  }
}

function temaAutobusi(d) {
  const box = $("tema-autobusi");
  box.innerHTML = "";
  const b = d.bus;
  box.append(el("div", { className: "tema-glava" }, ikona("bus", BOJA.bus), el("h3", { textContent: "Autobusi" }),
    b ? el("span", { className: "sitno", textContent: `· ${b.dayLabel}` }) : ""));
  const aplikacija = el("a", { href: "https://autobusi-samobor.opticora.hr/", textContent: "aplikaciji Autobusi" });
  if (!b) {
    box.append(el("p", {}, "Vozni red se trenutno ne može učitati. Polaske potražite u ", aplikacija, "."));
    return;
  }
  const vremena = (dir) => {
    if (!dir.next.length) return el("span", { className: "bus-nema", textContent: "danas i sutra nema polazaka" });
    const span = el("span", { className: "bus-vremena" });
    if (dir.tomorrow) span.append(el("span", { className: "bus-sutra", textContent: "sutra" }));
    for (const dep of dir.next) {
      span.append(el("b", { textContent: dep.time, title: dep.note ?? "" }, dep.note ? el("sup", { textContent: "*" }) : ""));
    }
    return span;
  };

  if (b.mode === "nema") {
    box.append(el("p", {}, `Kroz ${adresa.place} ne prolazi gradska linija Samoborčeka. Autoturist i ostale linije su u `, aplikacija, "."));
    return;
  }

  if (b.mode === "kolodvor") {
    box.append(el("p", { textContent: "Uz tvoju ulicu nema stanice gradskih linija. Sljedeći polasci s autobusnog kolodvora (Samobor AK):" }));
    const ul = el("ul", { className: "bus-ploca" });
    for (const r of b.board) {
      ul.append(el("li", {}, el("b", {}, r.time, r.note ? el("sup", { textContent: "*" }) : ""),
        el("span", { className: "bus-oznaka", textContent: r.line }),
        el("span", { textContent: `→ ${r.to}${r.tomorrow ? " (sutra)" : ""}` })));
    }
    box.append(ul);
    const biljeske = [...new Set(b.board.filter((r) => r.note).map((r) => `${r.line}: ${r.note}`))];
    for (const n of biljeske) box.append(el("p", { className: "sitno", textContent: `* ${n}` }));
  } else {
    const prikaz = b.lines.slice(0, 4);
    for (const l of prikaz) {
      const blok = el("div", { className: "bus-linija" });
      blok.append(el("p", { className: "bus-naslov" }, el("span", { className: "bus-oznaka", textContent: l.id }), el("span", { textContent: l.name })));
      if (l.note) blok.append(el("p", { className: "sitno", textContent: l.note }));
      const ul = el("ul", { className: "bus-smjerovi" });
      for (const dir of l.dirs) ul.append(el("li", {}, el("span", { textContent: `${dir.from} → ${dir.to}` }), vremena(dir)));
      blok.append(ul);
      const biljeske = [...new Set(l.dirs.flatMap((x) => x.next.map((n) => n.note).filter(Boolean)))];
      for (const n of biljeske) blok.append(el("p", { className: "sitno", textContent: `* ${n}` }));
      box.append(blok);
    }
    if (b.lines.length > prikaz.length) {
      box.append(el("p", { className: "sitno", textContent: `I još ${b.lines.length - prikaz.length} ${b.lines.length - prikaz.length === 1 ? "linija" : "linije"}: ${b.lines.slice(4).map((l) => l.id).join(", ")}.` }));
    }
    box.append(el("p", { className: "sitno", textContent: "Vremena su polasci s početne stanice; do tvoje stanice autobus stiže nekoliko minuta kasnije." }));
  }
  box.append(el("p", { className: "sitno" }, "Samoborček, gradske linije. Cijeli vozni red i Autoturist su u ", aplikacija, "."));
}

function renderDogadjanja(d) {
  const box = $("dogadjanja");
  box.innerHTML = "";
  const e = d.events;
  const kalendar = el("a", { href: "https://www.samobor.hr/kalendar-dogadjanja", textContent: "gradskom kalendaru" });
  if (!e) {
    box.append(el("p", {}, "Događanja se trenutno ne mogu učitati. Pogledaj ih u ", kalendar, "."));
    return;
  }
  if (!e.calendarOk) box.append(el("p", {}, "Gradski kalendar se trenutno ne može učitati. Pogledaj ga na ", kalendar.cloneNode(true), "."));
  else if (!e.upcoming.length) box.append(el("p", { textContent: "U idućih tjedan dana u gradskom kalendaru nema najavljenih događanja." }));

  // Najave (gradske novosti i Radio Samobor) idu na vrh: to su veća događanja, npr. Dan grada
  if (e.najave?.length) {
    box.append(el("h3", { className: "dog-dan", textContent: "Najave" }));
    const ul = el("ul", { className: "dog-popis" });
    for (const n of e.najave) {
      const kad = !n.from ? "uskoro" : n.from === n.until ? dm(n.from) : `${dm(n.from)}–${dm(n.until)}`;
      const info = el("span", { className: "sitno dog-gdje" }, `${n.source}, ${dm(n.published)}`);
      if (n.pdf) info.append(" · ", el("a", { href: n.pdf.url, textContent: "program (PDF)", target: "_blank", rel: "noopener" }));
      ul.append(el("li", {}, el("b", { className: "dog-sat", textContent: kad }),
        el("div", {}, el("a", { href: n.url, textContent: n.title, target: "_blank", rel: "noopener" }), info)));
    }
    box.append(ul);
  }

  const PRVIH = 6;
  const popis = el("div");
  const prikazi = (lista) => {
    popis.innerHTML = "";
    let dan = null, ul = null;
    for (const o of lista) {
      if (o.date !== dan) {
        dan = o.date;
        const [naslov, datum] = danOznaka(o.date);
        popis.append(el("h3", { className: "dog-dan" }, naslov, el("span", { textContent: ` ${datum}` })));
        ul = el("ul", { className: "dog-popis" });
        popis.append(ul);
      }
      const naziv = o.url ? el("a", { href: o.url, textContent: o.title, target: "_blank", rel: "noopener" }) : el("span", { textContent: o.title });
      ul.append(el("li", { className: o.cancelled ? "otkazano" : "" },
        el("b", { className: "dog-sat", textContent: o.time ?? "" }),
        el("div", {}, naziv, o.cancelled ? el("span", { className: "dog-otkazano", textContent: " otkazano" }) : "",
          el("span", { className: "sitno dog-gdje", textContent: [o.category, o.location].filter(Boolean).join(" · ") }))));
    }
  };
  prikazi(e.upcoming.slice(0, PRVIH));
  box.append(popis);
  if (e.upcoming.length > PRVIH) {
    const gumb = el("button", { className: "gumb-tihi dog-vise", type: "button", textContent: `Prikaži sve u idućih 7 dana (${e.upcoming.length})` });
    gumb.addEventListener("click", () => { prikazi(e.upcoming); gumb.remove(); });
    box.append(gumb);
  }

  if (e.ongoing.length) {
    box.append(el("h3", { className: "dog-dan", textContent: "Izložbe u tijeku" }));
    const iz = el("ul", { className: "dog-popis" });
    for (const x of e.ongoing) {
      const naziv = x.url ? el("a", { href: x.url, textContent: x.title, target: "_blank", rel: "noopener" }) : el("span", { textContent: x.title });
      iz.append(el("li", {}, el("b", { className: "dog-sat", textContent: `do ${dm(x.until)}` }),
        el("div", {}, naziv, el("span", { className: "sitno dog-gdje", textContent: x.location ?? x.organizer ?? "" }))));
    }
    box.append(iz);
  }
  box.append(el("p", { className: "sitno" }, "Izvori: ", kalendar, " (kino, predstave, izložbe, predavanja, knjižnica, muzej), novosti Grada Samobora i ",
    el("a", { href: "https://www.radiosamobor.hr/category/kultura/kultura_najave/", textContent: "najave Radio Samobora" }), "."));
}

async function osvjezi() {
  renderStanje(null);
  for (const id of ["dio-crta", "dio-teme", "dio-obavijesti", "dio-dogadjanja", "pozdrav-blok", "za-tebe-blok", "plocice"]) $(id).hidden = !adresa;
  renderPozdrav();
  if (adresa) {
    try {
      const q = new URLSearchParams({ place: adresa.place, street: adresa.street });
      if (adresa.houseNumber) q.set("house", adresa.houseNumber);
      if (adresa.zone) q.set("zone", adresa.zone);
      const d = await api(`/api/dashboard?${q}`);
      renderStanje(d);
      renderCrta(d);
      temaIskljucenja("tema-struja", "Struja", "struja", d.struja, "HEP", d.sources.hep);
      temaIskljucenja("tema-voda", "Voda", "voda", d.voda, "VIO", d.sources.vio);
      temaOtpad(d);
      temaAutobusi(d);
      renderDogadjanja(d);
      renderPocetna(d);
      skociNaSidro();
      renderSve(new Set([...d.struja, ...d.voda].map((n) => n.id)));
    } catch (e) {
      $("stanje-naslov").textContent = "Podaci se trenutno ne mogu učitati.";
      $("stanje-tekst").textContent = `${e.message}. Pokušaj ponovno za nekoliko minuta.`;
    }
  } else {
    renderSve(new Set());
  }
}

// ---------------------------------------------------------------- početna

function satZagreb() {
  return +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zagreb", hour: "2-digit", hour12: false }).format(new Date());
}
function renderPozdrav() {
  const h = satZagreb();
  $("pozdrav").textContent = h < 10 ? "Dobro jutro! 👋" : h < 18 ? "Dobar dan! 👋" : "Dobra večer! 👋";
}
const bezOdvoz = (t) => t.replace(/^Odvoz: /, "");
const dodajDane = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);

/** "Za tebe sljedećih dana": do 4 najbliže stavke s crte (isključenja, odvoz, reciklažno). */
function renderZaTebe(d) {
  const ul = $("za-tebe");
  ul.innerHTML = "";
  const do7 = dodajDane(todayZagreb(), 7);
  const stavke = d.timeline.filter((s) => s.date < do7).slice(0, 4);
  for (const s of stavke) {
    const [dan] = danOznaka(s.date);
    let opis = s.detail;
    if (s.kind === "odvoz") opis = razlika(s.date) === 1 ? "Iznesi spremnik večeras ili sutra do 6 sati." : razlika(s.date) === 0 ? "Odvoz je danas." : opis;
    ul.append(el("li", { className: s.urgent ? "hitno" : "" }, ikonaStavke(s),
      el("div", {}, el("b", { textContent: `${dan} · ${s.kind === "odvoz" ? "Odvoz: " + bezOdvoz(s.title).toLowerCase() : s.title}` }),
        opis ? el("span", { className: "opis", textContent: opis }) : null)));
  }
  if (!stavke.length) ul.append(el("li", { className: "mirno" }, el("span"), el("div", { textContent: "Idućih 7 dana nema najavljenih isključenja ni odvoza." })));
}

/** Petak–nedjelja ovog tjedna (ako je vikend, od danas do nedjelje). */
function vikend() {
  const t = todayZagreb(), wd = new Date(utc(t)).getUTCDay();
  if (wd === 0) return [t, t];
  if (wd >= 5) return [t, dodajDane(t, 7 - wd)];
  return [dodajDane(t, 5 - wd), dodajDane(t, 7 - wd)];
}

function postaviPlocicu(id, tekst, vazno = false) {
  const sub = $(id).querySelector(".pl-sub");
  sub.textContent = tekst;
  sub.classList.toggle("vazno", vazno);
}

function renderPlocice(d) {
  // Odvoz
  const o = d.odvoz;
  const odv = d.timeline.find((s) => s.kind === "odvoz");
  if (o && !o.zone && o.options?.length) postaviPlocicu("pl-otpad", "Odaberi svoju zonu", true);
  else if (odv) postaviPlocicu("pl-otpad", `${danOznaka(odv.date).join(" ")} · ${bezOdvoz(odv.title).toLowerCase()}`);
  else postaviPlocicu("pl-otpad", "Raspored i podsjetnici");

  // Autobusi: najraniji današnji polazak (kod sela prednost ima smjer prema Samoboru)
  const b = d.bus;
  let bus = "Linije i polasci";
  if (b?.mode === "stanica") {
    const kandidati = b.lines.flatMap((l) => l.dirs.filter((x) => !x.tomorrow && x.next.length).map((x) => ({ l, x })));
    const prema = kandidati.filter(({ x }) => /samobor ak/i.test(x.to));
    const izbor = (prema.length ? prema : kandidati).sort((a, z) => a.x.next[0].time.padStart(5, "0").localeCompare(z.x.next[0].time.padStart(5, "0")))[0];
    if (izbor) bus = `${izbor.l.id} → ${izbor.x.to.replace(/^Samobor AK$/, "Samobor")} u ${izbor.x.next[0].time}`;
  } else if (b?.mode === "kolodvor" && b.board[0]) {
    bus = `${b.board[0].line} s kolodvora u ${b.board[0].time}`;
  }
  postaviPlocicu("pl-autobusi", bus);

  // Voda i struja
  const isk = [...d.struja, ...d.voda].sort((a, z) => a.date.localeCompare(z.date))[0];
  if (isk) {
    const moguce = isk.match === "place";
    postaviPlocicu("pl-struja", `${danOznaka(isk.date)[0]}: ${moguce ? "moguće " : ""}bez ${isk.source === "vio" ? "vode" : "struje"}${isk.start ? " od " + isk.start : ""}`, !moguce && razlika(isk.date) <= 1);
  }
  else postaviPlocicu("pl-struja", "Nema najava za tvoju adresu");

  // Događanja i vikend
  const e = d.events;
  postaviPlocicu("pl-dogadjanja", e ? `${e.upcoming.length} u idućih 7 dana${e.ongoing.length ? ` · ${e.ongoing.length} izložbe` : ""}` : "Što se događa");
  const [od, doV] = vikend();
  const najava = e?.najave?.find((n) => n.from && n.from <= doV && (n.until ?? n.from) >= od);
  const uVikendu = (e?.upcoming ?? []).filter((u) => u.date >= od && u.date <= doV && !u.cancelled);
  $("vikend-sub").textContent = najava
    ? `${najava.title}, ${najava.from === najava.until ? dm(najava.from) : `${dm(najava.from)}–${dm(najava.until)}`}${uVikendu.length ? ` · i još ${uVikendu.length} u kalendaru` : ""}`
    : uVikendu.length
      ? `${uVikendu.length} u gradskom kalendaru: ${[...new Set(uVikendu.map((u) => u.title))].slice(0, 2).join(", ")}…`
      : "Pogledaj sva događanja u gradu";
}

function renderPocetna(d) {
  renderZaTebe(d);
  renderPlocice(d);
}

// ---------------------------------------------------------------- zasloni (#/, #/kalendar, #/istrazi/otpad, #/postavke/obavijesti)

const SIDRA = { struja: "tema-struja", voda: "tema-voda", otpad: "tema-otpad", autobusi: "tema-autobusi", dogadjanja: "dio-dogadjanja", podrucje: "dio-svi", adresa: "dio-adresa-sazetak", obavijesti: "dio-obavijesti" };
function usmjeri() {
  const [p, sidro] = location.hash.replace(/^#\/?/, "").split("/");
  const pogled = ["kalendar", "istrazi", "postavke"].includes(p) && (adresa || p === "postavke") ? p : "pocetna";
  for (const v of document.querySelectorAll(".pogled")) v.hidden = v.dataset.pogled !== pogled;
  for (const a of document.querySelectorAll("nav.dolje a")) {
    if (a.dataset.za === pogled) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (pogled === "postavke" && sidro === "adresa" && adresa) { prikaziObrazac(true); $("ulica").focus({ preventScroll: true }); }
  if (sidro && $(SIDRA[sidro])) skociNaSidro();
  else scrollTo(0, 0);
}
/** Skok na dio stranice; ponavlja se nakon učitavanja podataka, jer sadržaj iznad pomakne cilj. */
function skociNaSidro() {
  const sidro = location.hash.replace(/^#\/?/, "").split("/")[1];
  const cilj = sidro && $(SIDRA[sidro]);
  if (cilj && !cilj.closest(".pogled")?.hidden) requestAnimationFrame(() => cilj.scrollIntoView({ block: "start" }));
}
addEventListener("hashchange", usmjeri);

async function renderSve(moji) {
  const ul = $("svi-popis");
  try {
    const sve = await api("/api/notices");
    ul.innerHTML = "";
    if (!sve.length) {
      ul.append(el("li", { textContent: "Trenutno nema najavljenih isključenja struje ni vode na području Samobora." }));
      return;
    }
    const odabrano = new URLSearchParams(location.search).get("n");
    for (const n of sve) {
      const sto = n.source === "vio" ? "Bez vode" : "Bez struje";
      const li = el("li", { className: moji.has(n.id) ? "moje" : "" },
        el("div", { className: "kad" }, `${kada(n.date)} ${vrijeme(n)}: ${sto.toLowerCase()}`,
          n.kind === "struja-kvar" ? el("span", { className: "tip-kvar", textContent: " (kvar)" }) : null),
        el("div", { className: "gdje", textContent: `${n.places.map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(", ")}${n.rawStreets ? ": " + n.rawStreets : ""}` }),
      );
      if (n.id === odabrano) li.id = "odabrano";
      ul.append(li);
    }
    $("odabrano")?.scrollIntoView({ block: "center" });
  } catch (e) {
    ul.innerHTML = "";
    $("svi-napomena").textContent = `Najave se trenutno ne mogu učitati (${e.message}).`;
  }
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
// Teme se pamte na uređaju; zadano struja i voda (odvoz već šalje aplikacija Odvoz otpada)
const TEME_KLJUC = "samobor.teme";
function ucitajTeme() {
  try {
    const t = JSON.parse(localStorage.getItem(TEME_KLJUC));
    if (Array.isArray(t)) return t.filter((x) => ["struja", "voda", "odvoz"].includes(x));
  } catch { /* nema spremljenih */ }
  return ["struja", "voda"];
}
function odabraneTeme() {
  return [...document.querySelectorAll('#teme-izbor input[name="tema"]:checked')].map((i) => i.value);
}
const NAZIV_TEME = { struja: "struja", voda: "voda", odvoz: "odvoz otpada" };
const popisTema = (t) => t.map((x) => NAZIV_TEME[x]).join(", ").replace(/, ([^,]*)$/, " i $1");

async function pretplati(postojeca, tiho = false) {
  try {
    let sub = postojeca;
    if (!sub) {
      // Ako je dozvola ranije odbijena, preglednik više ne pita; to treba reći odmah
      const dozvola = Notification.permission === "denied" ? "denied" : await Notification.requestPermission();
      if (dozvola !== "granted") {
        poruka("Obavijesti nisu dopuštene. Možeš ih dopustiti u postavkama preglednika za ovu stranicu.");
        return;
      }
      const { publicKey } = await api("/api/vapid");
      registracija ??= await navigator.serviceWorker.ready;
      sub = await registracija.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
    }
    const { zone, ...bezZone } = adresa;
    const teme = odabraneTeme();
    await api("/api/subscribe", { subscription: sub.toJSON(), address: bezZone, topics: teme, zone: zone ?? null });
    poruka(!teme.length
      ? "Nijedna tema nije odabrana, pa ti zasad ništa nećemo slati."
      : `${tiho ? "Spremljeno" : "Uključeno"}. Za ${opisAdrese(adresa)} javljamo: ${popisTema(teme)}.`);
  } catch (e) {
    poruka(`Obavijesti se nisu uključile: ${e.message}.`);
  }
  await renderObavijesti();
}
async function renderObavijesti() {
  const sub = await trenutnaPretplata();
  const da = !!sub && Notification.permission === "granted";
  $("obavijesti-stanje").hidden = !da;
  $("ukljuci").hidden = da;
  $("proba").hidden = !da;
  $("iskljuci").hidden = !da;
}
function postaviObavijesti() {
  if (iOS && !instalirano) { $("ios-uputa").hidden = false; $("ukljuci").hidden = true; return; }
  if (!podrzano) {
    $("ukljuci").hidden = true;
    poruka("Ovaj preglednik ne podržava obavijesti. Pokušaj u Chromeu, Firefoxu ili Safariju.");
    return;
  }
  const teme = ucitajTeme();
  for (const i of document.querySelectorAll('#teme-izbor input[name="tema"]')) {
    i.checked = teme.includes(i.value);
    i.addEventListener("change", async () => {
      try { localStorage.setItem(TEME_KLJUC, JSON.stringify(odabraneTeme())); } catch { /* privatni način */ }
      const sub = await trenutnaPretplata();
      if (sub && Notification.permission === "granted") await pretplati(sub, true);
    });
  }
  $("ukljuci").addEventListener("click", () => pretplati(null));
  $("proba").addEventListener("click", async () => {
    const sub = await trenutnaPretplata();
    if (!sub) return renderObavijesti();
    $("proba").disabled = true;
    try {
      const r = await api("/api/test", { endpoint: sub.endpoint });
      poruka(r.result === "sent" ? "Probna obavijest je poslana. Trebala bi stići za nekoliko sekundi." : "Probna obavijest nije poslana. Isključi pa ponovno uključi obavijesti.");
    } catch (e) {
      poruka(e.message === "pretplata nije pronađena" ? "Ovaj uređaj nije prijavljen. Uključi obavijesti ponovno." : `Probna obavijest nije poslana: ${e.message}.`);
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
  try { ADRESE = await api("/api/addresses"); } catch { /* obrazac ostaje s gradom */ }
  popuniNaselja();
  popuniObrazac();
  prikaziObrazac(!adresa);
  postaviObavijesti();
  if (new URLSearchParams(location.search).has("n") && !location.hash) location.replace("#/istrazi/podrucje");
  usmjeri();
  await osvjezi();
})();
