import json
import os

MAX_SEEN_IDS = 500


class SeenStore:
    """Persiste su disco gli id delle notifiche Vinted gia' inoltrate a Discord."""

    def __init__(self, path: str):
        self.path = path
        self._seen_ids: list = []
        self._load()

    def _load(self):
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as f:
                self._seen_ids = json.load(f)

    def _save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self._seen_ids, f)

    def is_first_run(self) -> bool:
        return not self._seen_ids

    def filter_new(self, notification_ids: list) -> list:
        seen = set(self._seen_ids)
        return [nid for nid in notification_ids if nid not in seen]

    def mark_seen(self, notification_ids):
        # L'ordine di inserimento va preservato: il troncamento qui sotto deve
        # scartare gli id piu' vecchi, mai quelli recenti. Un id recente buttato
        # via tornerebbe a sembrare nuovo al giro dopo (notifica duplicata).
        seen = set(self._seen_ids)
        for notification_id in notification_ids:
            if notification_id not in seen:
                seen.add(notification_id)
                self._seen_ids.append(notification_id)

        # Evita che il file cresca all'infinito: tiene solo gli ultimi 500 id.
        self._seen_ids = self._seen_ids[-MAX_SEEN_IDS:]
        self._save()
