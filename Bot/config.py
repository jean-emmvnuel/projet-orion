import os
from pathlib import Path
from dotenv import load_dotenv

# Chargement du fichier .env
load_dotenv()

TOKEN = os.getenv("BOT_TOKEN")
OWNER_ID_RAW = os.getenv("OWNER_ID")
OWNER_ID = int(OWNER_ID_RAW) if OWNER_ID_RAW and OWNER_ID_RAW.isdigit() else None

# Répertoire racine sécurisé (confinement de l'utilisateur)
RACINE = Path.home().resolve()

# Dossier d'enregistrement des fichiers reçus
if (RACINE / "Téléchargements").exists():
    INBOX = RACINE / "Téléchargements" / "ORION"
elif (RACINE / "Downloads").exists():
    INBOX = RACINE / "Downloads" / "ORION"
else:
    INBOX = RACINE / "reçus"

try:
    INBOX.mkdir(parents=True, exist_ok=True)
except OSError:
    pass

# Limites & plafonds de sécurité
MAX_FILE_SIZE = 50 * 1024 * 1024      # 50 Mo (Plafond strict de l'API Telegram)
MAX_PRE_ZIP_SIZE = 100 * 1024 * 1024  # 100 Mo max avant de refuser de compresser (évite les calculs inutiles)
MAX_FIND_RESULTS = 15                 # Nombre maximal de fichiers retournés par /find
MAX_FIND_DEPTH = 4                    # Profondeur max de recherche pour éviter les scans infinis
MAX_ITEMS_PER_PAGE = 30               # Éléments max affichés dans l'explorateur /ls

# Dossiers exclus de l'exploration et de la recherche
IGNORED_DIRS = {
    ".git",
    ".venv",
    ".env",
    "__pycache__",
    "node_modules",
    ".cache",
    ".flet",
    "build",
    ".local",
    "snap",
}
