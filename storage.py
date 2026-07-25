import json
import os


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
        seen = set(self._seen_ids)
        seen.update(notification_ids)
        # Evita che il file cresca all'infinito: tiene solo le ultime 500 notifiche.
        self._seen_ids = list(seen)[-500:]
        self._save()
