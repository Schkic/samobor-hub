# samobor-hub

Zajednička pozadina za Samobor aplikacije (odvoz otpada, autobusi, struja, voda…).
Svaki izvor je mali scraper koji svoje obavijesti svodi na isti `Notice` format;
baza, API i poklapanje s adresom korisnika su zajednički.

## Izvori

| Izvor | Status | Odakle |
|---|---|---|
| HEP – isključenja struje | ✅ gotovo | `hep.hr/ods/bez-struje/19?dp=zagreb&el=115&datum=DD.MM.YYYY` (TJ Samobor) |
| VIO – prekidi vode | ✅ gotovo | tablica na vio.hr, filtrirana na Samobor i naselja; svaki sat preko GitHub Actions (vio.hr Cloudflareu vraća prazan odgovor), hub provjerava GitHubov OIDC token |
| Odvoz otpada | ✅ samo čitanje | javni `data.json` aplikacije za odvoz (aplikacija se ne dira) |
| Autobusi | poveznica | aplikacija autobusi-samobor.opticora.hr |
| Događanja | kasnije | TZ Samobor, POU, knjižnica |

## Struktura

```
src/
  core/types.ts     Notice, StreetSegment, Address – zajednički format
  core/streets.ts   normalizacija ulica, parser popisa ulica, matchNotice()
  core/store.ts     D1: syncDay (nove/otkazane obavijesti), upit
  core/dates.ts     datumi u Europe/Zagreb
  sources/hep.ts    HEP scraper (čisti parser + fetch)
  worker.ts         cron + API
test/               node:test, fixture-i su stvarni HEP odgovori
```

## Parser ulica

HEP-ove terenske jedinice pišu popis ulica slobodnim tekstom i svaka drugačije.
Parser podržava (sve provjereno na stvarnim podacima, 44 unosa iz 7 jedinica):

- `MARIBORSKA 2-24 par, 1-do kraja nep` – rasponi, paritet, "do kraja"
- `TRPINJSKA 13-23 obje, 23/A DIVKA BUDAKA 2/A` – broj ispred nove ulice pripada prethodnoj
- `SAVSKI GAJ III`, `I. PETRUŠEVEC IV ODVOJAK`, `151. SAMOBORSKE BRIGADE` – rimski/redni brojevi u nazivu
- `Nazora od k. br. 10-44 i od k. br. 5-29 te Kijevska ulica u cijelosti.` – proza
- `ČIČKA POLJANA od kč.br.116-204 i KUČE; ULICA … (ODRANSKI RIBIĆ)` – kč.br., točka-zarez, zagrade
- `BRDOVEC:BREGOVITA ULICA 125, … 2-42 parPRIGORJE BRDOVEČKO:…` – mjesto kao prefiks, zalijepljeni tekst
- `76.78 par`, `68/ A`, `VOĆARSKAULICA` – tipfeleri
- `KRIŽEVĆEC`, `SVE ULICE` – cijelo naselje
- `KSAVERSKA,MIHALJEVAC,MLINOVI...` – skraćen popis → javlja se cijelom naselju

`matchNotice(notice, adresa)` vraća `"address"` (pogođen kućni broj), `"street"`
(ulica, broj nepoznat), `"place"` (cijelo naselje ili skraćen popis) ili `null`.
Kad nije siguran, radije javi nego propusti.

## Pokretanje

```bash
npm install
npm test                         # 44 testa
# D1 baza već postoji (database_id je u wrangler.toml)
npm run db:init                  # schema.sql (već pokrenuta, idempotentno)
npm run dev                      # lokalno; cron: curl "localhost:8787/__scheduled"
npm run deploy
```

## API

- `GET /api/notices` – sve nadolazeće obavijesti
- `GET /api/notices?place=Samobor&street=Ulica%20grada%20Wirgesa&house=12` – samo za tu adresu, s poljem `match`
- `GET /api/dashboard?place=&street=&house=&zone=` – sve za adresu: vremenska crta (14 dana), struja, voda, zona i raspored odvoza
- `GET /api/status` – zadnja pokretanja scrapera i broj pretplata
- `GET /api/addresses` – naselja i ulice za odabir adrese
- `GET /api/vapid` – javni ključ za `pushManager.subscribe()`
- `POST /api/subscribe` `{subscription, address}`, `POST /api/unsubscribe` `{endpoint}`
- `POST /api/test` `{endpoint}` – probna obavijest samo na taj uređaj

## Sučelje i push obavijesti

`public/` je PWA (bez build koraka): korisnik odabere naselje i ulicu (popis od
Komunalca, `src/data/addresses.ts`), vidi stanje za svoju adresu i uključi obavijesti.

- Web Push: `aes128gcm` + VAPID (`@block65/webcrypto-web-push`), radi i na iPhoneu
  (iOS 16.4+, kad je stranica dodana na početni zaslon).
- VAPID ključ Worker generira sam pri prvom zahtjevu i čuva u D1 (`settings`).
- Nakon svakog scrapanja: "najava" čim se isključenje pojavi, "danas" ujutro na dan
  isključenja. Tablica `deliveries` sprječava duplikate; pretplate koje push servis
  odbije (404/410) se brišu.
- Postojeće aplikacije (odvoz, autobusi) se ne diraju, hub ih samo povezuje.

## Deploy

Cloudflare Workers Builds je spojen na ovaj repo: svaki push na `main` sam
builda i deploya Worker (bez API tokena i GitHub secreta). GitHub Action
`Testovi` usporedno provjerava tipove i pokreće testove.
