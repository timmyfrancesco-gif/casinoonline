# Provably fair: come verificare ogni partita

Ogni esito (numero della roulette, fermate dei rulli, sabot del blackjack, mazzo del video poker) è
calcolato in modo **deterministico** da tre valori, più le scelte del giocatore:

| Valore       | Chi lo sceglie                                     | Quando è visibile                               |
| ------------ | -------------------------------------------------- | ----------------------------------------------- |
| `serverSeed` | il server (32 byte casuali, 64 caratteri esadec.)  | solo dopo la **rotazione** della coppia di seed |
| `clientSeed` | il giocatore (o casuale, se non lo sceglie)        | sempre                                          |
| `nonce`      | contatore 0, 1, 2, … per ogni partita della coppia | sempre (ogni partita riporta il proprio nonce)  |

Prima di giocare vedi l'**impronta** `serverSeedHash = SHA-256(serverSeed)`: è l'impegno del server.
Il server seed di ogni nuova coppia è generato **in anticipo**: ne vedi l'impronta
(`next.serverSeedHash`) prima di scegliere il client seed con cui userai quella coppia. Quando ruoti
la coppia, il `serverSeed` viene rivelato; puoi controllare che il suo SHA-256 corrisponda
all'impronta vista prima e ricalcolare **tutte** le partite giocate con quella coppia.

Il codice di riferimento è [`packages/engine/src/fair/rng.ts`](../packages/engine/src/fair/rng.ts)
(generatore) e [`packages/engine/src/verify.ts`](../packages/engine/src/verify.ts) (`verifyRound()`),
lo stesso usato dal server e dalla pagina **Verifica** del sito, che esegue il calcolo nel browser.

## 1. Il generatore casuale

### Flusso di byte

Il flusso di byte di una partita è la concatenazione dei blocchi

```text
blocco(cursor) = HMAC_SHA256( chiave   = UTF-8(serverSeed),
                              messaggio = UTF-8(clientSeed + ":" + nonce + ":" + cursor) )
```

per `cursor = 0, 1, 2, …`

- La **chiave** è il testo del server seed (i 64 caratteri esadecimali codificati in UTF-8), **non** i
  32 byte che rappresenta.
- `nonce` e `cursor` sono scritti in decimale, senza zeri iniziali: per il client seed `abc`,
  nonce 7, il primo messaggio è `abc:7:0`, il secondo `abc:7:1`.
- Il client seed non può contenere `:` (separatore dei campi) né spazi: 1-64 caratteri ASCII
  stampabili (`CLIENT_SEED_PATTERN`). Così ogni messaggio ha una sola lettura possibile.

### Interi a 32 bit

Ogni blocco da 32 byte fornisce **8 interi senza segno a 32 bit big-endian**: byte 0-3, 4-7, …,
28-31. Esauriti gli 8 valori si passa al blocco con `cursor + 1`.

### Interi uniformi in [0, n): campionamento con rifiuto

Per estrarre un intero in `[0, n)` senza distorsione da modulo:

```text
limite = 2^32 − (2^32 mod n)          // il più grande multiplo di n che sta in 32 bit
ripeti:
  x = prossimo uint32
  se x < limite: restituisci x mod n  // altrimenti x è scartato e si legge il successivo
```

Ogni valore in `[0, n)` ha quindi **esattamente** la stessa probabilità. Gli scarti sono rarissimi
(ma gestiti):

| n   | uso                        | 2^32 mod n | limite     | probabilità di scarto |
| --- | -------------------------- | ---------- | ---------- | --------------------- |
| 37  | roulette                   | 7          | 4294967289 | 1,6 × 10⁻⁹            |
| 20  | slot (un rullo)            | 16         | 4294967280 | 3,7 × 10⁻⁹            |
| 52  | primo passo, mazzo singolo | 48         | 4294967248 | 1,1 × 10⁻⁸            |
| 312 | primo passo, sabot 6 mazzi | 256        | 4294967040 | 6,0 × 10⁻⁸            |

### Mescolata: Fisher-Yates

```text
per i da (lunghezza − 1) giù fino a 1:
  j = int(i + 1)          // intero uniforme in [0, i]
  scambia carte[i] e carte[j]
```

### Codifica delle carte

Una carta è un intero `0..51`:

- valore = `codice % 13` → 0 = A, 1 = 2, …, 8 = 9, 9 = 10, 10 = J, 11 = Q, 12 = K
- seme = `floor(codice / 13)` → 0 = ♠ picche, 1 = ♥ cuori, 2 = ♦ quadri, 3 = ♣ fiori

Il mazzo **ordinato** di partenza è `0, 1, …, 51`; un sabot di 6 mazzi è la stessa sequenza
ripetuta 6 volte (312 carte).

## 2. Derivazione per gioco

Ogni partita usa **un solo nonce**, anche se si gioca in più passi: sabot e mazzo sono generati
interamente alla distribuzione e salvati sul server; le azioni successive li consumano in ordine.

| Gioco       | Estrazioni                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------- |
| Roulette    | `numero = int(37)`: una sola chiamata; il risultato è direttamente la casella 0-36.           |
| Slot        | `fermate = [int(20), int(20), int(20)]`, rulli 0, 1, 2 in quest'ordine.                       |
| Blackjack   | `sabot = FisherYates(mazzo ordinato × 6)`, cioè 311 chiamate `int(312), int(311), …, int(2)`. |
| Video poker | `mazzo = FisherYates(0..51)`, cioè 51 chiamate `int(52), int(51), …, int(2)`.                 |

### Roulette

`int(37)` restituisce il numero uscito. L'ordine dei numeri sulla ruota (`WHEEL_ORDER`) serve solo
all'animazione e non entra nel calcolo.

### Slot

I tre rulli usano la stessa striscia di 20 posizioni; la fermata è l'indice nella striscia e il
simbolo sulla linea di pagamento è `STRISCIA[fermata]`. Le righe mostrate sopra e sotto sono
`fermata − 1` e `fermata + 1` (modulo 20): nessun "quasi vincente" costruito ad arte, si vede sempre
la vera posizione estratta.

| Posizione | 0     | 1      | 2      | 3    | 4     | 5   | 6      | 7      | 8     | 9    |
| --------- | ----- | ------ | ------ | ---- | ----- | --- | ------ | ------ | ----- | ---- |
| Simbolo   | LEMON | CHERRY | ORANGE | BELL | LEMON | BAR | ORANGE | CHERRY | LEMON | BELL |

| Posizione | 10     | 11    | 12    | 13     | 14     | 15  | 16    | 17     | 18     | 19   |
| --------- | ------ | ----- | ----- | ------ | ------ | --- | ----- | ------ | ------ | ---- |
| Simbolo   | ORANGE | SEVEN | LEMON | CHERRY | ORANGE | BAR | LEMON | CHERRY | ORANGE | BELL |

### Blackjack

Sabot di 6 mazzi mescolato **a ogni mano**. Ordine di distribuzione:

1. `sabot[0]` → giocatore, `sabot[1]` → banco (carta scoperta), `sabot[2]` → giocatore,
   `sabot[3]` → banco (carta coperta).
2. Poi le carte si prendono in sequenza da `sabot[4]` in avanti, nell'ordine in cui servono:
   - **carta** / **raddoppio**: una carta alla mano attiva;
   - **dividi**: le due nuove mani ricevono subito una carta ciascuna, prima la sinistra e poi la
     destra; si gioca poi la mano sinistra, quindi la destra;
   - alla fine il **banco** pesca finché ha meno di 17 (non pesca se tutte le mani hanno sballato).

L'esito dipende quindi da seed, nonce **e** dalla sequenza di azioni del giocatore, che il server
registra (`verifyInput.actions`, es. `["hit", "stand"]`).

### Video poker

Mazzo singolo mescolato. `mazzo[0..4]` è la mano iniziale. Al cambio, le posizioni **non tenute**
sono sostituite da sinistra a destra con `mazzo[5]`, `mazzo[6]`, … nell'ordine. L'esito dipende da
seed, nonce e dalla maschera delle carte tenute (`verifyInput.held`).

## 3. Ciclo di vita dei seed

1. **Registrazione**: il server crea la prima coppia attiva, con `serverSeed` = 32 byte da
   `crypto.randomBytes` in esadecimale e `clientSeed` = 16 byte casuali in esadecimale (il prossimo
   nonce è 0), e genera subito anche il **prossimo server seed** (altri 32 byte casuali), di cui
   mostra solo l'impronta. Per gli account creati prima della migrazione `002_next_server_seed` il
   primo prossimo seed è generato dalla migrazione (SHA-256 di due UUID casuali di PostgreSQL, 244
   bit di casualità).
2. **Ogni partita**, nella stessa transazione della puntata: la coppia attiva viene bloccata, la
   partita riceve `nonce = next_nonce` e il contatore avanza di 1. Il database impone l'unicità di
   `(coppia, nonce)`: due partite non possono mai condividere lo stesso flusso casuale.
3. Finché la coppia è attiva, l'API non restituisce mai il server seed: ogni partita riporta
   `fairness = { seedPairId, serverSeedHash, clientSeed, nonce, serverSeed: null }`.
4. **Rotazione** (`POST /api/fairness/rotate`, dal Profilo): la coppia attiva viene disattivata e
   rivelata (`revealed_at`), e ne nasce una nuova con nonce 0, il client seed indicato e come server
   seed **il prossimo server seed già impegnato**: l'impronta della nuova coppia attiva è quella
   mostrata prima come `next.serverSeedHash`. Subito dopo il server genera un nuovo prossimo server
   seed per la rotazione successiva.
   - Il Profilo sceglie sempre il client seed nel browser (quello che scrivi, oppure 16 byte casuali
     generati con `crypto.getRandomValues`) e invia anche `nextServerSeedHash`, l'impronta che hai
     visto. Se nel frattempo i seed sono stati ruotati altrove (es. da un'altra scheda), il server
     risponde `409 CONFLICT` e non ruota: la nuova coppia usa sempre il seed che avevi visto
     impegnato. Dopo la rotazione il Profilo controlla che la nuova impronta attiva coincida con
     quella annunciata.
   - La rotazione è **rifiutata se c'è una mano in corso** (`409 SEED_ROTATION_BLOCKED`): rivelare
     il seed permetterebbe di calcolare le carte ancora coperte.
5. `GET /api/fairness` mostra la coppia attiva (impronta, client seed, prossimo nonce), l'impronta
   del prossimo server seed (`next.serverSeedHash`) e le ultime 20 coppie rivelate con `serverSeed`
   e numero di partite giocate (`roundsPlayed`: nonce da 0 a `roundsPlayed − 1`). Lo storico e
   l'export CSV riportano per ogni partita seed, impronta e nonce.
6. Il browser **conserva** (in `localStorage`, al massimo 200 coppie) l'impronta di ogni coppia che
   vede prima della rivelazione: quella della coppia attiva, quella riportata da ogni partita e,
   alla rotazione, il `next.serverSeedHash` annunciato. La pagina Verifica confronta il seed
   rivelato con questa copia, non con l'impronta che il server invia insieme al seed.

### Garanzie e limiti

- Il server si impegna sul `serverSeed` (ne mostra l'impronta) **prima** di ogni partita giocata con
  quella coppia, e il nonce è registrato: non può cambiare un esito dopo averlo visto, né scegliere a
  posteriori quale nonce usare.
- Il server seed di ogni coppia nata da una rotazione è fissato **prima** che il giocatore scelga il
  client seed (ne è stata mostrata l'impronta come `next.serverSeedHash`): il server non può provare
  molti server seed per un client seed ormai noto e tenere il più favorevole al banco.
- Limiti che restano:
  - la **prima coppia**, creata alla registrazione, ha anche il client seed scelto dal server. Per
    la garanzia completa ruota i seed dal Profilo prima di giocare;
  - chi usa l'API direttamente e ruota senza `clientSeed` riceve un client seed scelto dal server;
    senza `nextServerSeedHash` la rotazione non controlla quale impronta avevi visto;
  - la prova che il seed rivelato è quello promesso vale se l'impronta è stata conservata prima
    della rivelazione: dal browser (la pagina Verifica indica se il confronto usa la copia locale o
    solo l'impronta fornita ora dal server, e segnala in rosso un'impronta diversa da quella
    registrata) oppure annotata da te.
- Dato che le fiches non hanno valore, il rischio pratico è comunque nullo; questi limiti sono
  dichiarati per trasparenza.

## 4. Come verificare

### Nel sito

**Storico** → apri una partita → **Verifica** (pagina `/verifica?round=<id>`). Se il seed non è ancora
rivelato, ruota la coppia dal **Profilo** e riapri la verifica. La pagina ricalcola la partita nel
browser con `verifyRound()`, controlla il seed rivelato contro l'impronta conservata dal browser
prima della rivelazione e confronta esito, puntata e pagamento con quanto registrato dal server.
Puoi anche compilare il modulo a mano (gioco, seed, nonce, puntate/mosse): se cambi i dati della
partita registrata il confronto con l'esito registrato non si applica.

### Con uno script indipendente (solo `node:crypto`)

[`docs/verify-example.mjs`](verify-example.mjs) reimplementa il generatore e le estrazioni senza
usare il codice del progetto né dipendenze. Richiede solo Node.js 22:

```sh
node docs/verify-example.mjs <serverSeed> <clientSeed> <nonce> [roulette|slot|blackjack|videopoker]
```

Esempio con una coppia reale rivelata da un'istanza di prova (4 partite: roulette al nonce 0, slot
all'1, blackjack al 2, video poker al 3):

```sh
node docs/verify-example.mjs \
  943a38144652c5106d1976a866ea8cd99a95f071df518d524c52dfc31b873f63 \
  23adba2431aa627815b2ca9ab1083dc3 0 roulette
```

```text
sha256(serverSeed) = d7ebb4bca8a3f81e7fd921ae0dcc982db300b4f1a3f58f00b86c8b226e5dea51
roulette:    numero 30 (rosso)
```

Con lo stesso seed:

| Nonce | Gioco      | Output dello script                             | Registrato dal server                                 |
| ----- | ---------- | ----------------------------------------------- | ----------------------------------------------------- |
| 0     | roulette   | `numero 30 (rosso)`                             | `number: 30, color: "red"`                            |
| 1     | slot       | `fermate 18, 19, 5 -> ORANGE \| BELL \| BAR`    | `stops: [18, 19, 5]`                                  |
| 2     | blackjack  | `giocatore 6♠ Q♦, banco 2♣ 5♠`, poi `Q♣ …`      | mano `[5, 37]`, banco `[40, 4, 50]` dopo "stai": 17   |
| 3     | videopoker | `mano 10♣ Q♣ 7♦ 2♦ A♣, sostituzioni 4♣ 3♦ 3♣ …` | tenute le prime 2, mano finale `[48, 50, 42, 28, 41]` |

Lo script è stato confrontato con `@casino/engine` su 2.000 terne casuali (seed, client seed, nonce):
flusso di uint32, roulette, slot, sabot del blackjack e mazzo del video poker coincidono sempre.

### A mano, con OpenSSL (roulette)

```sh
S=943a38144652c5106d1976a866ea8cd99a95f071df518d524c52dfc31b873f63
C=23adba2431aa627815b2ca9ab1083dc3
printf '%s' "$S" | sha256sum                                   # = impronta mostrata prima
printf '%s' "$C:0:0" | openssl dgst -sha256 -hmac "$S"         # blocco 0 del nonce 0
# 4b77ecf956e6dd08...  → primi 4 byte 0x4b77ecf9 = 1266150649
# 1266150649 < 4294967289 (limite per 37)  →  1266150649 mod 37 = 30
```

### Con `verifyRound()` (esito e pagamento completi)

Dalla radice del repository:

```sh
npx tsx -e "
import { verifyRound } from './packages/engine/src/index.ts';
const seeds = {
  serverSeed: '943a38144652c5106d1976a866ea8cd99a95f071df518d524c52dfc31b873f63',
  clientSeed: '23adba2431aa627815b2ca9ab1083dc3',
  nonce: 2,
};
const r = verifyRound(seeds, { game: 'blackjack', bet: 1000, actions: ['stand'] });
console.log(r.state.dealer, r.state.result);
"
```

L'oggetto `verifyInput` restituito da `GET /api/history/:id` è esattamente il secondo argomento di
`verifyRound()`.
