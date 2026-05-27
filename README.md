# OrderVault 🔐

**Gestione ordini futuristica** per CNFans, OopBuy, Pandabuy, Sugargoo e oltre.  
Stanze real-time, auto-fetch info prodotto da UUFinds, QC foto garantite.

## 🚀 Deploy su Vercel (CONSIGLIATO — abilita QC garantito)

1. Vai su **[vercel.com](https://vercel.com)** → Sign up / Login con GitHub
2. Clicca **Add New → Project**
3. Importa `timmyfrancesco-gif/casinoonline`
4. Seleziona il branch `claude/order-management-site-aLgtW`
5. Clicca **Deploy** → pronto in ~30 secondi

Il sito sarà live su `https://casinoonline-xxx.vercel.app` con:
- **QC garantito**: ricerca su UUFinds server-side, nessun blocco CORS
- **Image proxy**: le foto QC vengono scaricate e salvate senza problemi
- **Auto-fill completo**: nome prodotto, peso, prezzo, galleria foto

---

## Features

- 🔍 **Auto-fetch da UUFinds** — incolla link → nome + foto QC + peso automatici
- 🔐 **Stanze real-time** — codice 6 cifre, sync su tutti i dispositivi
- 🖼️ **Galleria foto** — foto QC da UUFinds o upload manuale
- 💰 **Prezzo & Peso** — traccia costo e peso stimato per ogni ordine
- 📊 **Statistiche live** — totale ordini, prezzo aggregato, peso totale
- 🌌 **Design futuristico** — stelle 3D, cursor custom, card 3D tilt

## Stack

- **Frontend**: HTML5 / CSS3 / Vanilla JS (zero npm)
- **Backend**: Vercel Edge Functions (`/api/lookup.js`, `/api/image.js`)
- **Real-time DB**: Gun.js P2P (peer.wallie.io relay)
- **Star field**: Canvas API WebGL-like (1200 stelle, shooting stars, aurora)

## Struttura

```
/
├── index.html          # SPA principale
├── style.css           # Design futuristico
├── app.js              # Logica frontend
├── vercel.json         # Config Vercel
└── api/
    ├── lookup.js       # Edge fn: cerca su UUFinds + scrape pagina
    └── image.js        # Edge fn: proxy immagini (no CORS)
```
