import argparse
import logging
import time

import yaml

import vinted_events
from discord_notifier import notify_event
from storage import SeenStore
from vinted_client import VintedAuthError, VintedClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def run_cycle(client: VintedClient, store: SeenStore, config: dict):
    domain = config["domain"]
    webhook_url = config["webhook_url"]
    enabled_categories = set(config["categories"])

    raw_notifications = client.get_notifications()
    events = [vinted_events.normalize(n) for n in raw_notifications]
    events = [e for e in events if e["id"] is not None]

    if store.is_first_run():
        logger.info(
            "Primo avvio: segno come gia' viste %d notifiche esistenti senza inviarle.",
            len(events),
        )
        store.mark_seen(e["id"] for e in events)
        return

    new_ids = set(store.filter_new([e["id"] for e in events]))
    new_events = [e for e in events if e["id"] in new_ids]

    for event in reversed(new_events):  # ordine cronologico
        if event["category"] not in enabled_categories:
            continue
        logger.info("Nuovo evento [%s]: %s", event["category"], event["title"])
        notify_event(webhook_url, event, domain)

    store.mark_seen(e["id"] for e in events)


def main():
    parser = argparse.ArgumentParser(description="Bot Discord per notifiche vendite Vinted")
    parser.add_argument("--config", default="config.yaml", help="Percorso del file di config")
    args = parser.parse_args()

    config = load_config(args.config)

    client = VintedClient(
        domain=config["domain"],
        access_token_web=config["access_token_web"],
        refresh_token_web=config["refresh_token_web"],
    )
    store = SeenStore(config.get("storage_path", "seen_items.json"))
    interval = config.get("check_interval_seconds", 60)

    logger.info("Bot avviato. Controllo ogni %s secondi su %s.", interval, config["domain"])

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
        main()
    except KeyboardInterrupt:
        logger.info("Bot interrotto dall'utente.")
