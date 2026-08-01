"""Normalizza e categorizza le notifiche grezze restituite da Vinted.

Vinted non documenta il formato di queste notifiche: il campo "type" (o, in
sua assenza, il testo) viene qui interpretato con parole chiave per capire
di che evento si tratta. Se una notifica non viene categorizzata come ti
aspetti, controlla il JSON grezzo (loggato in debug) e aggiusta le liste di
parole chiave qui sotto.
"""

CATEGORY_KEYWORDS = {
    "order": ["order_created", "sold_item", "item_sold", "venduto", "acquistato", "ordine"],
    "shipping": ["shipped", "shipment", "spedi", "consegn", "delivered", "pickup"],
    "review": ["feedback", "review", "recension"],
    "wallet": ["wallet", "balance", "payout", "saldo", "portafoglio", "guadagn"],
}


def categorize(notification: dict) -> str:
    haystack = " ".join(
        str(notification.get(field, "")) for field in ("type", "title", "body", "text")
    ).lower()

    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in haystack for keyword in keywords):
            return category
    return "other"


def normalize(notification: dict) -> dict:
    return {
        "id": notification.get("id"),
        "title": notification.get("title") or "Notifica Vinted",
        "body": notification.get("body") or notification.get("text") or "",
        "url": notification.get("url") or notification.get("link") or "",
        "category": categorize(notification),
    }
