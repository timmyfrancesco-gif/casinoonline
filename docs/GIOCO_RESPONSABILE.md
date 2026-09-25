# Gioco responsabile

Questo progetto usa solo **fiches virtuali**: non si comprano, non si vincono premi, non si
convertono in denaro e non si trasferiscono tra utenti. Anche senza denaro, i giochi d'azzardo
usano meccanismi che possono creare abitudine: per questo le protezioni qui sotto sono parte del
prodotto e non opzioni di marketing.

> **Hai bisogno di parlarne?** Telefono Verde Nazionale per le problematiche legate al Gioco
> d'Azzardo dell'Istituto Superiore di Sanità (ISS): **800 558 822**, gratuito e anonimo.

Il numero è mostrato nella pagina **Gioco responsabile** del sito (`/gioco-responsabile`), insieme a
limiti, pausa e promemoria. Le regole di dettaglio sono in `docs/SPEC.md` §5; il codice in
`apps/server/src/services/rg.ts`, `apps/server/src/services/wallet.ts` e
`apps/web/src/app/RealityCheck.tsx`.

## Protezioni e comportamento esatto

### Limiti di perdita (24 ore, 7 giorni, 30 giorni)

- Tre limiti indipendenti su **finestre mobili** di 24 h, 7 giorni e 30 giorni, in fiches intere.
- La perdita usata è la perdita netta nella finestra:
  `usata = max(0, −(somma dei movimenti "puntata" e "vincita" nella finestra))`.
  I movimenti di **reset del saldo non contano**: ricominciare non azzera la perdita usata.
- Ogni nuova puntata, e ogni raddoppio o divisione nel blackjack, di importo `s` è **rifiutata** se
  `usata + s > limite` per almeno una finestra: la puntata è considerata già persa (approccio
  prudente). Errore `403 RG_LOSS_LIMIT` con la finestra più restrittiva e quanto si può ancora
  puntare (`details: { period, remaining }`).
- **Abbassare** un limite, o impostarlo dove non c'era, ha **effetto immediato**.
- **Alzare o rimuovere** un limite diventa una modifica **in attesa** che entra in vigore dopo
  **24 ore**; fino ad allora resta valido il limite precedente. Una nuova richiesta di aumento
  sostituisce quella in attesa e fa ripartire le 24 ore; un nuovo abbassamento la annulla.
- Le modifiche in attesa scadute vengono applicate automaticamente alla prima lettura o al primo
  controllo successivo.
- Tutto avviene sul server, nella stessa transazione della puntata e con il lock dell'utente: più
  schede o richieste parallele non possono superare il limite.

### Pausa (autoesclusione) di 24 ore, 7 giorni o 30 giorni

- La fine della pausa è `max(fine attuale, adesso + durata)`: una pausa **non si può accorciare né
  revocare**, una nuova pausa può solo allungarla. Il sito chiede una conferma esplicita ("Ho capito
  che la pausa non si può annullare").
- Durante la pausa puoi accedere e consultare saldo, storico, statistiche e verifiche, ma **non puoi
  puntare**: ogni nuova partita è rifiutata con `403 RG_SELF_EXCLUDED` e la data di fine
  (`details.until`).
- Una mano di blackjack o video poker **già in corso** si può completare (carta, stai, cambio
  carte), ma **non si possono aggiungere fiches** (raddoppio e divisione sono rifiutati).

### Promemoria di gioco (reality check)

- Ogni 15, 30 o 60 minuti di sessione (predefinito **30**, modificabile) compare una **finestra
  bloccante** con il tempo di gioco, il numero di partite concluse e il **risultato netto** della
  sessione (dati da `GET /api/rg`).
- Le scelte sono **"Continua a giocare"** o **"Esci"** (disconnessione). La sessione inizia
  all'accesso. Il promemoria già confermato è ricordato per sessione, quindi ricaricare la pagina
  non fa saltare un promemoria dovuto.

### Ricomincia (reset del saldo)

- Possibile **solo** se il saldo è sotto le 1.000 fiches iniziali e non ci sono mani in corso
  (altrimenti `409 RESET_NOT_ALLOWED`). Riporta il saldo a 1.000 fiches con un movimento di tipo
  "reset" nel registro.
- **Non cancella nulla**: statistiche, storico e perdita usata per i limiti restano invariati; il
  numero di reset è mostrato nelle statistiche.

### Statistiche oneste

- `GET /api/stats` e la pagina Profilo mostrano totale puntato, totale restituito e **risultato
  netto** (anche quando è negativo) per sempre, per gioco e per la sessione corrente, più il numero
  di reset.
- Ogni tavolo mostra **RTP e vantaggio del banco** (vedi [GIOCHI.md](GIOCHI.md)); lo storico elenca
  ogni partita con il netto e si può esportare in CSV.

### Altre scelte di design

- **Banner permanente** "fiches virtuali" in ogni pagina.
- **Solo maggiorenni**: alla registrazione si chiede la data di nascita per verificare i 18 anni
  (ora italiana); la data **non viene salvata**, si registra solo il momento della conferma.
- **Puntata predefinita = minimo del tavolo**.
- Le animazioni partono solo dopo la risposta del server, durano meno di 2 secondi, **terminano
  sempre sull'esito deciso dal server** e sono disattivate con `prefers-reduced-motion`.
- L'esito è evidenziato come vincita **solo se il netto è positivo**: una vincita inferiore alla
  puntata complessiva (es. rosso vincente ma pieno perdente) è mostrata come perdita netta, senza
  festeggiamenti.
- Ogni partita è verificabile (provably fair, [PROVABLY_FAIR.md](PROVABLY_FAIR.md)).

## Cosa il prodotto non fa, deliberatamente

- **Nessun bonus**: né di benvenuto, né giornaliero, né "ricarica"; nessuna fiche regalata oltre al
  saldo iniziale e al reset.
- **Nessuna serie** (streak), missione, livello, obiettivo o ricompensa per la frequenza di gioco.
- **Nessuna notifica** "torna a giocare", email promozionale o messaggio di richiamo.
- **Nessun autoplay** e **nessuna modalità turbo**: ogni partita parte da un'azione del giocatore
  (clic o scorciatoia da tastiera); tenere premuto un tasto non ripete la puntata.
- **Nessun near-miss pilotato**: la slot mostra sempre le vere posizioni estratte, con una striscia
  fissa uguale per i tre rulli; i rulli si fermano sempre con gli stessi tempi (sfalsati e fissi),
  qualunque sia l'esito: nessun rallentamento "ad effetto" quando manca un simbolo.
- **Nessuna classifica**, chat, condivisione delle vincite o confronto con altri giocatori.
- **Nessun acquisto**, nessun premio, nessuna conversione, nessun trasferimento di fiches.
- **Nessuna pubblicità** di operatori di gioco né link verso di essi (art. 9 DL 87/2018, "Decreto
  Dignità").

## Limiti delle protezioni

- **Limiti di perdita, pausa, reset, controlli dei tavoli e statistiche sono applicati dal
  server**: valgono anche per chi usa l'API direttamente o più schede.
- Il **promemoria di gioco è lato client**: il server fornisce i dati, ma la finestra è mostrata dal
  browser. Non compare se la pagina è chiusa o se qualcuno usa l'API con uno script; la sessione si
  misura dall'accesso, non dal tempo effettivo davanti allo schermo.
- La pausa blocca **questo account**: nulla impedisce di crearne un altro con un nome utente diverso
  (non raccogliamo dati identificativi, per scelta di privacy).
- La verifica dell'età si basa sulla data di nascita dichiarata: non è un controllo documentale.
- Nessuna protezione tecnica sostituisce l'aiuto di una persona: se il gioco ti preoccupa, chiama
  l'**800 558 822**.
