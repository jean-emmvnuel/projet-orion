"""Configuration locale de l'agent : adresse du Core, identité et jeton de l'appareil."""

import json
import os
import platform
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path


def config_dir() -> Path:
    if platform.system() == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif platform.system() == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "orion"


CONFIG_FILE = config_dir() / "agent.json"

# Dossier personnel : toutes les opérations sur les fichiers y sont confinées.
HOME = Path.home().resolve()

# Dossier où l'agent dépose les fichiers reçus du téléphone.
INBOX = next((HOME / d / "ORION" for d in ("Téléchargements", "Downloads") if (HOME / d).exists()), HOME / "ORION")

IGNORED_DIRS = {".git", ".venv", ".env", "__pycache__", "node_modules", ".cache", ".flet", "build", ".local", "snap"}
MAX_LIST = 200
MAX_FIND_RESULTS = 100
MAX_FIND_DEPTH = 5
MAX_UPLOAD = 200 * 1024 * 1024  # 200 Mo, limite du Core
MAX_PRE_ZIP = 300 * 1024 * 1024
TELEMETRY_EVERY_S = 15


@dataclass
class AgentConfig:
    server: str
    device_id: str
    token: str
    name: str

    @staticmethod
    def load() -> "AgentConfig | None":
        try:
            return AgentConfig(**json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError):
            return None

    def save(self) -> None:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        # Le jeton donne le contrôle du PC : lisible par l'utilisateur seulement.
        try:
            os.chmod(CONFIG_FILE, 0o600)
        except OSError:
            pass

    @staticmethod
    def delete() -> None:
        CONFIG_FILE.unlink(missing_ok=True)


PREFS_FILE = config_dir() / "preferences.json"


@dataclass
class Preferences:
    """Réglages locaux, modifiés depuis l'interface graphique et lus par l'agent à chaque commande."""

    theme: str = "dark"  # dark | light | system
    disabled_actions: list[str] = field(default_factory=list)
    remote_setup_dismissed: bool = False  # « Plus tard » sur l'installation des composants de l'écran en direct
    last_server: str = ""

    @staticmethod
    def load() -> "Preferences":
        try:
            raw = json.loads(PREFS_FILE.read_text(encoding="utf-8"))
            known = {f.name for f in fields(Preferences)}
            return Preferences(**{k: v for k, v in raw.items() if k in known})
        except (OSError, ValueError, TypeError):
            return Preferences()

    def save(self) -> None:
        PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PREFS_FILE.write_text(json.dumps(asdict(self), indent=2, ensure_ascii=False), encoding="utf-8")
