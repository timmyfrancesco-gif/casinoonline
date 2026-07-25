import logging
import time

import requests

logger = logging.getLogger(__name__)

CATEGORY_STYLE = {
    "order": {"emoji": "🛍️", "label": "Nuova vendita", "color": 0x2ECC71},
    "shipping": {"emoji": "📦", "label": "Aggiornamento spedizione", "color": 0x3498DB},
    "review": {"emoji": "⭐", "label": "Nuova recensione", "color": 0xF1C40F},
    "wallet": {"emoji": "💰", "label": "Wallet aggiornato", "color": 0x9B59B6},
    "other": {"emoji": "🔔", "label": "Notifica Vinted", "color": 0x95A5A6},
}


def notify_event(webhook_url: str, event: dict, domain: str):
    style = CATEGORY_STYLE[event["category"]]
    url = event["url"]
    if url and url.startswith("/"):
        url = f"https://{domain}{url}"

    embed = {
        "title": f"{style['emoji']} {style['label']}: {event['title']}",
        "description": event["body"],
        "color": style["color"],
    }
    if url:
        embed["url"] = url

    payload = {"embeds": [embed]}
    response = requests.post(webhook_url, json=payload, timeout=15)

    if response.status_code == 429:
        retry_after = response.json().get("retry_after", 1)
        logger.warning("Rate limit Discord, attendo %s secondi", retry_after)
        time.sleep(retry_after)
        response = requests.post(webhook_url, json=payload, timeout=15)

    if not response.ok:
        logger.error(
            "Invio notifica Discord fallito (%s): %s", response.status_code, response.text
        )
