# Vinted Sales Notifier Bot

Script Python che controlla periodicamente le notifiche del tuo account Vinted
e invia su Discord (via webhook) un avviso ogni volta che:

- 🛍️ vendi un articolo (nuovo ordine)
- 📦 lo stato di spedizione cambia
- ⭐ ricevi una recensione
- 💰 il tuo saldo/wallet viene aggiornato

## ⚠️ Avviso importante

Vinted **non ha un'API pubblica** per ordini, vendite e wallet. Questo bot usa
un endpoint interno (`/api/v2/inbox/notifications`) usato dal sito stesso per
la campanella delle notifiche, individuato per via indiretta: non è
documentato ufficialmente e **Vinted può cambiarlo in qualsiasi momento**,
rompendo il bot. Se dopo l'avvio non ricevi notifiche o l'app va in errore:

1. Fai login su vinted.it dal browser, apri i DevTools (F12) → tab *Network*,
   filtra per `notifications` e guarda la risposta JSON reale.
2. Se il path o i nomi dei campi (`type`, `title`, `body`, `url`) sono
   diversi, aggiornali in `vinted_client.py` (costante `NOTIFICATIONS_PATH`)
   e in `vinted_events.py` (funzione `normalize`/`categorize`).

Usa questo bot solo sul tuo account, in autonomia e senza automatizzare
azioni (acquisti, messaggi, ecc.): qui viene solo **letto** un feed di
notifiche, non viene eseguita alcuna azione per tuo conto.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml
```

### 1. Crea il webhook Discord

Nel server Discord: Impostazioni canale → Integrazioni → Webhook → Crea
webhook → copia l'URL e incollalo in `config.yaml` come `webhook_url`.

### 2. Recupera i cookie di sessione Vinted

1. Fai login su https://www.vinted.it dal browser.
2. Apri i DevTools (F12) → tab *Application* (Chrome) o *Storage* (Firefox)
   → Cookies → `https://www.vinted.it`.
3. Copia i valori dei cookie `access_token_web` e `refresh_token_web` e
   incollali in `config.yaml`.

Questi cookie scadono periodicamente: se il bot segnala errori di
autenticazione ripetuti, ripeti questo passaggio.

### 3. Configura le categorie

In `config.yaml`, sotto `categories`, lascia solo gli eventi che vuoi
ricevere (`order`, `shipping`, `review`, `wallet`).

### 4. Avvia il bot

```bash
python main.py
```

Al primo avvio il bot memorizza le notifiche già esistenti senza inviarle
su Discord (per non fare spam con eventi vecchi), poi da quel momento
notifica solo i nuovi eventi, ogni `check_interval_seconds` secondi.

Per farlo girare in background su un server, usa uno strumento come
`systemd`, `tmux`/`screen`, oppure un supervisore di processi (es. `pm2`,
`supervisord`).

## Struttura del progetto

- `main.py` — loop principale
- `vinted_client.py` — sessione autenticata verso Vinted (cookie, refresh)
- `vinted_events.py` — normalizza/categorizza le notifiche grezze
- `discord_notifier.py` — invio embed al webhook Discord
- `storage.py` — persistenza degli id già notificati (evita duplicati)
- `config.example.yaml` — template di configurazione
