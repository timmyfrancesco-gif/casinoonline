# Casinò Verde: casinò a fiches virtuali

Casinò online **dimostrativo** con roulette europea, slot, blackjack e video poker, giocato
esclusivamente con **fiches virtuali**: server autoritativo, registro contabile append-only, esiti
**provably fair** verificabili nel browser e protezioni di **gioco responsabile** integrate.
Interfaccia in italiano.

> [!IMPORTANT]
> **Nessun denaro reale.** Le fiches non si comprano, non si vincono premi, non si convertono in
> denaro e non si trasferiscono tra utenti. Solo maggiorenni.
>
> In Italia offrire giochi con vincite in denaro richiede una **concessione dell'Agenzia delle
> Dogane e dei Monopoli (ADM)**, e la **pubblicità** di giochi o scommesse con vincite in denaro è
> vietata (art. 9 del DL 87/2018, "Decreto Dignità", convertito dalla L. 96/2018). Questo progetto
> non è un operatore di gioco, non contiene link o pubblicità di operatori e non deve essere
> modificato per accettare denaro, vendere fiches o assegnare premi.
>
> Se il gioco ti preoccupa: **Telefono Verde Nazionale per le problematiche legate al Gioco
> d'Azzardo (ISS) 800 558 822**, gratuito e anonimo.

## Indice

- [Funzionalità](#funzionalità)
- [Screenshot](#screenshot)
- [Architettura](#architettura)
- [Avvio rapido (sviluppo)](#avvio-rapido-sviluppo)
- [Avvio con Docker Compose](#avvio-con-docker-compose)
- [Script](#script)
- [Test](#test)
- [Struttura del progetto](#struttura-del-progetto)
- [Configurazione](#configurazione)
- [Deploy in produzione](#deploy-in-produzione)
- [Sicurezza](#sicurezza)
- [Gioco responsabile](#gioco-responsabile)
- [Documentazione](#documentazione)
- [Licenza](#licenza)

## Funzionalità

- **Quattro giochi** con regole, pagamenti e ritorno teorico visibili a ogni tavolo
  ([docs/GIOCHI.md](docs/GIOCHI.md)):
  - **Roulette europea** (un solo zero) con tappeto cliccabile: pieni, cavalli, terzine, carré,
    sestine, dozzine, colonne e puntate semplici. Vantaggio del banco 2,70%.
  - **Slot Frutta** a 3 rulli e una linea, RTP esatto 93,65%, nessun near-miss pilotato.
  - **Blackjack** a 6 mazzi rimescolati a ogni mano, banco fermo su 17, blackjack pagato 3:2,
    raddoppio e divisione, suggerimento facoltativo della strategia di base (≈ 99,5%).
  - **Video Poker Jacks or Better 9/6** (99,54% con strategia ottimale) con suggerimento calcolato
    esattamente nel browser.
- **Provably fair**: ogni partita deriva da HMAC-SHA256(server seed, client seed:nonce); impronta
  del server seed mostrata prima di giocare, rotazione dei seed, **verifica nel browser** e script
  indipendente ([docs/PROVABLY_FAIR.md](docs/PROVABLY_FAIR.md)).
- **Server autoritativo**: esiti, saldo e carte coperte esistono solo sul server; idempotenza delle
  puntate; mani di blackjack e video poker riprese dopo un ricaricamento.
- **Integrità del saldo**: registro append-only in PostgreSQL, saldo mai negativo, ogni movimento in
  una transazione con lock di riga (anche con richieste parallele da più schede).
- **Gioco responsabile** ([docs/GIOCO_RESPONSABILE.md](docs/GIOCO_RESPONSABILE.md)): limiti di
  perdita 24 h / 7 giorni / 30 giorni (aumenti dopo 24 h), pausa non revocabile, promemoria di gioco
  bloccante, statistiche oneste, "Ricomincia" che non cancella nulla. Niente bonus, streak,
  notifiche, autoplay, turbo, classifiche.
- **Storico** paginato con filtro per gioco, dettaglio di ogni partita ed **export CSV**.
- **Profilo**: statistiche, seed e rotazione, cambio password, **cancellazione completa
  dell'account**.
- **Privacy minima**: solo nome utente e hash della password; la data di nascita serve a verificare i
  18 anni e non viene salvata.
- **Accessibilità**: navigazione da tastiera, annunci `aria-live` degli esiti, contrasto AA, rosso e
  nero distinguibili anche senza colore, `prefers-reduced-motion`, tema scuro "tavolo verde" e tema
  chiaro, layout responsive fino a 360 px.
- **Sicurezza**: scrypt, cookie `HttpOnly`/`SameSite`, protezione CSRF, CSP restrittiva, rate
  limit, validazione zod di ogni input ([Sicurezza](#sicurezza)).

## Screenshot

Catturati dai test end-to-end (`E2E_SCREENSHOT_DIR=<cartella> pnpm test:e2e` salva le schermate
del percorso principale).

| Lobby                                                     | Roulette dopo un giro                                     |
| --------------------------------------------------------- | --------------------------------------------------------- |
| ![Lobby con i quattro tavoli](docs/screenshots/lobby.png) | ![Roulette europea](docs/screenshots/roulette.png)        |
| **Blackjack**                                             | **Verifica provably fair nel browser**                    |
| ![Blackjack](docs/screenshots/blackjack.png)              | ![Verifica di una partita](docs/screenshots/verifica.png) |

## Architettura

Monorepo **pnpm** in TypeScript. La logica dei giochi è pura e condivisa: il server la usa per
decidere gli esiti, il browser per verificarli.

```mermaid
flowchart LR
  subgraph browser["Browser"]
    web["apps/web<br/>React 19 · Vite · React Router · TanStack Query"]
  end
  subgraph runtime["Node.js 22 (un solo processo, porta 3000)"]
    server["apps/server<br/>Fastify 5 · API /api · file statici del web"]
  end
  engine["packages/engine<br/>RNG HMAC-SHA256 · roulette · slot<br/>blackjack · video poker · verifyRound()"]
  shared["packages/shared<br/>contratto API (zod) · costanti"]
  db[("PostgreSQL 16<br/>users · sessions · wallets · ledger<br/>rounds · seed_pairs · loss_limits")]

  web -- "HTTPS JSON + cookie casino_sid<br/>header x-casino-csrf" --> server
  server -- "SQL (pg), transazioni<br/>con lock di riga" --> db
  server --> engine
  server --> shared
  web --> engine
  web --> shared
  shared --> engine
```

| Pacchetto         | Ruolo                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine` | Logica pura senza I/O: RNG provably fair, regole e pagamenti dei 4 giochi, `verifyRound()`.                                                                     |
| `packages/shared` | Contratto HTTP: schemi zod delle richieste, tipi delle risposte, codici di errore, limiti dei tavoli.                                                           |
| `apps/server`     | API Fastify 5: account, sessioni, portafoglio a registro, round, provably fair, gioco responsabile; migrazioni SQL; serve anche la build del web in produzione. |
| `apps/web`        | SPA React in italiano; in sviluppo Vite (5173) inoltra `/api` al server (3000).                                                                                 |
| `e2e`             | Test Playwright sul sistema completo (build di produzione + database dedicato).                                                                                 |

Specifica completa: [docs/SPEC.md](docs/SPEC.md).

## Avvio rapido (sviluppo)

Prerequisiti: **Node.js 22.12+**, **pnpm 10** (`corepack enable` usa la versione indicata in
`package.json`), **PostgreSQL 16**.

```sh
# 1. Database (utente postgres / password postgres, come in .env.example)
createdb -h localhost -U postgres casino_dev
createdb -h localhost -U postgres casino_test    # solo per i test del server
#    oppure con Docker:
#    docker run -d --name casino-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
#    (attendi qualche secondo che il server sia pronto, poi)
#    docker exec casino-pg createdb -U postgres casino_dev
#    docker exec casino-pg createdb -U postgres casino_test

# 2. Configurazione e dipendenze
cp .env.example .env
pnpm install

# 3. Schema del database
pnpm db:migrate

# 4. Server (3000, riavvio automatico) + web (5173, hot reload)
pnpm dev
```

Apri **http://localhost:5173**, registrati e gioca. Il saldo iniziale è di 1.000 fiches.

Per provare la build di produzione in locale (un solo processo sulla porta 3000):

```sh
pnpm build
SERVE_WEB_DIST=../web/dist APP_ORIGIN=http://localhost:3000 NODE_ENV=production COOKIE_SECURE=false pnpm start
```

`SERVE_WEB_DIST` è relativo a `apps/server`; le variabili della shell hanno la precedenza su `.env`.
Le migrazioni sono applicate anche all'avvio del server.

## Avvio con Docker Compose

Il modo più rapido per avere il sistema completo (PostgreSQL 16 + applicazione) senza installare
Node.js:

```sh
docker compose up --build
```

Apri **http://localhost:3000**. `docker compose down` ferma tutto (`down -v` cancella anche il
volume del database).

Il file [`docker-compose.yml`](docker-compose.yml) legge queste variabili dalla shell o da un file
`.env` accanto a esso (escluso da git). Hanno il prefisso `CASINO_` per non collidere con il `.env`
di sviluppo:

| Variabile              | Predefinito                                   | Significato                                                |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `POSTGRES_PASSWORD`    | `casino`                                      | **Segreto**: password del database. Cambiala fuori dal PC. |
| `CASINO_ORIGIN`        | `http://localhost:3000,http://127.0.0.1:3000` | Origini pubbliche del sito (controllo CSRF).               |
| `CASINO_COOKIE_SECURE` | `false`                                       | `true` quando il sito è servito in HTTPS.                  |
| `CASINO_TRUST_PROXY`   | `false`                                       | `1` dietro un reverse proxy.                               |
| `CASINO_LOG_LEVEL`     | `info`                                        | Livello dei log (pino, JSON).                              |

La porta del database non è esposta fuori dalla rete di Compose. L'unico segreto dell'applicazione
è la stringa di connessione al database: le sessioni usano token casuali salvati come hash, non
serve una chiave di firma.

Solo l'immagine:

```sh
docker build -t casinoonline .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://utente:password@host:5432/casino \
  -e APP_ORIGIN=http://localhost:3000 -e COOKIE_SECURE=false \
  casinoonline
```

L'immagine (multi-stage, `node:22-bookworm-slim`) contiene solo il bundle del server, le sue
dipendenze di produzione, le migrazioni e la build del web; gira come utente non privilegiato
`node`, espone la porta 3000 e ha un `HEALTHCHECK` su `/api/health` (sano solo se il database
risponde). Con un registry mirror: `--build-arg NODE_IMAGE=<mirror>/node:22-bookworm-slim`.

## Script

Dalla radice del repository:

| Comando              | Cosa fa                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev`           | Server (`tsx watch`, porta 3000) e web (Vite, porta 5173) in parallelo.           |
| `pnpm build`         | Build del web (`apps/web/dist`) e bundle esbuild del server (`apps/server/dist`). |
| `pnpm start`         | Avvia il server dalla build (`apps/server/dist/index.js`).                        |
| `pnpm db:migrate`    | Applica le migrazioni SQL a `DATABASE_URL`.                                       |
| `pnpm test`          | Test unitari e di integrazione di tutti i pacchetti (Vitest).                     |
| `pnpm test:e2e`      | Test end-to-end Playwright sulla build esistente (richiede `pnpm build`).         |
| `pnpm test:e2e:full` | `pnpm build` e poi i test end-to-end.                                             |
| `pnpm typecheck`     | `tsc` su tutti i pacchetti e sui test e2e.                                        |
| `pnpm lint`          | ESLint.                                                                           |
| `pnpm format`        | Prettier (scrittura); `pnpm format:check` solo controllo.                         |

Per un singolo pacchetto: `pnpm --filter @casino/engine test`, `pnpm --filter @casino/web build`,
`pnpm --filter @casino/web preview`, …

## Test

| Pacchetto        | Comando                             | Cosa copre                                                                                                                                                                             |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@casino/engine` | `pnpm --filter @casino/engine test` | RNG, enumerazioni esatte (roulette, slot 7492/8000, 2.598.960 mani di poker), regole del blackjack, simulazione RTP, `verifyRound`.                                                    |
| `@casino/shared` | `pnpm --filter @casino/shared test` | Contratto (nessun test al momento: passa comunque).                                                                                                                                    |
| `@casino/server` | `pnpm --filter @casino/server test` | API con PostgreSQL reale: auth, CSRF, idempotenza, concorrenza, limiti, pausa, seed e verifica, registro, cancellazione account.                                                       |
| `@casino/web`    | `pnpm --filter @casino/web test`    | Componenti chiave con Testing Library (jsdom).                                                                                                                                         |
| e2e              | `pnpm test:e2e:full`                | Registrazione e i quattro tavoli, storico e verifica provably fair, sessione/CSRF/CSP, ripresa di una mano, cancellazione account, limiti di perdita, pausa, reality check (Chromium). |

- I test del server usano `TEST_DATABASE_URL` (predefinito
  `postgres://postgres:postgres@localhost:5432/casino_test`): lo schema viene **cancellato e
  ricreato** a ogni esecuzione, quindi il nome del database deve contenere `test`.
- I test e2e avviano il server di produzione su una porta libera con un database **`casino_e2e`**
  (`E2E_DATABASE_URL`, il nome deve finire con `_e2e`), cancellato e ricreato a ogni esecuzione.
  La prima volta installa il browser: `pnpm exec playwright install chromium` (su Linux anche
  `--with-deps`).
- La CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) esegue formattazione, lint,
  typecheck, tutti i test, build ed e2e con PostgreSQL 16, e costruisce l'immagine Docker con un
  test di avvio. Il report di Playwright è allegato come artifact se l'e2e fallisce.

## Struttura del progetto

```text
.
├── apps/
│   ├── server/                 API Fastify
│   │   ├── migrations/         SQL numerate (NNN_nome.sql)
│   │   ├── src/
│   │   │   ├── auth/           password (scrypt), sessioni, hook CSRF/autenticazione
│   │   │   ├── db/             pool pg, transazioni, runner delle migrazioni
│   │   │   ├── games/          flusso delle puntate (lock, idempotenza, nonce, registro)
│   │   │   ├── routes/         auth, giochi, storico, portafoglio/fairness/RG/statistiche
│   │   │   ├── services/       portafoglio, fairness, gioco responsabile, statistiche
│   │   │   ├── app.ts          costruzione dell'app (plugin, CSP, rate limit, SPA)
│   │   │   ├── config.ts       variabili d'ambiente
│   │   │   └── index.ts        avvio: migrazioni, ascolto, arresto ordinato
│   │   ├── test/               test di integrazione (Vitest + PostgreSQL)
│   │   └── build.mjs           bundle esbuild -> dist/
│   └── web/                    SPA React
│       ├── public/
│       └── src/
│           ├── api/            client fetch, errori tipizzati, hook TanStack Query
│           ├── app/            router, layout, promemoria di gioco
│           ├── components/     carte, fiches, modali, selettore di puntata…
│           ├── games/          roulette, slot, blackjack, videopoker
│           ├── pages/          lobby, accesso, storico, verifica, profilo, gioco responsabile, regole
│           └── styles/
├── packages/
│   ├── engine/                 logica dei giochi e RNG (src/, test/)
│   └── shared/                 contratto API e costanti
├── e2e/                        test Playwright e avvio del server di prova
├── docs/                       specifica e documentazione
├── .github/workflows/ci.yml
├── Dockerfile · docker-compose.yml
└── playwright.config.ts · eslint.config.js · tsconfig.base.json
```

## Configurazione

Il server legge queste variabili d'ambiente (in sviluppo dal file `.env` della radice, vedi
[`.env.example`](.env.example)):

| Variabile           | Predefinito                              | Descrizione                                                                                                              |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | **obbligatoria**                         | Stringa di connessione PostgreSQL. **Segreto.**                                                                          |
| `PORT`              | `3000`                                   | Porta HTTP.                                                                                                              |
| `HOST`              | `0.0.0.0`                                | Interfaccia di ascolto.                                                                                                  |
| `APP_ORIGIN`        | `http://localhost:5173`                  | Origine/i pubbliche del sito, separate da virgola: l'`Origin` delle richieste di modifica deve essere tra queste (CSRF). |
| `NODE_ENV`          | `development`                            | `development`, `production` o `test`.                                                                                    |
| `COOKIE_SECURE`     | `true` in produzione, altrimenti `false` | Cookie `Secure`, HSTS e `upgrade-insecure-requests`. Deve essere `true` in HTTPS.                                        |
| `SERVE_WEB_DIST`    | nessuno                                  | Cartella della build del web da servire (SPA). Nell'immagine Docker: `/app/web`.                                         |
| `TRUST_PROXY`       | `false`                                  | `true`/`false`, numero di proxy davanti al server (es. `1`, consigliato) o elenco di IP/CIDR fidati.                     |
| `LOG_LEVEL`         | `info` (`silent` nei test)               | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                            |
| `RATE_LIMIT_GLOBAL` | `300`                                    | Richieste al minuto per IP su tutte le rotte.                                                                            |
| `RATE_LIMIT_AUTH`   | `10`                                     | Richieste al minuto per IP su registrazione, accesso, cambio password, cancellazione account.                            |
| `MIGRATIONS_DIR`    | cercata accanto al codice                | Cartella delle migrazioni SQL (nell'immagine: `/app/server/migrations`).                                                 |
| `TEST_DATABASE_URL` | `…/casino_test`                          | Solo test del server.                                                                                                    |
| `E2E_DATABASE_URL`  | `…/casino_e2e`                           | Solo test e2e.                                                                                                           |

## Deploy in produzione

L'architettura consigliata è **un solo container** (API + web sulla stessa origine, nessun CORS) più
un **PostgreSQL 16 gestito**. Le migrazioni vengono applicate all'avvio con un advisory lock, quindi
anche con più repliche.

Variabili da impostare sulla piattaforma:

```sh
DATABASE_URL=postgres://…          # segreto: dal provider del database (preferisci l'URL interno/privato)
APP_ORIGIN=https://casino.example.it   # l'indirizzo pubblico esatto, senza "/" finale
COOKIE_SECURE=true                 # predefinito con NODE_ENV=production (già nell'immagine)
TRUST_PROXY=1                      # un proxy/load balancer davanti all'app
```

- **`APP_ORIGIN`** deve coincidere con l'indirizzo con cui gli utenti aprono il sito (schema, host
  e porta), altrimenti ogni azione riceve `403 CSRF_REJECTED`. Più domini: separali con virgole.
- **`COOKIE_SECURE`** resta `true` (HTTPS). Metterlo a `false` solo in locale, su HTTP.
- **`TRUST_PROXY`**: le piattaforme terminano TLS su un proxy che aggiunge `X-Forwarded-For`.
  Senza fidarsi del proxy tutti gli utenti sembrano lo stesso IP (rate limit condiviso); con `true`
  un client potrebbe falsificare l'intestazione. Usa il **numero di proxy** (di solito `1`) e
  controlla nei log (`remoteAddress`) che compaia il tuo IP pubblico.
- **`PORT`**: se la piattaforma impone una porta tramite `PORT`, il server la usa.
- Health check: **`/api/health`** (`{"ok":true,"db":true}`).
- Il database deve essere raggiungibile solo dall'applicazione; se il provider richiede TLS usa la
  stringa di connessione (con i parametri `sslmode`) che fornisce per le connessioni esterne.
- Più repliche: l'app è senza stato (sessioni nel database), ma i contatori del rate limit sono in
  memoria **per istanza**.

### Render

1. **New → PostgreSQL** (versione 16) e copia l'**Internal Database URL**.
2. **New → Web Service** dal repository, runtime **Docker** (usa il `Dockerfile`).
3. Environment: `DATABASE_URL` (Internal URL), `APP_ORIGIN=https://<nome>.onrender.com` (o il
   dominio personalizzato), `TRUST_PROXY=1`.
4. **Health Check Path**: `/api/health`. Render imposta `PORT`, che il server rispetta.

### Fly.io

```sh
fly launch --no-deploy                     # rileva il Dockerfile; imposta internal_port = 3000
fly postgres create                        # oppure Fly Managed Postgres
fly postgres attach <nome-db>              # crea il segreto DATABASE_URL
fly secrets set APP_ORIGIN=https://<app>.fly.dev TRUST_PROXY=1
fly deploy
```

In `fly.toml` aggiungi un controllo HTTP su `/api/health` nella sezione `[[http_service.checks]]`.

### Railway

1. **New Project → Deploy from GitHub repo**: Railway usa il `Dockerfile`.
2. **Add → Database → PostgreSQL**.
3. Variables del servizio: `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
   `APP_ORIGIN=https://<servizio>.up.railway.app`, `TRUST_PROXY=1`.
4. Settings → **Healthcheck Path** `/api/health`; genera un dominio pubblico.

## Sicurezza

- **Password** con `crypto.scrypt` (N=16384, r=8, p=1, sale 16 byte), confronto a tempo costante;
  accesso con errore generico e tempo uguale anche per utenti inesistenti.
- **Sessioni**: token casuale di 32 byte nel cookie `casino_sid` (`HttpOnly`, `SameSite=Lax`,
  `Secure`); nel database solo lo SHA-256. Scadenza 7 giorni, inattività 12 ore; logout e cambio
  password revocano le sessioni.
- **CSRF**: intestazione `x-casino-csrf: 1` obbligatoria e controllo di `Origin` su ogni richiesta
  di modifica.
- **Intestazioni** con `@fastify/helmet`: CSP `default-src 'self'` senza script inline,
  `frame-ancestors 'none'`, HSTS in HTTPS.
- **Rate limit** per IP (300/min globale, 10/min per accesso e registrazione).
- **Validazione** di ogni corpo e query con gli schemi zod condivisi; limite di 64 KiB per corpo.
- **Errori** con un unico formato, senza stack trace; log JSON (pino) con password, cookie e token
  oscurati.
- **Denaro virtuale ma coerente**: transazioni con lock di riga, vincolo `balance >= 0`,
  idempotenza delle puntate, unicità di `(seed, nonce)`.
- **Container** non root, file dell'applicazione in sola lettura, solo dipendenze di produzione.
- **Esportazione CSV** protetta dalla formula injection.

Per segnalare una vulnerabilità apri una issue privata (security advisory) sul repository.

## Gioco responsabile

Limiti di perdita, pausa, promemoria di gioco, statistiche oneste e scelte di design (niente bonus,
streak, notifiche, autoplay, near-miss, classifiche) sono descritti con il comportamento esatto in
[docs/GIOCO_RESPONSABILE.md](docs/GIOCO_RESPONSABILE.md), insieme ai limiti delle protezioni solo
lato client. Telefono Verde Nazionale (ISS): **800 558 822**.

## Documentazione

| Documento                                                | Contenuto                                               |
| -------------------------------------------------------- | ------------------------------------------------------- |
| [docs/SPEC.md](docs/SPEC.md)                             | Specifica tecnica (fonte di verità).                    |
| [docs/API.md](docs/API.md)                               | Tutte le rotte HTTP con esempi `curl`.                  |
| [docs/GIOCHI.md](docs/GIOCHI.md)                         | Regole, pagamenti, RTP e vantaggio del banco.           |
| [docs/PROVABLY_FAIR.md](docs/PROVABLY_FAIR.md)           | Algoritmo del generatore e come verificare una partita. |
| [docs/verify-example.mjs](docs/verify-example.mjs)       | Verificatore indipendente (solo `node:crypto`).         |
| [docs/GIOCO_RESPONSABILE.md](docs/GIOCO_RESPONSABILE.md) | Protezioni e loro limiti.                               |

## Licenza

[MIT](LICENSE) © 2026 timmyfrancesco-gif
