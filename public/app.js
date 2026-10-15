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
    $("ulica-pomoc").textContent = "Ako vaše naselje nema ulice, ostavite naziv naselja.";
    if (!ulica.value || ADRESE.villages.includes(ulica.value) || ADRESE.streets.includes(ulica.value)) ulica.value = place;
  }
}
const pronadiUlicu = (upis) => ADRESE.streets.find((s) => bezUlica(s) === bezUlica(upis)) || null;

function prikaziObrazac(prikazi) {
  $("dio-adresa").hidden = !prikazi;
  $("adresa-sazetak").hidden = prikazi || !adresa;
  $("adresa-odustani").hidden = !adresa;
  if (adresa) {
    $("adresa-tekst").replaceChildren(opisAdrese(adresa));
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
        ? `Ulica „${street}" nije na popisu ulica Samobora. Odaberite je s popisa koji se pojavi dok tipkate.`
        : "Upišite ulicu.";
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
    $("stanje-naslov").textContent = "Što se događa na vašoj adresi?";
    $("stanje-tekst").textContent = "Upišite adresu i na jednom mjestu vidjet ćete isključenja struje i vode te odvoz otpada.";
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

  if (odvoz) {
    $("stanje-naslov").textContent = `${kada(odvoz.date)} je odvoz: ${odvoz.title.replace(/^Odvoz: /, "")}.`;
    $("stanje-tekst").textContent = razlika(odvoz.date) === 1
      ? "Iznesite spremnik večeras ili sutra do 6 sati. Struja i voda: nema najavljenih isključenja."
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
    box.append(el("p", { textContent: `${izvor} ne najavljuje isključenja za vašu adresu.` }));
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
    box.append(el("p", { textContent: `${adresa.street} je podijeljena u više zona odvoza. Odaberite dio ulice u kojem živite:` }));
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
    `Zona ${o.zone}. Podsjetnik večer prije odvoza možete uključiti u obavijestima ispod. Cijeli raspored je u `,
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
    box.append(el("p", { textContent: "Uz vašu ulicu nema stanice gradskih linija. Sljedeći polasci s autobusnog kolodvora (Samobor AK):" }));
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
    box.append(el("p", { className: "sitno", textContent: "Vremena su polasci s početne stanice; do vaše stanice autobus stiže nekoliko minuta kasnije." }));
  }
  box.append(el("p", { className: "sitno" }, "Samoborček, gradske linije. Cijeli vozni red i Autoturist su u ", aplikacija, "."));
}

function renderDogadjanja(d) {
  const box = $("dogadjanja");
  box.innerHTML = "";
  const e = d.events;
  const kalendar = el("a", { href: "https://www.samobor.hr/kalendar-dogadjanja", textContent: "gradskom kalendaru" });
  if (!e) {
    box.append(el("p", {}, "Događanja se trenutno ne mogu učitati. Pogledajte ih u ", kalendar, "."));
    return;
  }
  if (!e.upcoming.length) box.append(el("p", { textContent: "U idućih tjedan dana u gradskom kalendaru nema najavljenih događanja." }));

  const MAX = 12;
  let dan = null, ul = null;
  for (const o of e.upcoming.slice(0, MAX)) {
    if (o.date !== dan) {
      dan = o.date;
      const [naslov, datum] = danOznaka(o.date);
      box.append(el("h3", { className: "dog-dan" }, naslov, el("span", { textContent: ` ${datum}` })));
      ul = el("ul", { className: "dog-popis" });
      box.append(ul);
    }
    const naziv = o.url ? el("a", { href: o.url, textContent: o.title, target: "_blank", rel: "noopener" }) : el("span", { textContent: o.title });
    const li = el("li", { className: o.cancelled ? "otkazano" : "" },
      el("b", { className: "dog-sat", textContent: o.time ?? "" }),
      el("div", {}, naziv, o.cancelled ? el("span", { className: "dog-otkazano", textContent: " otkazano" }) : "",
        el("span", { className: "sitno dog-gdje", textContent: [o.category, o.location].filter(Boolean).join(" · ") })));
    ul.append(li);
  }
  if (e.upcoming.length > MAX) {
    box.append(el("p", { className: "sitno" }, `I još ${e.upcoming.length - MAX} u idućih tjedan dana, u `, kalendar.cloneNode(true), "."));
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
  box.append(el("p", { className: "sitno" }, "Izvor: ", kalendar, " (kino, predstave, izložbe, predavanja, knjižnica, muzej)."));
}

async function osvjezi() {
  renderStanje(null);
  $("dio-crta").hidden = $("dio-teme").hidden = $("dio-obavijesti").hidden = $("dio-dogadjanja").hidden = !adresa;
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
      renderSve(new Set([...d.struja, ...d.voda].map((n) => n.id)));
    } catch (e) {
      $("stanje-naslov").textContent = "Podaci se trenutno ne mogu učitati.";
      $("stanje-tekst").textContent = `${e.message}. Pokušajte ponovno za nekoliko minuta.`;
    }
  } else {
    renderSve(new Set());
  }
}

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
        poruka("Obavijesti nisu dopuštene. Možete ih dopustiti u postavkama preglednika za ovu stranicu.");
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
      ? "Nijedna tema nije odabrana, pa vam zasad ništa nećemo slati."
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
    poruka("Ovaj preglednik ne podržava obavijesti. Pokušajte u Chromeu, Firefoxu ili Safariju.");
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
  try { ADRESE = await api("/api/addresses"); } catch { /* obrazac ostaje s gradom */ }
  popuniNaselja();
  popuniObrazac();
  prikaziObrazac(!adresa);
  postaviObavijesti();
  await osvjezi();
})();
