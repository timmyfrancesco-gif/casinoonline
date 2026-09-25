# API HTTP

Contratto completo (schemi zod e tipi TypeScript) in
[`packages/shared/src/api.ts`](../packages/shared/src/api.ts); costanti (limiti, cookie, CSRF) in
[`packages/shared/src/constants.ts`](../packages/shared/src/constants.ts). Implementazione in
`apps/server/src/routes/`.

## Convenzioni

- Tutti i percorsi hanno il prefisso **`/api`**. Corpo delle richieste e delle risposte in JSON
  (`content-type: application/json`), massimo 64 KiB.
- **Importi interi in unità**: 100 unità = 1 fiche. Puntate e limiti di perdita devono essere
  fiches intere: un importo non multiplo di 100 è respinto dallo schema con `400 VALIDATION_ERROR`
  (`details[].path` = `amount`, `bets.N.amount` o `value`). Saldo iniziale: 100000 (1.000 fiches).
- **ID** del database serializzati come **stringhe** (`"42"`); date in ISO 8601 UTC.
- Le carte sono interi 0-51 (valore = `codice % 13`, 0 = A … 12 = K; seme = `floor(codice / 13)`,
  0 ♠ 1 ♥ 2 ♦ 3 ♣).
- Le risposte non contengono mai il sabot del blackjack, il mazzo del video poker, la carta coperta
  del banco o un server seed non ancora rivelato.
- Le risposte di `/api` hanno `Cache-Control: no-store` (dati personali: né browser né proxy le
  conservano).

### Sessione (cookie)

Registrazione e accesso impostano il cookie **`casino_sid`**: `HttpOnly`, `SameSite=Lax`, `Path=/`,
`Max-Age` 7 giorni. Con `COOKIE_SECURE=true` (predefinito in produzione) il cookie è `Secure` e si
chiama **`__Host-casino_sid`**: il prefisso impone `Secure`, `Path=/` e nessun `Domain`, così un
sottodominio o una pagina HTTP non possono impostarlo o sovrascriverlo. Il server
salva solo lo SHA-256 del token. La sessione scade dopo **7 giorni** in assoluto o dopo **12 ore**
di inattività. Senza sessione valida le rotte protette rispondono `401 UNAUTHENTICATED`.

### CSRF

Ogni richiesta **diversa da GET/HEAD** deve avere l'intestazione **`x-casino-csrf: 1`**. Se il browser
invia l'intestazione `Origin`, deve essere una delle origini di `APP_ORIGIN` (separate da virgola).
Altrimenti: `403 CSRF_REJECTED`. Insieme ai cookie `SameSite=Lax`, questo impedisce a un sito
esterno di agire a nome dell'utente.

### Idempotenza

Le richieste che **aprono una partita** (`spin`, `deal`) hanno un campo `idempotencyKey` (UUID, uno
per ogni intenzione di puntata, riusato nei tentativi ripetuti dello stesso clic):

- stessa chiave e stesso corpo → la partita **non** viene giocata di nuovo: si riceve la risposta
  ricostruita dalla partita già registrata;
- stessa chiave con corpo diverso (o su un'altra rotta) → `409 CONFLICT`.

Le azioni successive di blackjack e video poker usano invece `step` (concorrenza ottimistica): deve
essere uguale a `state.step` visto dal client, altrimenti `409 CONFLICT` con lo stato attuale in
`details.round`.

### Errori

Ogni errore ha il corpo

```json
{ "error": { "code": "BET_LIMIT", "message": "Messaggio in italiano.", "details": {} } }
```

| Stato | Codice                  | Quando                                                                                               | `details`                                    |
| ----- | ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 400   | `VALIDATION_ERROR`      | corpo/query non validi, importi non in fiches intere (413 se troppo grande, 415 se non JSON)         | `[{ path, message, code }]`                  |
| 401   | `UNAUTHENTICATED`       | sessione assente, scaduta o revocata                                                                 |                                              |
| 401   | `INVALID_CREDENTIALS`   | nome utente o password errati (anche password attuale errata)                                        |                                              |
| 403   | `CSRF_REJECTED`         | manca `x-casino-csrf: 1` oppure `Origin` non consentita                                              |                                              |
| 404   | `NOT_FOUND`             | rotta o risorsa inesistente                                                                          |                                              |
| 409   | `CONFLICT`              | `step` superato, chiave di idempotenza riusata, richiesta concorrente, prossimo seed server cambiato | `{ round }` per `step` superato              |
| 429   | `RATE_LIMITED`          | troppe richieste, oppure un export CSV già in corso                                                  | `{ retryAfterSeconds }` (solo per frequenza) |
| 409   | `USERNAME_TAKEN`        | nome utente già usato (senza distinzione maiuscole/minuscole)                                        |                                              |
| 400   | `UNDERAGE`              | meno di 18 anni (data di nascita, ora italiana)                                                      |                                              |
| 400   | `INSUFFICIENT_FUNDS`    | saldo inferiore alla puntata                                                                         | `{ balance, required }`                      |
| 400   | `BET_LIMIT`             | fuori dai limiti del tavolo, disposizione non valida                                                 | es. `{ min, max }`, `{ index }`              |
| 403   | `RG_SELF_EXCLUDED`      | pausa attiva                                                                                         | `{ until }`                                  |
| 403   | `RG_LOSS_LIMIT`         | la puntata supererebbe un limite di perdita                                                          | `{ period, remaining }` (fiches intere)      |
| 409   | `ROUND_ALREADY_OPEN`    | c'è già una mano aperta a quel tavolo                                                                | `{ roundId }`                                |
| 409   | `ROUND_NOT_OPEN`        | la mano non esiste o è conclusa                                                                      | `{ round }` se conclusa                      |
| 400   | `ILLEGAL_ACTION`        | azione non consentita nello stato attuale                                                            | `{ allowedActions }` (blackjack)             |
| 409   | `SEED_ROTATION_BLOCKED` | rotazione dei seed con una mano in corso                                                             | `{ roundId }`                                |
| 409   | `RESET_NOT_ALLOWED`     | reset con saldo ≥ iniziale o con una mano in corso                                                   |                                              |
| 500   | `INTERNAL`              | errore imprevisto (nessun dettaglio interno viene esposto)                                           |                                              |

### Limiti di frequenza

Per indirizzo IP (dietro un proxy serve `TRUST_PROXY` con il numero di proxy, vedi README):
**300 richieste al minuto** in totale e **10 al minuto** su ciascuna delle rotte
`POST /auth/register`, `POST /auth/login`, `POST /account/password`, `DELETE /account`
(`RATE_LIMIT_GLOBAL` e `RATE_LIMIT_AUTH` cambiano questi due valori). Limiti fissi:
**5 al minuto** per `GET /history/export.csv` (e un solo export alla volta per utente) e **30 al
minuto** per `GET /stats`. Le risposte includono `x-ratelimit-limit`, `x-ratelimit-remaining`,
`x-ratelimit-reset`; il `429` anche `retry-after`.

### Esempi con curl

Gli esempi usano un cookie jar e l'intestazione CSRF:

```sh
B=http://localhost:3000                     # docker compose / produzione (sviluppo: 5173 o 3000)
J=/tmp/casino-cookies.txt
H=(-b "$J" -c "$J" -H 'content-type: application/json' -H 'x-casino-csrf: 1')
uuid() { node -p 'crypto.randomUUID()'; }   # chiave di idempotenza
```

`curl` non invia `Origin`, quindi basta l'intestazione `x-casino-csrf`.

## Sistema

### `GET /api/health`

Nessuna autenticazione. Sempre `200 { "ok": true, "db": <boolean> }`: `db` è `false` se PostgreSQL
non risponde. Usata dall'`HEALTHCHECK` dell'immagine Docker.

```sh
curl -s $B/api/health
# {"ok":true,"db":true}
```

## Account

### `POST /api/auth/register`

Corpo: `{ username, password, birthDate, acceptTerms: true }`.

- `username`: 3-20 caratteri tra lettere, numeri e `_`, unico senza distinzione maiuscole/minuscole.
- `password`: 10-128 caratteri.
- `birthDate`: `YYYY-MM-DD`, serve solo a verificare i 18 anni e **non viene salvata**.

Risposta `201` `MeResponse` e cookie di sessione. Crea portafoglio (1.000 fiches), prima coppia di
seed e prossimo server seed (vedi [Provably fair](#provably-fair)). Errori: `400 VALIDATION_ERROR`,
`400 UNDERAGE`, `409 USERNAME_TAKEN`, `429`.

```sh
curl -s "${H[@]}" -X POST $B/api/auth/register \
  -d '{"username":"mario_rossi","password":"una-password-lunga","birthDate":"1990-05-17","acceptTerms":true}'
# {"user":{"id":"1","username":"mario_rossi","createdAt":"2026-09-25T15:53:40.355Z"},
#  "balance":100000,"sessionStartedAt":"2026-09-25T15:53:40.355Z"}
```

### `POST /api/auth/login`

Corpo: `{ username, password }` → `200 MeResponse` e nuovo cookie (una sessione precedente dello
stesso browser viene chiusa). Errore generico `401 INVALID_CREDENTIALS`, con tempo di risposta
uguale anche per utenti inesistenti; `429` dopo 10 tentativi al minuto.

```sh
curl -s "${H[@]}" -X POST $B/api/auth/login -d '{"username":"mario_rossi","password":"una-password-lunga"}'
```

### `POST /api/auth/logout`

Nessun corpo, anche senza sessione. `204`; elimina la sessione e cancella il cookie.

```sh
curl -s "${H[@]}" -X POST $B/api/auth/logout -o /dev/null -w '%{http_code}\n'   # 204
```

### `GET /api/auth/me`

`200 MeResponse` `{ user: { id, username, createdAt }, balance, sessionStartedAt }` oppure
`401 UNAUTHENTICATED`. `sessionStartedAt` è l'inizio della sessione (promemoria di gioco).

### `POST /api/account/password`

Corpo: `{ currentPassword, newPassword }` (nuova: 10-128 caratteri). `204`; **tutte le altre
sessioni** dell'utente vengono revocate, quella corrente resta attiva con un **nuovo token** (nuovo
cookie `casino_sid` nella risposta: una copia del vecchio cookie non vale più). Errori:
`401 INVALID_CREDENTIALS` (password attuale errata), `400 VALIDATION_ERROR`, `429`.

```sh
curl -s "${H[@]}" -X POST $B/api/account/password \
  -d '{"currentPassword":"una-password-lunga","newPassword":"una-password-nuova"}' -w '%{http_code}\n'
```

### `DELETE /api/account`

Corpo: `{ password }`. `204`: cancella **subito e completamente** utente, sessioni, portafoglio,
registro, partite, seed (anche il prossimo server seed) e limiti; cancella il cookie. Errori:
`401 INVALID_CREDENTIALS`, `429`.

```sh
curl -s "${H[@]}" -X DELETE $B/api/account -d '{"password":"una-password-nuova"}' -w '%{http_code}\n'
```

## Portafoglio

### `GET /api/wallet`

`200 { "balance": 98700 }`.

### `POST /api/wallet/reset`

Nessun corpo. Solo con saldo sotto 100000 e senza mani aperte: riporta il saldo a 100000 con un
movimento `reset` (statistiche e limiti di perdita non cambiano). `200 { balance }`, altrimenti
`409 RESET_NOT_ALLOWED`.

## Provably fair

Algoritmo e verifica: [PROVABLY_FAIR.md](PROVABLY_FAIR.md).

### `GET /api/fairness`

```json
{
  "active": {
    "id": "2",
    "serverSeedHash": "0b7443686e50015773c6588bd6c8d58b83c99714bf4f228e411f0b0f3fb23670",
    "clientSeed": "il-mio-seed-2026",
    "nextNonce": 0,
    "createdAt": "2026-09-25T15:54:00.512Z"
  },
  "next": {
    "serverSeedHash": "d3dc93fb71a433a1171442c3c71e953de7a47bdf9aed34a6a9e5dd301dd10f87"
  },
  "revealed": [
    {
      "id": "1",
      "serverSeed": "943a38144652c5106d1976a866ea8cd99a95f071df518d524c52dfc31b873f63",
      "serverSeedHash": "d7ebb4bca8a3f81e7fd921ae0dcc982db300b4f1a3f58f00b86c8b226e5dea51",
      "clientSeed": "23adba2431aa627815b2ca9ab1083dc3",
      "roundsPlayed": 4,
      "createdAt": "2026-09-25T15:53:40.355Z",
      "revealedAt": "2026-09-25T15:54:00.512Z"
    }
  ]
}
```

- `active`: coppia in uso (del server seed solo l'impronta).
- `next.serverSeedHash`: impronta del **prossimo** server seed, generato in anticipo (alla
  registrazione e a ogni rotazione). Alla prossima rotazione diventa il server seed della nuova
  coppia, quindi il server vi è vincolato prima che il giocatore scelga il nuovo client seed.
- `revealed`: ultime 20 coppie rivelate, dalla più recente.

### `POST /api/fairness/rotate`

Corpo: `{ clientSeed?, nextServerSeedHash? }`.

- `clientSeed`: 1-64 caratteri ASCII stampabili, senza spazi né `:`; se assente lo sceglie il server
  (il sito ne genera sempre uno nel browser).
- `nextServerSeedHash`: il `next.serverSeedHash` visto prima di scegliere il client seed. Se nel
  frattempo i seed sono stati ruotati (es. da un'altra scheda) non è più quello in attesa e la
  richiesta fallisce con `409 CONFLICT`, senza ruotare nulla.

Rivela la coppia attiva e ne crea una nuova con nonce 0, il client seed indicato e come server seed
quello impegnato in `next` (`active.serverSeedHash` della risposta è uguale all'hash visto prima);
poi genera un nuovo prossimo server seed. Risposta `200 FairnessResponse`. Con una mano aperta:
`409 SEED_ROTATION_BLOCKED` (`details.roundId`).

```sh
NEXT=$(curl -s -b "$J" $B/api/fairness | node -pe 'JSON.parse(require("fs").readFileSync(0)).next.serverSeedHash')
curl -s "${H[@]}" -X POST $B/api/fairness/rotate \
  -d "{\"clientSeed\":\"il-mio-seed-2026\",\"nextServerSeedHash\":\"$NEXT\"}"
```

## Giochi

Ogni partita restituisce `round` (`RoundSummary`):

```json
{
  "id": "1",
  "game": "roulette",
  "status": "settled",
  "stake": 600,
  "payout": 1000,
  "createdAt": "2026-09-25T15:53:40.478Z",
  "settledAt": "2026-09-25T15:53:40.478Z",
  "fairness": {
    "seedPairId": "1",
    "serverSeedHash": "d7ebb4bc…",
    "clientSeed": "23adba24…",
    "nonce": 0,
    "serverSeed": null
  }
}
```

`stake` = totale puntato (raddoppi e divisioni inclusi), `payout` = totale restituito (puntata
inclusa, 0 finché la mano è aperta), `balance` = saldo dopo l'operazione.

Controlli comuni all'apertura di una partita, in quest'ordine: schema del corpo
(`VALIDATION_ERROR`, anche per importi non in fiches intere), idempotenza, `RG_SELF_EXCLUDED`,
`BET_LIMIT`, `ROUND_ALREADY_OPEN`, `INSUFFICIENT_FUNDS`, `RG_LOSS_LIMIT`. Limiti dei tavoli in
[GIOCHI.md](GIOCHI.md#limiti-dei-tavoli).

### `POST /api/games/roulette/spin`

Corpo: `{ bets: RouletteBet[1..40], idempotencyKey }`, con ogni puntata in una di queste forme:

```text
{ "type": "straight | split | street | trio | corner | basket | sixline", "numbers": [17], "amount": 100 }
{ "type": "dozen | column", "index": 1, "amount": 100 }
{ "type": "red | black | even | odd | low | high", "amount": 100 }
```

Risposta `200 { round, settlement, balance }` con
`settlement = { number, color, bets: [{ bet, win }], totalBet, totalWin }`. Una disposizione non
valida (es. cavallo tra numeri non adiacenti) è `400 BET_LIMIT` con `details.index`; un importo non
multiplo di 100 è `400 VALIDATION_ERROR` con `details[].path` = `bets.N.amount`.

```sh
curl -s "${H[@]}" -X POST $B/api/games/roulette/spin \
  -d "{\"bets\":[{\"type\":\"red\",\"amount\":500},{\"type\":\"straight\",\"numbers\":[17],\"amount\":100}],\"idempotencyKey\":\"$(uuid)\"}"
# {"round":{…,"stake":600,"payout":1000,…},"settlement":{"number":30,"color":"red",
#  "bets":[{"bet":{"type":"red","amount":500},"win":1000},{"bet":{…},"win":0}],
#  "totalBet":600,"totalWin":1000},"balance":100400}
```

### `POST /api/games/slot/spin`

Corpo: `{ amount, idempotencyKey }`. Risposta `200 { round, settlement, balance }` con
`settlement = { stops, window, line, kind, multiplier, bet, win }` (`window[riga][rullo]`, riga 1 =
linea di pagamento; `kind` null se non vince).

```sh
curl -s "${H[@]}" -X POST $B/api/games/slot/spin -d "{\"amount\":200,\"idempotencyKey\":\"$(uuid)\"}"
```

### Blackjack

- **`POST /api/games/blackjack/deal`** — corpo `{ amount, idempotencyKey }`. Apre la mano
  (`status: "open"`) o la chiude subito in caso di blackjack. Risposta
  `200 { round, state, balance }` con `state` = `BlackjackPublicState`: `phase`, `step`, `active`,
  `hands[]` (`cards`, `bet`, `doubled`, `fromSplit`, `done`, `total`, `soft`, `result`), `dealer`
  (`cards` con `null` per la carta coperta, `total`, `soft`), `allowedActions`, `totalBet`,
  `result`.
- **`POST /api/games/blackjack/action`** — corpo `{ roundId, action, step }` con `action` tra
  `hit`, `stand`, `double`, `split`. `double` e `split` addebitano altre fiches (stessi controlli di
  saldo, limiti di perdita, pausa e massimo per mano di una nuova puntata). Errori:
  `400 ILLEGAL_ACTION` (`details.allowedActions`), `409 CONFLICT` (step superato,
  `details.round`), `409 ROUND_NOT_OPEN`.
- **`GET /api/games/blackjack/open`** — `200 { round: BlackjackRoundResponse | null }`: riprende una
  mano dopo un ricaricamento.

```sh
curl -s "${H[@]}" -X POST $B/api/games/blackjack/deal -d "{\"amount\":1000,\"idempotencyKey\":\"$(uuid)\"}"
# {"round":{"id":"3","status":"open",…},"state":{"phase":"player","step":0,
#  "hands":[{"cards":[5,37],"total":16,…}],"dealer":{"cards":[40,null],"total":2,…},
#  "allowedActions":["hit","stand","double"],…},"balance":99200}
curl -s "${H[@]}" -X POST $B/api/games/blackjack/action -d '{"roundId":"3","action":"stand","step":0}'
```

### Video poker

- **`POST /api/games/videopoker/deal`** — corpo `{ amount, idempotencyKey }`. Risposta
  `200 { round, state, balance }` con `state = { bet, phase: "hold", step, hand, dealt, held: null,
currentRank, result: null }`.
- **`POST /api/games/videopoker/draw`** — corpo `{ roundId, held: [5 booleani], step }`. Chiude la
  mano: `state.hand` è la mano finale, `state.result = { rank, multiplier, payout }`. Errori come
  per il blackjack.
- **`GET /api/games/videopoker/open`** — `200 { round: VideoPokerRoundResponse | null }`.

```sh
curl -s "${H[@]}" -X POST $B/api/games/videopoker/deal -d "{\"amount\":500,\"idempotencyKey\":\"$(uuid)\"}"
curl -s "${H[@]}" -X POST $B/api/games/videopoker/draw \
  -d '{"roundId":"4","held":[true,true,false,false,false],"step":0}'
```

## Storico e statistiche

### `GET /api/history?game=&cursor=&limit=`

Partite dell'utente dalla più recente. `game` facoltativo (`roulette`, `slot`, `blackjack`,
`videopoker`), `limit` 1-100 (predefinito 25), `cursor` = `nextCursor` della pagina precedente.

```sh
curl -s -b "$J" "$B/api/history?limit=2"
# {"items":[{"id":"4","game":"videopoker","status":"settled","stake":500,"payout":0,"net":-500,
#   "createdAt":"…","settledAt":"…","nonce":3,"summary":"Niente"}, …],"nextCursor":"3"}
```

### `GET /api/history/export.csv?game=`

Tutte le partite in CSV (UTF-8 con BOM, righe CRLF, importi in fiches con il punto decimale),
scaricato come `storico-fiches-AAAA-MM-GG.csv` e inviato in streaming a blocchi. Al massimo 5
export al minuto per IP e uno alla volta per utente (altrimenti `429 RATE_LIMITED`); niente `HEAD`.
Colonne: `id, gioco, stato, puntata_fiches, restituito_fiches, netto_fiches, creato_il,
concluso_il, esito, seed_pair_id, hash_server_seed, client_seed, nonce, server_seed` (vuoto finché
non è rivelato).

```sh
curl -s -b "$J" -OJ "$B/api/history/export.csv"
```

### `GET /api/history/:id`

`200 { round, detail, verifyInput }`: `detail` contiene puntate ed esito (vista pubblica per
blackjack e video poker); `verifyInput` è l'input di `verifyRound()` (null finché la partita è
aperta). `404 NOT_FOUND` se la partita non esiste o è di un altro utente.

### `GET /api/stats`

```json
{
  "lifetime": { "rounds": 4, "wagered": 2300, "returned": 1000, "net": -1300 },
  "byGame": {
    "roulette": { "rounds": 1, "wagered": 600, "returned": 1000, "net": 400 },
    "slot": { "rounds": 1, "wagered": 200, "returned": 0, "net": -200 },
    "blackjack": { "rounds": 1, "wagered": 1000, "returned": 0, "net": -1000 },
    "videopoker": { "rounds": 1, "wagered": 500, "returned": 0, "net": -500 }
  },
  "session": { "rounds": 4, "wagered": 2300, "returned": 1000, "net": -1300, "startedAt": "…" },
  "resets": 0
}
```

Solo partite concluse; `session` = dall'accesso corrente. Al massimo 30 richieste al minuto per IP.

## Gioco responsabile

Regole: [GIOCO_RESPONSABILE.md](GIOCO_RESPONSABILE.md). Tutte le rotte rispondono con `RgStatus`:

```json
{
  "lossLimits": {
    "24h": {
      "value": 5000,
      "pending": { "value": 20000, "effectiveAt": "2026-09-26T16:03:19.700Z" },
      "used": 1300,
      "remaining": 3700
    },
    "7d": { "value": null, "pending": null, "used": 1300, "remaining": null },
    "30d": { "value": null, "pending": null, "used": 1300, "remaining": null }
  },
  "selfExclusion": { "until": null },
  "realityCheckMinutes": 30,
  "session": { "startedAt": "…", "elapsedMs": 579305, "rounds": 4, "net": -1300 }
}
```

| Rotta                         | Corpo                                               | Effetto                                                                       |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/rg`                 |                                                     | stato attuale (applica le modifiche in attesa scadute)                        |
| `PUT /api/rg/loss-limit`      | `{ period: "24h" \| "7d" \| "30d", value \| null }` | abbassare/impostare: subito; alzare/rimuovere (`null`): dopo 24 h (`pending`) |
| `POST /api/rg/self-exclusion` | `{ duration: "24h" \| "7d" \| "30d" }`              | pausa fino a `max(attuale, adesso + durata)`, non revocabile                  |
| `PUT /api/rg/reality-check`   | `{ minutes: 15 \| 30 \| 60 }`                       | frequenza del promemoria                                                      |

```sh
curl -s "${H[@]}" -X PUT $B/api/rg/loss-limit -d '{"period":"24h","value":5000}'
curl -s "${H[@]}" -X POST $B/api/rg/self-exclusion -d '{"duration":"24h"}'
curl -s "${H[@]}" -X PUT $B/api/rg/reality-check -d '{"minutes":15}'
# una puntata durante la pausa:
# {"error":{"code":"RG_SELF_EXCLUDED","message":"Pausa attiva fino al 26/09/26, 18:03: …",
#  "details":{"until":"2026-09-26T16:03:30.267Z"}}}
```
