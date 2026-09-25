# Giochi: regole, pagamenti e ritorno teorico

Le fiches sono virtuali e non hanno valore economico. I numeri qui sotto descrivono il gioco
**nel lungo periodo**: nessuna strategia, sequenza o sistema di puntata cambia il vantaggio del banco
di roulette e slot; nel blackjack e nel video poker conta solo giocare ogni mano nel modo corretto.

Le regole ufficiali sono i commenti dei file `packages/engine/src/games/*/index.ts`; i valori sono
verificati dai test dell'engine (`packages/engine/test`).

**Definizioni.** Il _pagamento_ è indicato come "x a 1" (vincita netta) oppure come "totale
restituito" (puntata inclusa). **RTP** (return to player) = totale restituito ÷ totale puntato nel
lungo periodo; **vantaggio del banco** = 1 − RTP.

| Gioco                       | RTP                | Vantaggio del banco | Note                                      |
| --------------------------- | ------------------ | ------------------- | ----------------------------------------- |
| Roulette europea            | 97,30% (36/37)     | 2,70% (1/37)        | identico per ogni tipo di puntata, esatto |
| Slot Frutta                 | 93,65% (7492/8000) | 6,35%               | esatto, per enumerazione                  |
| Blackjack                   | ≈ 99,5%            | ≈ 0,5%              | con la strategia di base                  |
| Video Poker Jacks or Better | 99,54%             | 0,46%               | solo con strategia ottimale               |

## Limiti dei tavoli

Importi in fiches intere (internamente 1 fiche = 100 unità). Saldo iniziale: 1.000 fiches.

| Gioco       | Minimo | Massimo per puntata           | Massimo per giro/mano                |
| ----------- | ------ | ----------------------------- | ------------------------------------ |
| Roulette    | 1      | 100 per posizione del tappeto | 500 in totale, al massimo 40 puntate |
| Slot        | 1      | 50                            | 50                                   |
| Blackjack   | 1      | 100 (puntata iniziale)        | 400 (con divisione e raddoppi)       |
| Video poker | 1      | 50                            | 50                                   |

Nella roulette le puntate identiche sulla stessa posizione si sommano per il limite di 100.

## Roulette europea

Ruota con **37 caselle** (0-36, un solo zero). Rossi: 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23,
25, 27, 30, 32, 34, 36; gli altri numeri da 1 a 36 sono neri; lo 0 è verde.

| Puntata                      | Numeri coperti                          | Paga | Probabilità | Ritorno atteso |
| ---------------------------- | --------------------------------------- | ---- | ----------- | -------------- |
| Pieno (`straight`)           | 1                                       | 35:1 | 1/37        | 36/37          |
| Cavallo (`split`)            | 2 adiacenti (anche 0-1, 0-2, 0-3)       | 17:1 | 2/37        | 36/37          |
| Terzina (`street`)           | 3, una riga (es. 1-2-3)                 | 11:1 | 3/37        | 36/37          |
| Terzina con lo zero (`trio`) | 0-1-2 oppure 0-2-3                      | 11:1 | 3/37        | 36/37          |
| Carré (`corner`)             | 4 in quadrato (es. 1-2-4-5)             | 8:1  | 4/37        | 36/37          |
| Quartina (`basket`)          | 0-1-2-3                                 | 8:1  | 4/37        | 36/37          |
| Sestina (`sixline`)          | 6, due righe adiacenti (es. 1-6)        | 5:1  | 6/37        | 36/37          |
| Dozzina (`dozen`)            | 1-12, 13-24, 25-36                      | 2:1  | 12/37       | 36/37          |
| Colonna (`column`)           | 1, 4, …, 34 / 2, 5, …, 35 / 3, 6, …, 36 | 2:1  | 12/37       | 36/37          |
| Rosso, nero, pari, dispari   | 18                                      | 1:1  | 18/37       | 36/37          |
| Manque 1-18, passe 19-36     | 18                                      | 1:1  | 18/37       | 36/37          |

- Una puntata vincente restituisce `importo × (paga + 1)`; quelle perdenti 0.
- Lo **0 fa perdere tutte le puntate esterne** (niente "la partage" né "en prison").
- Per ogni tipo di puntata: numeri coperti × (paga + 1) = 36, quindi il ritorno atteso è 36/37 =
  **97,297%** e il vantaggio del banco 1/37 = **2,703%**. Il test dell'engine lo verifica
  sommando tutti i 37 esiti per ogni tipo di puntata.

## Slot Frutta

Tre rulli, **una linea di pagamento**. Ogni rullo è la stessa striscia di 20 posizioni con:
7 ×1, BAR ×2, campana ×3, ciliegia ×4, limone ×5, arancia ×5 (ordine della striscia in
[PROVABLY_FAIR.md](PROVABLY_FAIR.md#slot)). Ogni fermata ha probabilità 1/20, i rulli sono
indipendenti: 20³ = **8.000 combinazioni equiprobabili**.

| Combinazione sulla linea           | Totale restituito | Combinazioni | Probabilità | Contributo all'RTP |
| ---------------------------------- | ----------------- | ------------ | ----------- | ------------------ |
| 7 7 7                              | 100 × puntata     | 1            | 1/8000      | 100/8000           |
| BAR BAR BAR                        | 40 ×              | 8            | 8/8000      | 320/8000           |
| Campana ×3                         | 20 ×              | 27           | 27/8000     | 540/8000           |
| Ciliegia ×3                        | 15 ×              | 64           | 64/8000     | 960/8000           |
| Limone ×3                          | 10 ×              | 125          | 125/8000    | 1250/8000          |
| Arancia ×3                         | 10 ×              | 125          | 125/8000    | 1250/8000          |
| Esattamente due ciliegie (ovunque) | 4 ×               | 768          | 768/8000    | 3072/8000          |
| **Totale**                         |                   | **1.118**    | **13,975%** | **7492/8000**      |

- **RTP esatto = 7492 / 8000 = 93,65%**, vantaggio del banco 6,35%, frequenza di vincita
  1118/8000 = 13,975% (verificati dal test enumerando tutte le 8.000 fermate).
- Una sola ciliegia non paga. Due ciliegie restituiscono 4 volte la puntata (vincita netta 3×).
- Nessun "quasi vincente" pilotato: le righe sopra e sotto la linea mostrano sempre i simboli
  adiacenti alle fermate estratte.

## Blackjack

- **6 mazzi**, rimescolati **a ogni mano** (un sabot nuovo per ogni round: il conteggio delle carte
  non serve e ogni mano è verificabile da sola).
- Valori: asso 1 o 11, 2-9 valore facciale, 10/J/Q/K = 10. Una mano è "soft" quando un asso vale 11.
- **Blackjack** = asso + carta da 10 come prime due carte di una mano **non divisa**: paga **3:2**
  (restituisce 2,5 × puntata).
- **Il banco controlla subito il blackjack** (peek): se ce l'ha, la mano si chiude alla distribuzione
  (tuo blackjack = pareggio, altrimenti perdi solo la puntata iniziale).
- **Il banco sta su tutti i 17**, anche soft (S17), e pesca con 16 o meno.
- Azioni:
  - **Carta**: una carta; oltre 21 la mano sballa; a 21 esatti la mano si ferma da sola.
  - **Stai**: chiude la mano.
  - **Raddoppia**: solo sulle prime due carte (anche dopo una divisione): la puntata raddoppia,
    ricevi esattamente una carta e la mano si chiude.
  - **Dividi**: solo con due carte dello **stesso valore nominale** (K-K sì, K-Q no), **una volta**
    per mano (massimo 2 mani); costa una seconda puntata uguale. Ogni nuova mano riceve subito una
    carta. Gli **assi divisi** ricevono una sola carta ciascuno. Asso + 10 dopo una divisione vale
    21, non blackjack.
- **Niente assicurazione, niente resa** (surrender).
- Pagamenti per mano: sballata 0 · banco sballato o punteggio più alto 2 × puntata · pareggio
  restituisce la puntata · punteggio più basso 0 · blackjack naturale 2,5 × puntata.

**Ritorno teorico.** Con queste regole (6 mazzi, S17, raddoppio dopo divisione, una sola divisione,
nessuna resa, blackjack 3:2) e la **strategia di base** il vantaggio del banco è di circa
**0,4-0,5%**: al tavolo indichiamo "≈ 99,5%". Il test `packages/engine/test/blackjack-rtp.test.ts`
simula 200.000 mani con la strategia di base (seme fisso) e misura:

| Misura                                        | Valore  |
| --------------------------------------------- | ------- |
| Ritorno per puntata iniziale                  | 0,99606 |
| RTP sul totale puntato (raddoppi e divisioni) | 0,99650 |
| Errore standard della simulazione (1σ)        | ± 0,26% |

La simulazione conferma che il valore è compatibile con quello teorico, ma non è abbastanza lunga
per misurarlo con più precisione. Giocando diversamente dalla strategia di base il ritorno scende.
Al tavolo puoi attivare il suggerimento della strategia di base.

## Video Poker Jacks or Better 9/6

- Un mazzo da 52 carte, mescolato a ogni mano. Ricevi 5 carte, scegli quali **tenere**, le altre
  vengono sostituite una sola volta (nell'ordine del mazzo, da sinistra a destra).
- Scale: A-2-3-4-5 e 10-J-Q-K-A valgono; niente scale "circolari" (Q-K-A-2-3 non è scala).

| Mano finale                       | Totale restituito | Mani iniziali su 2.598.960 (prima del cambio) |
| --------------------------------- | ----------------- | --------------------------------------------- |
| Scala reale massima (10-J-Q-K-A)  | 800 × puntata     | 4                                             |
| Scala colore                      | 50 ×              | 36                                            |
| Poker                             | 25 ×              | 624                                           |
| Full                              | 9 ×               | 3.744                                         |
| Colore                            | 6 ×               | 5.108                                         |
| Scala                             | 4 ×               | 10.200                                        |
| Tris                              | 3 ×               | 54.912                                        |
| Doppia coppia                     | 2 ×               | 123.552                                       |
| Coppia di J, Q, K o A             | 1 × (pareggio)    | 337.920                                       |
| Niente (incluse coppie da 2 a 10) | 0                 | 2.062.860                                     |

La terza colonna conta le mani **servite** (verificata dal test enumerando tutte le 2.598.960
combinazioni), non la frequenza finale, che dipende da cosa tieni.

**Ritorno teorico: 99,54%** (valore noto per la tabella 9/6 con scala reale a 800×) **solo con la
strategia ottimale**, cioè scegliendo sempre le carte da tenere con il valore atteso più alto. Ogni
errore lo abbassa. Il suggerimento del tavolo calcola nel browser il valore atteso **esatto** di
tutte le 32 scelte possibili (enumerando ogni pescata dalle 47 carte restanti) e propone la
migliore.
