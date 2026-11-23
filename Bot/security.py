import hashlib
from collections import OrderedDict
from pathlib import Path
from config import RACINE, OWNER_ID


def is_authorized(user_id: int) -> bool:
    """Vérifie si l'utilisateur est le propriétaire légitime (si configuré)."""
    if OWNER_ID is None:
        return True
    return user_id == OWNER_ID


def safe_path(raw_path: str) -> Path:
    """
    Résout un chemin absolu ou relatif tout en vérifiant strictement
    qu'il reste confiné sous RACINE (prévention des attaques Path Traversal).
    """
    clean_str = raw_path.strip().replace("~", str(RACINE))
    path = Path(clean_str)
    if not path.is_absolute():
        path = RACINE / path
    resolved = path.resolve()
    if not resolved.is_relative_to(RACINE):
        raise PermissionError("Accès interdit en dehors de votre dossier personnel.")
    return resolved


class PathCache:
    """
    Cache LRU en O(1) associant un hash MD5 court (12 car.) à un objet Path.
    Permet de contourner la limite stricte de 64 octets imposée par Telegram sur callback_data.
    """

    def __init__(self, maxsize: int = 1000):
        self.maxsize = maxsize
        self._map: OrderedDict[str, Path] = OrderedDict()

    def get_id(self, path: Path) -> str:
        p_str = str(path.resolve())
        pid = hashlib.md5(p_str.encode("utf-8")).hexdigest()[:12]
        self._map[pid] = Path(p_str)
        self._map.move_to_end(pid)
        if len(self._map) > self.maxsize:
            self._map.popitem(last=False)
        return pid

    def get_path(self, pid: str) -> Path | None:
        path = self._map.get(pid)
        if path:
            self._map.move_to_end(pid)
        return path


# Instance globale du cache
path_cache = PathCache()
