"""Caricamento della configurazione.

Due sorgenti, in ordine di priorita':
  1. variabili d'ambiente (usate da GitHub Actions tramite i secrets)
  2. file YAML locale (comodo quando il bot gira sul tuo PC)
"""

import os

import yaml

DEFAULTS = {
    "domain": "vinted.it",
    "check_interval_seconds": 60,
    "storage_path": "seen_items.json",
    "session_path": "session_state.json",
    "categories": ["order", "shipping", "review", "wallet"],
}

ENV_MAP = {
    "VINTED_DOMAIN": "domain",
    "VINTED_ACCESS_TOKEN": "access_token_web",
    "VINTED_REFRESH_TOKEN": "refresh_token_web",
    "DISCORD_WEBHOOK_URL": "webhook_url",
}

REQUIRED = ("access_token_web", "refresh_token_web", "webhook_url")


class ConfigError(Exception):
    pass


def load_config(path: str | None = None) -> dict:
    config = dict(DEFAULTS)

    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            config.update(yaml.safe_load(f) or {})

    for env_name, key in ENV_MAP.items():
        value = os.environ.get(env_name)
        if value:
            config[key] = value.strip()

    if os.environ.get("VINTED_CATEGORIES"):
        config["categories"] = [
            c.strip() for c in os.environ["VINTED_CATEGORIES"].split(",") if c.strip()
        ]

    _validate(config)
    return config


def _validate(config: dict):
    missing = [key for key in REQUIRED if not config.get(key)]
    if missing:
        raise ConfigError(
            "Configurazione incompleta, mancano: "
            + ", ".join(missing)
            + ". Impostali come variabili d'ambiente (VINTED_ACCESS_TOKEN, "
            "VINTED_REFRESH_TOKEN, DISCORD_WEBHOOK_URL) oppure in config.yaml."
        )

    placeholders = [key for key in REQUIRED if str(config[key]).startswith(("INCOLLA_", "XXXX"))]
    if placeholders:
        raise ConfigError(
            "Questi valori sono ancora i segnaposto del file di esempio: "
            + ", ".join(placeholders)
            + ". Sostituiscili con i valori reali."
        )

    if not str(config["webhook_url"]).startswith("https://discord.com/api/webhooks/"):
        raise ConfigError(
            "webhook_url non sembra un webhook Discord valido "
            "(deve iniziare con https://discord.com/api/webhooks/)."
        )

    unknown = set(config["categories"]) - {"order", "shipping", "review", "wallet", "other"}
    if unknown:
        raise ConfigError(f"Categorie non riconosciute: {', '.join(sorted(unknown))}")
