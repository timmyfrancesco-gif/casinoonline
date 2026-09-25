# Specifica tecnica — Casinò a fiches virtuali

Questo documento è la fonte di verità per l'implementazione. I contratti di codice sono in
`packages/engine/src/**` (logica dei giochi e RNG) e `packages/shared/src/**` (API HTTP, costanti).

## 0. Principi non negoziabili

1. **Nessun denaro reale.** Le fiches sono virtuali, non si comprano, non si vincono premi, non si
   convertono, non si trasferiscono tra utenti. Nessun link o pubblicità di operatori di gioco
   (art. 9 DL 87/2018 "Decreto Dignità"). Questo vincolo è permanente.
2. **Server autoritativo.** Esiti, saldo e stato nascosto (sabot del blackjack, mazzo del video
   poker, carta coperta del banco) esistono solo sul server finché il round non è chiuso.
3. **Provably fair.** Ogni round è riproducibile da `serverSeed`, `clientSeed`, `nonce` (e dalle
   scelte del giocatore) con `verifyRound()` di `@casino/engine`, anche nel browser.
4. **Integrità del saldo.** Registro (ledger) append-only; saldo = somma del registro; mai negativo;
   ogni movimento in una transazione con lock di riga.
5. **Gioco responsabile per design.** Niente bonus giornalieri, streak, notifiche "torna a giocare",
   autoplay, turbo, near-miss pilotati, festeggiamenti per vincite inferiori alla puntata,
   classifiche. Limiti di perdita, autoesclusione, reality check, statistiche oneste.
6. **Privacy minima (GDPR).** Solo username + hash della password. La data di nascita serve solo
   a verificare i 18 anni e NON viene salvata (si salva `age_confirmed_at`). Cancellazione account
   completa e immediata.

## 1. Architettura

```
packages/engine   logica pura (nessun I/O): RNG HMAC, roulette, slot, blackjack, video poker, verify
packages/shared   contratto API (zod + tipi), costanti (limiti tavolo, RG, cookie, CSRF)
apps/server       Fastify 5 + PostgreSQL (driver `pg`, SQL esplicito), serve anche la build del web
apps/web          React 19 + Vite 8 + React Router 7 + TanStack Query 5, UI in italiano
e2e               Playwright (Chromium) sul sistema completo
```

- Importazioni relative con estensione `.ts` (es. `import { x } from './x.ts'`).
- Importi sempre interi in **unità** (100 unità = 1 fiche). Puntate solo in fiches intere.
- ID del database serializzati come stringhe nell'API.

## 2. Database (PostgreSQL 16)

Migrazioni SQL numerate in `apps/server/migrations/NNN_nome.sql` (`001_init`,
`002_next_server_seed`), applicate in ordine da un runner minimale (`src/db/migrate.ts`) che registra
le versioni in `schema_migrations` e usa un advisory lock. Il bundle le copia in `dist/migrations`,
dove il server le trova da solo (`MIGRATIONS_DIR` le sostituisce).
I `bigint` vengono letti come `number` (tutti i valori restano entro `Number.MAX_SAFE_INTEGER`).

```sql
users(
  id bigserial PK,
  username text NOT NULL,                         -- unique index su lower(username)
  password_hash text NOT NULL,                    -- formato "scrypt$N$r$p$saltB64$hashB64"
  age_confirmed_at timestamptz NOT NULL,
  reality_check_minutes int NOT NULL DEFAULT 30 CHECK (reality_check_minutes IN (15,30,60)),
  self_excluded_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)
sessions(
  id bigserial PK,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,               -- sha256 del token del cookie (il token non si salva)
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
)
wallets(
  user_id bigint PK REFERENCES users ON DELETE CASCADE,
  balance bigint NOT NULL CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
)
seed_pairs(
  id bigserial PK,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  server_seed text NOT NULL,                      -- 64 hex (32 byte da crypto.randomBytes)
  server_seed_hash text NOT NULL,                 -- sha256(server_seed) hex
  client_seed text NOT NULL,
  next_nonce int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revealed_at timestamptz NULL
)                                                 -- unique index (user_id) WHERE active
next_server_seeds(                                -- 002: il server seed della PROSSIMA coppia (§4)
  user_id bigint PK REFERENCES users ON DELETE CASCADE,
  server_seed text NOT NULL,                      -- 64 hex, segreto fino alla rivelazione della coppia
  server_seed_hash text NOT NULL,                 -- sha256(server_seed) hex, mostrato in anticipo
  created_at timestamptz NOT NULL DEFAULT now()
)                                                 -- esattamente una riga per utente
rounds(
  id bigserial PK,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('roulette','slot','blackjack','videopoker')),
  status text NOT NULL CHECK (status IN ('open','settled')),
  seed_pair_id bigint NOT NULL REFERENCES seed_pairs ON DELETE CASCADE,
  nonce int NOT NULL,
  stake bigint NOT NULL CHECK (stake >= 0),
  payout bigint NOT NULL DEFAULT 0 CHECK (payout >= 0),
  input jsonb NOT NULL,                           -- input del giocatore (puntate, bet, azioni, held)
  state jsonb NOT NULL,                           -- stato completo del motore o settlement
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,                     -- sha256 del body canonico, per rilevare riusi della chiave
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz NULL,
  UNIQUE (user_id, idempotency_key),
  UNIQUE (seed_pair_id, nonce)
)                                                 -- unique index (user_id, game) WHERE status='open'
                                                  -- index (user_id, id DESC)
ledger(
  id bigserial PK,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  round_id bigint NULL REFERENCES rounds ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('initial','stake','payout','reset')),
  amount bigint NOT NULL,                         -- negativo per 'stake', positivo per 'payout'/'initial'/'reset'
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
)                                                 -- index (user_id, created_at)
loss_limits(
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('24h','7d','30d')),
  value bigint NULL,
  pending_set boolean NOT NULL DEFAULT false,
  pending_value bigint NULL,
  pending_effective_at timestamptz NULL,
  PRIMARY KEY (user_id, period)
)
```

Invariante verificata dai test: per ogni utente `wallets.balance = SUM(ledger.amount)` e
`rounds.stake = -SUM(ledger.amount WHERE kind='stake' AND round_id=r)`,
`rounds.payout = SUM(ledger.amount WHERE kind='payout' AND round_id=r)`.

## 3. Flusso di una puntata (transazione unica, `READ COMMITTED` + lock espliciti)

0. Il corpo è validato con lo schema zod (400 `VALIDATION_ERROR`, anche per importi non multipli
   di 100). Nel processo le transazioni di denaro di uno stesso utente sono messe in coda prima di
   prendere una connessione del pool (`withUserTransaction`); la transazione apre con
   `BEGIN ISOLATION LEVEL READ COMMITTED` esplicito.
1. `SELECT ... FROM users WHERE id=$1 FOR UPDATE` — serializza tutte le operazioni di denaro
   dell'utente (anche richieste parallele da più schede e da più istanze del server).
2. Idempotenza: se esiste un round con `(user_id, idempotency_key)`: stesso `request_hash` →
   restituire la stessa risposta (ricostruita dal round); hash diverso → 409 `CONFLICT`.
3. Controlli: autoesclusione (403 `RG_SELF_EXCLUDED`), limiti tavolo (400 `BET_LIMIT`; le fiches
   non intere sono già respinte dallo schema con 400 `VALIDATION_ERROR`), round aperto dello stesso
   gioco (409 `ROUND_ALREADY_OPEN`), saldo (400 `INSUFFICIENT_FUNDS`), limiti di perdita
   (403 `RG_LOSS_LIMIT`, vedi §5).
4. Seed: `SELECT ... FROM seed_pairs WHERE user_id=$1 AND active FOR UPDATE`;
   `nonce = next_nonce`; `next_nonce = next_nonce + 1`.
5. Esito: `createRoundRng({serverSeed, clientSeed, nonce})` + funzione del motore.
6. Scritture: `rounds` (open o settled), `ledger` 'stake' (−stake), eventuale 'payout' (+payout,
   solo se > 0), `wallets.balance` aggiornato; `balance_after` coerente riga per riga.
7. Risposta: vedi i tipi `*Response` in `packages/shared/src/api.ts`.

Giochi a più passi (blackjack, video poker):

- `deal` crea il round `open` con lo stato completo del motore in `rounds.state` (se il motore
  chiude subito, es. blackjack naturale, il round nasce `settled`).
- `action`/`draw`: lock utente, poi `SELECT ... FROM rounds WHERE id=$1 AND user_id=$2 FOR UPDATE`;
  round assente o non aperto → 409 `ROUND_NOT_OPEN`; `step` diverso da `state.step` → 409
  `CONFLICT` con `details.round` = risposta corrente (il client si risincronizza).
  `double`/`split` richiedono `blackjackActionCost()` fiches in più: controllo saldo + limiti di
  perdita + `maxPerRound`, poi ledger 'stake' aggiuntivo e `rounds.stake` incrementato.
  Azione illegale → 400 `ILLEGAL_ACTION`.
- Alla chiusura: `status='settled'`, `settled_at=now()`, `payout`, ledger 'payout' se > 0.
- `GET /games/<gioco>/open` permette di riprendere una mano dopo un ricaricamento.
- Le risposte usano SEMPRE le viste pubbliche (`blackjackPublicView`, `videoPokerPublicView`):
  mai il sabot/mazzo o la carta coperta.

## 4. Provably fair

- Alla registrazione si crea la prima coppia di seed attiva (`server_seed` = 32 byte casuali da
  `crypto.randomBytes` in hex, `client_seed` = 16 byte casuali in hex) e il **prossimo server seed**
  (`next_server_seeds`, 32 byte casuali). La migrazione 002 lo genera anche per gli utenti già
  esistenti.
- `GET /fairness`: coppia attiva (solo hash del server seed), `next.serverSeedHash` (hash del
  prossimo server seed) + ultime 20 coppie rivelate.
- `POST /fairness/rotate` `{ clientSeed?, nextServerSeedHash? }`: vietato se esiste un round `open`
  (409 `SEED_ROTATION_BLOCKED`). Se `nextServerSeedHash` è indicato e non è l'hash del prossimo
  seed in attesa (rotazione avvenuta altrove) → 409 `CONFLICT`, nulla cambia. Altrimenti rivela la
  coppia attiva (`active=false`, `revealed_at=now()`), crea la nuova coppia con il client seed
  indicato (o casuale) e come server seed **il prossimo seed già impegnato**, poi sostituisce il
  prossimo seed con uno nuovo. Transazione con lock utente e `FOR UPDATE` su `next_server_seeds`.
- Quindi il server è vincolato al server seed di una coppia prima che il giocatore ne scelga il
  client seed: non può provare molti server seed e tenere il più favorevole. Il web genera sempre
  il client seed nel browser (casuale se il campo è vuoto) e invia `nextServerSeedHash`.
- Il web conserva in `localStorage` l'hash di ogni coppia visto prima della rivelazione (e, alla
  rotazione, l'hash `next` mostrato prima); la pagina "Verifica" confronta il seed rivelato con
  questa copia, non con l'hash inviato dal server insieme al seed.
- Ogni round espone `fairness` (`FairnessRef`); `serverSeed` è valorizzato solo se la coppia è
  rivelata. `GET /history/:id` restituisce `verifyInput`, che con il seed rivelato riproduce il round
  tramite `verifyRound()`; la pagina web "Verifica" lo fa nel browser.

## 5. Gioco responsabile

- **Limiti di perdita** per finestre mobili `24h`, `7d`, `30d`.
  `used(period) = max(0, -(SUM(ledger.amount) WHERE kind IN ('stake','payout') AND created_at > now() - period))`.
  Una nuova puntata (o un raddoppio/split) di importo `s` è rifiutata se `used + s > value`
  (conservativo: la puntata è considerata persa). `details: { period, remaining }`, con
  `remaining` arrotondato per difetto alle fiches intere (la puntata massima ancora ammessa).
  Abbassare/impostare un limite dove non c'era → immediato. Alzare o rimuovere → diventa
  `pending` ed entra in vigore dopo 24 h (`LIMIT_INCREASE_DELAY_MS`); i pending scaduti si
  applicano in modo lazy a ogni lettura/controllo. Un nuovo abbassamento cancella il pending.
  I **reset del saldo non azzerano** `used` (il reset è kind 'reset', escluso dal calcolo).
- **Autoesclusione** (pausa) 24h / 7d / 30d: `self_excluded_until = max(attuale, now()+durata)`,
  non si può accorciare né revocare. Durante la pausa login e consultazione sono permessi, le
  puntate no (403 `RG_SELF_EXCLUDED`, `details.until`). Nuovi round bloccati; un round a più passi
  già aperto si può comunque completare (stand/draw), ma non si possono aggiungere fiches.
- **Reality check**: ogni `reality_check_minutes` (15/30/60) il client mostra un avviso modale
  bloccante con tempo di sessione, round giocati e risultato netto (`GET /rg` → `session`), un
  collegamento agli strumenti di gioco responsabile e il numero verde; il giocatore sceglie
  "Continua" o "Esci" (stesso peso, nessuno dei due con il focus iniziale). La sessione parte al
  login.
- **Reset del saldo** (`POST /wallet/reset`): solo se `balance < STARTING_BALANCE` e nessun round
  aperto; porta il saldo a `STARTING_BALANCE` con un movimento 'reset'. Non tocca statistiche e limiti.
- **Statistiche oneste** (`GET /stats`): totali puntati/restituiti/netto per sempre, per gioco e per
  sessione; numero di reset.
- UI: banner permanente "fiches virtuali", pagina "Gioco responsabile" con il Telefono Verde
  Nazionale 800 558 822 (ISS), RTP/house edge visibili su ogni tavolo, puntata di default = minimo.

## 6. Autenticazione e sicurezza

- Password: `crypto.scrypt` (N=16384, r=8, p=1, keylen 64, salt 16 byte), confronto con
  `timingSafeEqual`. Login con messaggio generico `INVALID_CREDENTIALS`; verifica scrypt eseguita
  anche per username inesistenti (tempo costante).
- Sessione: token casuale 32 byte (base64url) nel cookie `casino_sid` (`HttpOnly`, `SameSite=Lax`,
  `Path=/`, `Secure` in produzione, dove il nome diventa `__Host-casino_sid`). Nel DB solo
  `sha256(token)`. Scadenza assoluta 7 giorni,
  inattività 12 ore (`last_seen_at` aggiornato al massimo una volta al minuto). Logout e cambio
  password revocano le sessioni (il cambio password mantiene solo quella corrente, con un nuovo
  token e nuovo cookie).
- CSRF: ogni richiesta non-GET/HEAD deve avere `x-casino-csrf: 1`; se c'è l'header `Origin` deve
  corrispondere a `APP_ORIGIN` → altrimenti 403 `CSRF_REJECTED`.
- Rate limit (`@fastify/rate-limit`) per IP: globale 300 req/min (`RATE_LIMIT_GLOBAL`); 10/min
  (`RATE_LIMIT_AUTH`) su registrazione, login, cambio password, cancellazione account; 5/min su
  `GET /history/export.csv` (più un solo export in corso per utente) e 30/min su `GET /stats`.
- `@fastify/helmet` con CSP restrittiva (`default-src 'self'`; niente inline script);
  `Cache-Control: no-store` su tutte le risposte `/api`.
- Tempi massimi: 30 s per ricevere una richiesta (`requestTimeout`), 15 s per istruzione SQL
  (`statement_timeout`, tolto durante le migrazioni), 10 s di attesa per una connessione del pool.
- Tutti i body/query validati con gli schemi zod di `@casino/shared` → 400 `VALIDATION_ERROR`.
- Errori: handler unico, niente stack trace al client, log strutturato (pino) senza password/token.
- Configurazione da env: `DATABASE_URL`, `PORT` (default 3000), `HOST` (default 0.0.0.0),
  `APP_ORIGIN` (default http://localhost:5173, più origini separate da virgola), `NODE_ENV`,
  `COOKIE_SECURE` (default true in production), `SERVE_WEB_DIST` (percorso della build web da
  servire, opzionale), `TRUST_PROXY` (default false; dietro un proxy il numero di proxy, es. `1`, o
  un elenco di IP/CIDR: `true` si fiderebbe di un `X-Forwarded-For` scelto dal client),
  `LOG_LEVEL` (default info, silent nei test), `RATE_LIMIT_GLOBAL`, `RATE_LIMIT_AUTH`,
  `MIGRATIONS_DIR` (default: cercata accanto al codice).

## 7. Web (apps/web)

- Pagine: Home/Lobby (4 tavoli, RTP di ciascuno), Accedi, Registrati (username, password, data di
  nascita, accettazione termini + disclaimer), Roulette, Slot, Blackjack, Video Poker, Storico
  (paginato, filtro per gioco, export CSV, dettaglio round), Verifica (provably fair nel browser),
  Profilo (statistiche, seed/rotazione, cambio password, cancellazione account), Gioco responsabile
  (limiti, pausa, reality check, info e numero verde), Regole e probabilità.
- Header con saldo sempre visibile, banner fiches virtuali, logout. Reality check modale.
- Grafica: SVG/CSS (carte, fiches, tappeto roulette cliccabile, ruota animata, rulli). Le
  animazioni terminano SEMPRE sull'esito ricevuto dal server, < 2 s, disattivate con
  `prefers-reduced-motion`. Nessun autoplay.
- Accessibilità: navigazione da tastiera, `aria-live` per gli esiti, contrasto AA, rosso/nero
  distinguibili anche senza colore (etichette).
- Tema scuro "tavolo verde" di default e tema chiaro, responsive fino a 360 px.
- Chiamate API: `fetch` con `credentials: 'include'`, header CSRF, errori tipizzati `ApiErrorBody`.
  Chiave di idempotenza `crypto.randomUUID()` generata per ogni intenzione di puntata (riusata nei
  retry dello stesso click).
- In sviluppo Vite (5173) fa da proxy di `/api` verso il server (3000).

## 8. Test

- Engine: Vitest + fast-check. Enumerazioni esatte (EV roulette −1/37 per ogni tipo di puntata,
  slot 7492/8000, frequenze delle mani di poker su 2.598.960 combinazioni), regole del blackjack
  con sabot preparati, proprietà (conservazione delle carte, stato non mutato, payout coerenti).
- Server: Vitest con PostgreSQL reale (`TEST_DATABASE_URL`, default
  `postgres://postgres:postgres@localhost:5432/casino_test`) e `app.inject()`. Copertura: auth,
  CSRF, idempotenza, concorrenza (richieste parallele non portano il saldo sotto zero), limiti di
  perdita e pending, autoesclusione, rotazione seed (prossimo seed impegnato, hash obsoleto → 409)
  - verifica dei round con `verifyRound`, migrazioni, invarianti del registro, cancellazione
    account. `TEST_DATABASE_URL` si legge solo dalla shell, non da `.env`.
- Web: Vitest + Testing Library (componenti chiave) — e2e Playwright: registrazione → roulette →
  saldo aggiornato → storico → verifica dopo rotazione.
