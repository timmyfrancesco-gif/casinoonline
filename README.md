# Vinted Sales Notifier

Bot che controlla il tuo account Vinted e ti manda un messaggio su Discord ogni volta che:

| | Evento |
|---|---|
| 🛍️ | Vendi un articolo (nuovo ordine) |
| 📦 | Cambia lo stato di una spedizione |
| ⭐ | Ricevi una recensione |
| 💰 | Si aggiorna il saldo del wallet |

Gira gratis su GitHub Actions: nessun server, nessun PC da tenere acceso.

---

## Cosa devi fare tu (5 minuti)

Tre valori vanno recuperati a mano, perché richiedono i tuoi account: il resto è già pronto.

> **Non incollare mai questi valori in una chat o in un file committato.** I cookie
> Vinted danno accesso completo al tuo account. Vanno solo nei GitHub Secrets
> (cifrati) o in `config.yaml` locale (escluso da git).

### 1. Rendi il repository privato ⚠️

**Questo passaggio non è opzionale.** Il bot salva i cookie di sessione nella cache di
GitHub Actions e, nei repo pubblici, quella cache è leggibile dai workflow delle fork.

`Settings` → `General` → in fondo, `Danger Zone` → `Change repository visibility` → **Private**

Il workflow si rifiuta di partire se il repo è pubblico. Se vuoi procedere comunque
accettando il rischio, crea una variabile `ALLOW_PUBLIC_REPO` = `true` in
`Settings` → `Secrets and variables` → `Actions` → `Variables`.

### 2. Crea il webhook Discord

Nel tuo server Discord: `Impostazioni canale` (l'ingranaggio accanto al canale) →
`Integrazioni` → `Webhook` → `Nuovo webhook` → `Copia URL webhook`.

### 3. Prendi i cookie di Vinted

1. Apri https://www.vinted.it e fai login.
2. Premi `F12` per aprire i DevTools.
3. Vai su `Application` (Chrome) o `Archiviazione` (Firefox) → `Cookie` → `https://www.vinted.it`.
4. Copia i valori (colonna *Value*) di **`access_token_web`** e **`refresh_token_web`**.

### 4. Inserisci i 3 valori nei GitHub Secrets

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`.

Creane tre, con questi nomi esatti:

| Nome del secret | Valore |
|---|---|
| `VINTED_ACCESS_TOKEN` | il cookie `access_token_web` |
| `VINTED_REFRESH_TOKEN` | il cookie `refresh_token_web` |
| `DISCORD_WEBHOOK_URL` | l'URL del webhook Discord |

### 5. Porta il workflow sul branch principale ⚠️

GitHub esegue i workflow programmati **solo dal branch di default**. Finché il codice
resta sul branch `claude/discord-bot-vinted-g6ggyg`, il cron non parte mai.
Fai il merge su `main` prima di andare avanti.

### 6. Verifica che funzioni

`Actions` → `Vinted Notifier` → `Run workflow` → spunta **test** → `Run workflow`.

Il test controlla i cookie, legge le notifiche del tuo account e ti manda un messaggio
di prova su Discord. Se arriva, è tutto a posto: da lì in poi il bot gira da solo
ogni 5 minuti.

---

## Come funziona

Al primo avvio reale il bot memorizza le notifiche già presenti **senza inviarle**
(così non ricevi un muro di messaggi su vendite vecchie). Da quel momento notifica
solo i nuovi eventi.

Lo stato (notifiche già viste + cookie aggiornati) viene conservato tra un'esecuzione
e l'altra nella cache di GitHub Actions.

**Ritardo:** i cron di GitHub non sono puntuali, aspettati **5-15 minuti** tra la
vendita e la notifica. Se ti serve tempo reale, vedi *Farlo girare sul tuo PC*.

## ⚠️ Limite importante da conoscere

Vinted **non ha un'API pubblica** per ordini, vendite e wallet. Il bot legge un
endpoint interno (`/api/v2/inbox/notifications`), quello che il sito usa per la
campanella delle notifiche. Non è documentato e **Vinted può cambiarlo in
qualsiasi momento**, rompendo il bot senza preavviso.

Il bot si limita a **leggere** le notifiche: non compra, non scrive messaggi e non
compie nessuna azione per tuo conto.

### Se non funziona

Lancia il workflow in modalità *test*: ti dice a che punto si rompe.

**"Cookie scaduti o non validi"** → rifai il punto 3 e aggiorna i due secret.
I cookie vanno rinnovati ogni tanto, è normale.

**Il test passa ma non arrivano notifiche di vendita**, oppure il test avverte che
nessuna notifica è stata riconosciuta → è cambiato il formato di Vinted:

1. Su vinted.it loggato, apri `F12` → tab `Network`, filtra per `notifications`
   e guarda la risposta JSON reale.
2. Se il percorso è cambiato, aggiorna `NOTIFICATIONS_PATH` in `vinted_client.py`.
3. Se sono cambiati i nomi dei campi o i valori di `type`, aggiorna
   `CATEGORY_KEYWORDS` e `normalize()` in `vinted_events.py`.

## Farlo girare sul tuo PC (notifiche in ~60 secondi)

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml   # compila i valori
python main.py --test                # verifica
python main.py                       # avvia il loop
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `python main.py` | Loop continuo (per PC/server) |
| `python main.py --once` | Un solo controllo ed esce (usato da GitHub Actions) |
| `python main.py --test` | Verifica cookie e webhook, manda un messaggio di prova |

## Struttura

| File | Ruolo |
|---|---|
| `main.py` | Punto di ingresso, loop e modalità test |
| `config.py` | Configurazione da env (secrets) o YAML |
| `vinted_client.py` | Sessione autenticata Vinted, refresh e rotazione cookie |
| `vinted_events.py` | Riconosce il tipo di notifica |
| `discord_notifier.py` | Costruisce e invia gli embed Discord |
| `storage.py` | Ricorda le notifiche già inviate |
| `.github/workflows/vinted-notifier.yml` | Esecuzione programmata |
