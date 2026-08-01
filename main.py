import argparse
import logging
import sys
import time

import vinted_events
from config import ConfigError, load_config
from discord_notifier import DiscordError, notify_event, send_test_message
from storage import SeenStore
from vinted_client import VintedAuthError, VintedClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def build_client(config: dict) -> VintedClient:
    return VintedClient(
        domain=config["domain"],
        access_token_web=config["access_token_web"],
        refresh_token_web=config["refresh_token_web"],
        session_path=config["session_path"],
    )


def run_cycle(client: VintedClient, store: SeenStore, config: dict):
    raw = client.get_notifications()
    events = [vinted_events.normalize(n) for n in raw]
    events = [e for e in events if e["id"] is not None]

    if not events:
        logger.info("Nessuna notifica restituita da Vinted.")
        return

    if store.is_first_run():
        logger.info(
            "Primo avvio: segno %d notifiche esistenti come gia' viste, senza inviarle.",
            len(events),
        )
        store.mark_seen(e["id"] for e in events)
        return

    new_ids = set(store.filter_new([e["id"] for e in events]))
    new_events = [e for e in events if e["id"] in new_ids]
    enabled = set(config["categories"])
    sent = 0

    for event in reversed(new_events):  # dal piu' vecchio al piu' recente
        if event["category"] not in enabled:
            logger.debug("Ignoro evento di categoria '%s'.", event["category"])
            continue
        logger.info("Nuovo evento [%s]: %s", event["category"], event["title"])
        notify_event(config["webhook_url"], event, config["domain"])
        sent += 1

    store.mark_seen(e["id"] for e in events)
    logger.info("Ciclo completato: %d nuove notifiche, %d inviate su Discord.", len(new_events), sent)


def run_test(config: dict) -> int:
    print("\n--- Test configurazione ---\n")

    print(f"[1/2] Connessione a {config['domain']} con i cookie forniti...")
    try:
        client = build_client(config)
        notifications = client.get_notifications()
    except VintedAuthError as exc:
        print(f"      FALLITO: {exc}\n")
        return 1
    except Exception as exc:
        print(f"      FALLITO: errore contattando Vinted: {exc}\n")
        return 1
    print(f"      OK - Vinted ha risposto ({len(notifications)} notifiche nel feed).")

    if notifications:
        categorie = {}
        for raw in notifications:
            categoria = vinted_events.categorize(raw)
            categorie[categoria] = categorie.get(categoria, 0) + 1
        riepilogo = ", ".join(f"{k}: {v}" for k, v in sorted(categorie.items()))
        print(f"      Categorie riconosciute nel feed -> {riepilogo}")
        if set(categorie) == {"other"}:
            print(
                "      ATTENZIONE: nessuna notifica e' stata riconosciuta come\n"
                "      vendita/spedizione/recensione/wallet. Il formato di Vinted\n"
                "      potrebbe essere cambiato: vedi la sezione 'Se non funziona'\n"
                "      del README."
            )

    print("\n[2/2] Invio messaggio di prova su Discord...")
    try:
        send_test_message(config["webhook_url"], config["domain"], config["categories"])
    except DiscordError as exc:
        print(f"      FALLITO: {exc}\n")
        return 1
    print("      OK - controlla il canale Discord.\n")

    print("Tutto a posto.\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Notifiche Discord per le vendite Vinted")
    parser.add_argument("--config", default="config.yaml", help="Percorso del file di config")
    parser.add_argument(
        "--once", action="store_true", help="Esegue un solo controllo ed esce (per GitHub Actions)"
    )
    parser.add_argument(
        "--test", action="store_true", help="Verifica cookie e webhook, poi esce"
    )
    args = parser.parse_args()

    try:
        config = load_config(args.config)
    except ConfigError as exc:
        logger.error("%s", exc)
        return 1

    if args.test:
        return run_test(config)

    client = build_client(config)
    store = SeenStore(config["storage_path"])

    if args.once:
        try:
            run_cycle(client, store, config)
        except VintedAuthError as exc:
            logger.error("%s", exc)
            return 1
        return 0

    interval = config["check_interval_seconds"]
    logger.info("Bot avviato: controllo ogni %s secondi su %s.", interval, config["domain"])
    while True:
        try:
            run_cycle(client, store, config)
        except VintedAuthError as exc:
            logger.error("%s Riprovo al prossimo ciclo.", exc)
        except Exception:
            logger.exception("Errore imprevisto durante il ciclo di controllo.")
        time.sleep(interval)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.info("Bot interrotto.")
