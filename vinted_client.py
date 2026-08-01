import hashlib
import json
import logging
import os

import requests

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Endpoint interno (non documentato) che il sito Vinted usa per popolare la
# campanella delle notifiche. Vinted puo' cambiarlo senza preavviso: vedi il
# README per come ricavare quello aggiornato dai DevTools del browser.
NOTIFICATIONS_PATH = "/api/v2/inbox/notifications"
REFRESH_PATH = "/web/api/v2/refresh_session"

COOKIE_NAMES = ("access_token_web", "refresh_token_web")


class VintedAuthError(Exception):
    pass


class VintedClient:
    """Client autenticato verso l'account Vinted dell'utente.

    I cookie di partenza arrivano dalla configurazione. Vinted pero' ruota i
    token a ogni refresh, quindi i cookie aggiornati vengono salvati su disco
    (`session_path`) e riusati all'avvio successivo: senza questo, in un
    ambiente effimero come GitHub Actions la sessione morirebbe dopo il primo
    rinnovo.
    """

    def __init__(
        self,
        domain: str,
        access_token_web: str,
        refresh_token_web: str,
        session_path: str | None = None,
    ):
        self.domain = domain
        self.base_url = f"https://{domain}"
        self.session_path = session_path
        # Impronta dei cookie da config: se cambiano (l'utente ha incollato
        # cookie nuovi), lo stato salvato va buttato perche' obsoleto.
        self._config_fingerprint = hashlib.sha256(refresh_token_web.encode()).hexdigest()

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/plain, */*",
            }
        )

        cookies = self._load_saved_cookies() or {
            "access_token_web": access_token_web,
            "refresh_token_web": refresh_token_web,
        }
        self._set_cookies(cookies)

    def _set_cookies(self, cookies: dict):
        for name, value in cookies.items():
            if value:
                self.session.cookies.set(name, value, domain=self.domain)

    def _load_saved_cookies(self) -> dict | None:
        if not self.session_path or not os.path.exists(self.session_path):
            return None

        try:
            with open(self.session_path, "r", encoding="utf-8") as f:
                state = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Stato sessione illeggibile (%s), uso i cookie del config.", exc)
            return None

        if state.get("fingerprint") != self._config_fingerprint:
            logger.info("I cookie in configurazione sono cambiati: ignoro lo stato salvato.")
            return None

        logger.info("Riuso i cookie di sessione salvati dall'esecuzione precedente.")
        return state.get("cookies", {})

    def _save_cookies(self):
        if not self.session_path:
            return

        cookies = {name: self.session.cookies.get(name) for name in COOKIE_NAMES}
        state = {"fingerprint": self._config_fingerprint, "cookies": cookies}
        try:
            with open(self.session_path, "w", encoding="utf-8") as f:
                json.dump(state, f)
            os.chmod(self.session_path, 0o600)
        except OSError as exc:
            logger.warning("Impossibile salvare lo stato sessione: %s", exc)

    def _refresh_session(self) -> bool:
        try:
            response = self.session.post(f"{self.base_url}{REFRESH_PATH}", timeout=15)
        except requests.RequestException as exc:
            logger.error("Refresh sessione Vinted fallito: %s", exc)
            return False

        if response.ok and self.session.cookies.get("access_token_web"):
            logger.info("Sessione Vinted rinnovata.")
            self._save_cookies()
            return True

        logger.error("Rinnovo sessione rifiutato da Vinted (status %s).", response.status_code)
        return False

    def get_notifications(self) -> list[dict]:
        url = f"{self.base_url}{NOTIFICATIONS_PATH}"
        response = self.session.get(url, timeout=15)

        if response.status_code in (401, 403):
            logger.info("Accesso negato, provo a rinnovare la sessione...")
            if not self._refresh_session():
                raise VintedAuthError(
                    "Cookie di sessione Vinted scaduti o non validi. Rifai il login "
                    "su vinted.it dal browser e aggiorna i secrets/config con i "
                    "nuovi access_token_web e refresh_token_web."
                )
            response = self.session.get(url, timeout=15)
            if response.status_code in (401, 403):
                raise VintedAuthError(
                    "Vinted continua a rifiutare la sessione anche dopo il rinnovo. "
                    "Aggiorna manualmente i cookie."
                )

        response.raise_for_status()

        try:
            data = response.json()
        except ValueError:
            raise VintedAuthError(
                "Vinted ha risposto con qualcosa che non e' JSON: probabilmente "
                f"l'endpoint {NOTIFICATIONS_PATH} e' cambiato. Vedi il README."
            )

        logger.debug("Risposta grezza notifiche: %s", data)
        return data.get("notifications", data.get("items", []))
