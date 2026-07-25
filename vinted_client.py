import logging

import requests

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Endpoint non ufficiale/non documentato usato dal sito Vinted per popolare
# la campanella delle notifiche. Se Vinted lo cambia, aggiorna qui il path
# e/o il parsing in vinted_events.py dopo aver ispezionato le richieste del
# tuo browser (F12 -> Network, mentre navighi vinted.it da loggato).
NOTIFICATIONS_PATH = "/api/v2/inbox/notifications"


class VintedAuthError(Exception):
    pass


class VintedClient:
    """Client autenticato per l'account Vinted dell'utente, basato sui cookie
    di sessione copiati dal browser (access_token_web / refresh_token_web).
    """

    def __init__(self, domain: str, access_token_web: str, refresh_token_web: str):
        self.domain = domain
        self.base_url = f"https://{domain}"
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/plain, */*",
            }
        )
        self.session.cookies.set("access_token_web", access_token_web, domain=domain)
        self.session.cookies.set("refresh_token_web", refresh_token_web, domain=domain)

    def _refresh_session(self) -> bool:
        try:
            response = self.session.post(f"{self.base_url}/web/api/v2/refresh_session", timeout=15)
        except requests.RequestException as exc:
            logger.error("Refresh sessione Vinted fallito: %s", exc)
            return False

        if response.ok and self.session.cookies.get("access_token_web", domain=self.domain):
            logger.info("Sessione Vinted rinnovata con successo.")
            return True

        logger.error(
            "Impossibile rinnovare la sessione Vinted (status %s). "
            "I cookie salvati sono probabilmente scaduti: rifai il login sul "
            "browser e aggiorna access_token_web/refresh_token_web nel config.",
            response.status_code,
        )
        return False

    def get_notifications(self) -> list[dict]:
        url = f"{self.base_url}{NOTIFICATIONS_PATH}"
        response = self.session.get(url, timeout=15)

        if response.status_code in (401, 403):
            if not self._refresh_session():
                raise VintedAuthError("Cookie di sessione Vinted scaduti o non validi.")
            response = self.session.get(url, timeout=15)

        response.raise_for_status()
        data = response.json()
        return data.get("notifications", data.get("items", []))
