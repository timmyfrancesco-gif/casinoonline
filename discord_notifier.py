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


class DiscordError(Exception):
    pass


def _post(webhook_url: str, payload: dict):
    response = requests.post(webhook_url, json=payload, timeout=15)

    if response.status_code == 429:
        retry_after = response.json().get("retry_after", 1)
        logger.warning("Rate limit Discord, attendo %s secondi.", retry_after)
        time.sleep(retry_after)
        response = requests.post(webhook_url, json=payload, timeout=15)

    if not response.ok:
        raise DiscordError(f"Discord ha risposto {response.status_code}: {response.text}")


def notify_event(webhook_url: str, event: dict, domain: str):
    style = CATEGORY_STYLE.get(event["category"], CATEGORY_STYLE["other"])

    url = event["url"]
    if url and url.startswith("/"):
        url = f"https://{domain}{url}"

    embed = {
        "title": f"{style['emoji']} {style['label']}",
        "description": f"**{event['title']}**\n{event['body']}".strip(),
        "color": style["color"],
    }
    if url:
        embed["url"] = url

    _post(webhook_url, {"embeds": [embed]})


def send_test_message(webhook_url: str, domain: str, categories: list[str]):
    attive = ", ".join(
        f"{CATEGORY_STYLE[c]['emoji']} {CATEGORY_STYLE[c]['label']}"
        for c in categories
        if c in CATEGORY_STYLE
    )
    embed = {
        "title": "✅ Bot Vinted collegato",
        "description": (
            "Se leggi questo messaggio, il webhook funziona.\n\n"
            f"**Account monitorato su:** {domain}\n"
            f"**Notifiche attive:** {attive}"
        ),
        "color": 0x2ECC71,
    }
    _post(webhook_url, {"embeds": [embed]})
