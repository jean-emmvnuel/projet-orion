import os
import time
import shutil
import hashlib
import datetime
import tempfile
import subprocess
from pathlib import Path
from collections import OrderedDict
from dotenv import load_dotenv

# Tentative d'import de psutil et PIL, avec fallback natif Linux si absents
try:
    import psutil
except ImportError:
    psutil = None

try:
    from PIL import ImageGrab
except ImportError:
    ImageGrab = None

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    CallbackQueryHandler,
    filters,
)
from telegram.request import HTTPXRequest

# ---------------------------------------------------------------------------
# Configuration et variables d'environnement
# ---------------------------------------------------------------------------
load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
OWNER_ID_RAW = os.getenv("OWNER_ID")
OWNER_ID = int(OWNER_ID_RAW) if OWNER_ID_RAW and OWNER_ID_RAW.isdigit() else None

# Racine confinée : toujours le répertoire personnel de l'utilisateur
RACINE = Path.home().resolve()

# Dossier de réception des fichiers envoyés via Telegram
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

# Limite stricte de fichier Telegram pour un bot public : 50 Mo
MAX_FILE_SIZE = 50 * 1024 * 1024

# Dossiers ignorés lors de la recherche récursive
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
}


# ---------------------------------------------------------------------------
# Sécurité : Contrôle d'accès et validation des chemins
# ---------------------------------------------------------------------------
def is_authorized(user_id: int) -> bool:
    """Si OWNER_ID est configuré dans le .env, seul le propriétaire est autorisé."""
    if OWNER_ID is None:
        return True
    return user_id == OWNER_ID


def safe_path(raw_path: str) -> Path:
    """
    Résout un chemin absolu ou relatif tout en vérifiant strictement
    qu'il reste confiné sous RACINE (prévention des traversées ../).
    """
    clean_str = raw_path.strip().replace("~", str(RACINE))
    path = Path(clean_str)
    if not path.is_absolute():
        path = RACINE / path
    resolved = path.resolve()
    if not resolved.is_relative_to(RACINE):
        raise PermissionError("Accès refusé en dehors de votre dossier personnel.")
    return resolved


# ---------------------------------------------------------------------------
# Cache LRU des chemins pour respecter les 64 octets de callback_data Telegram
# ---------------------------------------------------------------------------
class PathCache:
    def __init__(self, maxsize=2000):
        self.maxsize = maxsize
        self._map = OrderedDict()

    def get_id(self, path: Path) -> str:
        p_str = str(path.resolve())
        pid = hashlib.md5(p_str.encode("utf-8")).hexdigest()[:12]
        self._map[pid] = Path(p_str)
        self._map.move_to_end(pid)
        if len(self._map) > self.maxsize:
            self._map.popitem(last=False)
        return pid

    def get_path(self, pid: str) -> Path | None:
        return self._map.get(pid)


path_cache = PathCache()


# ---------------------------------------------------------------------------
# Commandes : Accueil & Aide
# ---------------------------------------------------------------------------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    texte = (
        "👋 **Bonjour ! Je suis ORION (V0.5 Messager)**\n\n"
        "Votre assistant personnel pour explorer, piloter et transférer vos fichiers à distance.\n\n"
        "Tapez /help pour consulter toutes les commandes disponibles ou /ls pour explorer vos fichiers."
    )
    await update.message.reply_text(texte, parse_mode="Markdown")


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    texte = (
        "📋 **Commandes ORION V0.5 disponibles :**\n\n"
        "🔹 `/ls [dossier]` — Explorer les dossiers avec des boutons interactifs\n"
        "🔹 `/find <motif>` — Rechercher rapidement un fichier par son nom\n"
        "🔹 `/get <chemin>` — Télécharger un fichier spécifique (< 50 Mo)\n"
        "🔹 `/status` — État du PC (CPU, RAM, Disque, Durée de démarrage)\n"
        "🔹 `/screenshot` ou `/shot` — Capture d'écran distante (avec confirmation préalable)\n\n"
        f"📎 **Envoi de fichiers :**\n"
        f"Tout document ou photo envoyé dans cette discussion est automatiquement enregistré dans `{INBOX}`."
    )
    await update.message.reply_text(texte, parse_mode="Markdown")


# ---------------------------------------------------------------------------
# Commande /ls : Explorateur de fichiers interactif
# ---------------------------------------------------------------------------
def tri_fichiers(p: Path):
    is_dir = p.is_dir()
    is_hidden = p.name.startswith(".")
    return (0 if is_dir else 1, 1 if is_hidden else 0, p.name.lower())


async def show_directory(update_or_query, dossier: Path) -> None:
    try:
        dossier = safe_path(str(dossier))
    except PermissionError:
        dossier = RACINE

    try:
        items = sorted(dossier.iterdir(), key=tri_fichiers)
    except PermissionError:
        msg = f"⛔ Permission refusée pour le dossier : `{dossier.name}`"
        if hasattr(update_or_query, "message"):
            await update_or_query.message.reply_text(msg, parse_mode="Markdown")
        else:
            await update_or_query.edit_message_text(msg, parse_mode="Markdown")
        return

    clavier = []
    MAX_ITEMS = 30
    for item in items[:MAX_ITEMS]:
        pid = path_cache.get_id(item)
        if item.is_dir():
            clavier.append([InlineKeyboardButton(f"📁 {item.name}", callback_data=f"nav:{pid}")])
        else:
            clavier.append([InlineKeyboardButton(f"📄 {item.name}", callback_data=f"get:{pid}")])

    # Bouton retour vers dossier parent si pas à la racine
    if dossier != RACINE:
        parent_pid = path_cache.get_id(dossier.parent)
        clavier.append([InlineKeyboardButton("⬅️ Dossier parent", callback_data=f"nav:{parent_pid}")])

    markup = InlineKeyboardMarkup(clavier)
    texte = f"📂 **Dossier :** `{dossier}`\n_Cliquez sur un sous-dossier ou un fichier à télécharger :_"

    if hasattr(update_or_query, "edit_message_text"):
        await update_or_query.edit_message_text(texte, reply_markup=markup, parse_mode="Markdown")
    else:
        await update_or_query.message.reply_text(texte, reply_markup=markup, parse_mode="Markdown")


async def ls(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    if context.args:
        raw_arg = " ".join(context.args)
        try:
            chemin = safe_path(raw_arg)
        except Exception as e:
            await update.message.reply_text(f"⛔ {e}")
            return
    else:
        chemin = RACINE

    if not chemin.is_dir():
        await update.message.reply_text(f"❌ Ce chemin n'est pas un dossier : `{chemin}`", parse_mode="Markdown")
        return

    await show_directory(update, chemin)


# ---------------------------------------------------------------------------
# Commande /find : Recherche rapide par nom
# ---------------------------------------------------------------------------
async def find_file(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    if not context.args:
        await update.message.reply_text("💡 Usage : `/find <motif>` (ex: `/find facture` ou `/find .pdf`)", parse_mode="Markdown")
        return

    query = " ".join(context.args).strip().lower()
    msg_search = await update.message.reply_text(f"🔍 Recherche de `{query}` en cours...", parse_mode="Markdown")

    resultats = []
    MAX_RESULTS = 15

    # Parcours récursif limité et sécurisé
    for root, dirs, files in os.walk(RACINE):
        # Exclure les dossiers lourds ou cachés
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]

        for f in files:
            if query in f.lower():
                full_path = Path(root) / f
                resultats.append(full_path)
                if len(resultats) >= MAX_RESULTS:
                    break
        if len(resultats) >= MAX_RESULTS:
            break

    if not resultats:
        await msg_search.edit_text(f"❌ Aucun fichier trouvé correspondant à `{query}`.", parse_mode="Markdown")
        return

    clavier = []
    for f in resultats:
        pid = path_cache.get_id(f)
        # Afficher le nom et le dossier parent pour le contexte
        rel_parent = f.parent.name
        label = f"📄 {f.name} ({rel_parent})"
        clavier.append([InlineKeyboardButton(label[:60], callback_data=f"get:{pid}")])

    await msg_search.edit_text(
        f"🎯 **{len(resultats)} résultat(s) pour `{query}` :**\n_Cliquez pour télécharger directement :_",
        reply_markup=InlineKeyboardMarkup(clavier),
        parse_mode="Markdown",
    )


# ---------------------------------------------------------------------------
# Commande /get : Téléchargement direct d'un fichier (< 50 Mo)
# ---------------------------------------------------------------------------
async def get_file(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    if not context.args:
        await update.message.reply_text("💡 Usage : `/get <chemin_ou_nom>` (ex: `/get Documents/cv.pdf`)", parse_mode="Markdown")
        return

    raw_path = " ".join(context.args)
    try:
        fichier = safe_path(raw_path)
    except Exception as e:
        await update.message.reply_text(f"⛔ {e}")
        return

    if not fichier.is_file():
        await update.message.reply_text(f"❌ Fichier introuvable : `{fichier}`", parse_mode="Markdown")
        return

    taille = fichier.stat().st_size
    if taille > MAX_FILE_SIZE:
        mo = taille / (1024 * 1024)
        await update.message.reply_text(
            f"⚠️ Fichier trop volumineux pour Telegram (> 50 Mo).\nTaille : `{mo:.1f} Mo`.",
            parse_mode="Markdown",
        )
        return

    msg_status = await update.message.reply_text(f"⏳ Envoi de `{fichier.name}` en cours...", parse_mode="Markdown")
    try:
        with open(fichier, "rb") as f:
            await update.message.reply_document(document=f, filename=fichier.name)
        await msg_status.delete()
    except Exception as e:
        await msg_status.edit_text(f"❌ Erreur lors de l'envoi : {e}")


# ---------------------------------------------------------------------------
# Commande /status : Télémétrie et état du PC
# ---------------------------------------------------------------------------
async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    # Uptime
    try:
        with open("/proc/uptime", "r") as f:
            uptime_sec = int(float(f.readline().split()[0]))
            uptime_str = str(datetime.timedelta(seconds=uptime_sec))
    except Exception:
        uptime_str = "Indisponible"

    # CPU
    if psutil:
        cpu_str = f"`{psutil.cpu_percent(interval=0.2)}%`"
    else:
        try:
            with open("/proc/loadavg", "r") as f:
                l1, l5, _ = f.read().split()[:2]
                cpu_str = f"Charge `{l1}` (1m), `{l5}` (5m)"
        except Exception:
            cpu_str = "Indisponible"

    # RAM
    if psutil:
        ram = psutil.virtual_memory()
        ram_used = ram.used / (1024**3)
        ram_total = ram.total / (1024**3)
        ram_str = f"`{ram_used:.1f} / {ram_total:.1f} Go` (`{ram.percent}%`)"
    else:
        try:
            mem = {}
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    p = line.split(":")
                    if len(p) == 2:
                        mem[p[0].strip()] = int(p[1].split()[0])
            total_kb = mem.get("MemTotal", 1)
            avail_kb = mem.get("MemAvailable", 0)
            used_kb = total_kb - avail_kb
            ram_pct = int(used_kb / total_kb * 100)
            ram_str = f"`{used_kb / (1024**2):.1f} / {total_kb / (1024**2):.1f} Go` (`{ram_pct}%`)"
        except Exception:
            ram_str = "Indisponible"

    # Disque
    disk = shutil.disk_usage(RACINE)
    disk_used = (disk.total - disk.free) / (1024**3)
    disk_total = disk.total / (1024**3)
    disk_free = disk.free / (1024**3)
    disk_pct = int((disk.total - disk.free) / disk.total * 100)

    texte = (
        "📊 **État du système — ORION PC**\n\n"
        f"⚡ **CPU :** {cpu_str}\n"
        f"🧠 **RAM :** {ram_str}\n"
        f"💾 **Disque :** `{disk_used:.1f} / {disk_total:.1f} Go` (`{disk_pct}%` - Libre : `{disk_free:.1f} Go`)\n"
        f"⏱️ **Actif depuis :** `{uptime_str}`\n"
        f"📁 **Racine autorisée :** `{RACINE}`\n"
        f"📥 **Boîte de réception :** `{INBOX}`"
    )
    await update.message.reply_text(texte, parse_mode="Markdown")


# ---------------------------------------------------------------------------
# Commande /screenshot : Capture d'écran distante avec confirmation
# ---------------------------------------------------------------------------
async def screenshot_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    clavier = [
        [
            InlineKeyboardButton("📸 Confirmer la capture", callback_data="screen:snap"),
            InlineKeyboardButton("❌ Annuler", callback_data="screen:cancel"),
        ]
    ]
    texte = (
        "📸 **Capture d'écran distante**\n\n"
        "Confirmez-vous la prise de capture d'écran de l'affichage de votre PC ?"
    )
    await update.message.reply_text(texte, reply_markup=InlineKeyboardMarkup(clavier), parse_mode="Markdown")


def get_desktop_env() -> dict:
    """Prépare un dictionnaire d'environnement enrichi pour accéder à la session graphique active."""
    env = os.environ.copy()
    uid = os.getuid()
    user_run = f"/run/user/{uid}"

    if "DBUS_SESSION_BUS_ADDRESS" not in env or not env["DBUS_SESSION_BUS_ADDRESS"]:
        bus_file = f"{user_run}/bus"
        if os.path.exists(bus_file):
            env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus_file}"

    if "XDG_RUNTIME_DIR" not in env or not env["XDG_RUNTIME_DIR"]:
        if os.path.exists(user_run):
            env["XDG_RUNTIME_DIR"] = user_run

    if "WAYLAND_DISPLAY" not in env or not env["WAYLAND_DISPLAY"]:
        if os.path.exists(f"{user_run}/wayland-0"):
            env["WAYLAND_DISPLAY"] = "wayland-0"

    if "DISPLAY" not in env or not env["DISPLAY"]:
        env["DISPLAY"] = ":0"

    return env


def capture_ecran_locale() -> Path:
    """
    Capture l'écran du PC sous Linux avec détection multi-méthodes :
    1. GNOME Shell D-Bus (natif Ubuntu / GNOME Wayland & X11)
    2. Flameshot (CLI Wayland / X11)
    3. grim (standard Wayland wlroots)
    4. gnome-screenshot / scrot / import
    5. Pillow ImageGrab (X11 fallback)
    """
    fd, tmp_file = tempfile.mkstemp(suffix=".png", prefix="orion_screen_")
    os.close(fd)
    tmp_path = Path(tmp_file)
    env = get_desktop_env()
    erreurs = []

    # 1. GNOME Shell D-Bus (Inclus par défaut sur Ubuntu / GNOME, fonctionne en natif Wayland)
    try:
        res = subprocess.run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.gnome.Shell.Screenshot",
                "--object-path",
                "/org/gnome/Shell/Screenshot",
                "--method",
                "org.gnome.Shell.Screenshot.Screenshot",
                "false",
                "false",
                str(tmp_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=8,
            env=env,
        )
        if res.returncode == 0 and tmp_path.exists() and tmp_path.stat().st_size > 0:
            return tmp_path
        if res.stderr:
            erreurs.append(f"GNOME D-Bus: {res.stderr.strip()[:60]}")
    except Exception as e:
        erreurs.append(f"GNOME D-Bus: {e}")

    # 2. Flameshot (installé sur Ubuntu)
    try:
        res = subprocess.run(
            ["flameshot", "full", "-p", str(tmp_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=8,
            env=env,
        )
        time.sleep(0.5)
        if tmp_path.exists() and tmp_path.stat().st_size > 0:
            return tmp_path
    except Exception as e:
        erreurs.append(f"Flameshot: {e}")

    # 3. grim (standard Wayland Sway / Hyprland)
    try:
        subprocess.run(
            ["grim", str(tmp_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            env=env,
        )
        if tmp_path.exists() and tmp_path.stat().st_size > 0:
            return tmp_path
    except Exception as e:
        erreurs.append(f"grim: {e}")

    # 4. Utilitaires X11 / GNOME classiques
    commandes_alternatives = [
        ["gnome-screenshot", "-f", str(tmp_path)],
        ["scrot", str(tmp_path)],
        ["import", "-window", "root", str(tmp_path)],
        ["spectacle", "-b", "-n", "-o", str(tmp_path)],
    ]
    for cmd in commandes_alternatives:
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, env=env)
            if tmp_path.exists() and tmp_path.stat().st_size > 0:
                return tmp_path
        except Exception:
            continue

    # 5. Pillow ImageGrab (si disponible sous X11)
    if ImageGrab:
        try:
            img = ImageGrab.grab()
            img.save(tmp_path, "PNG")
            if tmp_path.exists() and tmp_path.stat().st_size > 0:
                return tmp_path
        except Exception as e:
            erreurs.append(f"Pillow ImageGrab: {e}")

    if tmp_path.exists():
        tmp_path.unlink()

    detail_err = " ; ".join(erreurs[:2]) if erreurs else "session graphique introuvable"
    raise RuntimeError(
        f"Impossible de capturer l'écran ({detail_err}).\n"
        "💡 Astuce : Installez `gnome-screenshot` via `sudo apt install gnome-screenshot` pour une compatibilité maximale."
    )


# ---------------------------------------------------------------------------
# Réception de documents ou photos envoyés par l'utilisateur
# ---------------------------------------------------------------------------
async def receive_file(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        return

    if update.message.document:
        doc = update.message.document
        nom_fichier = doc.file_name or f"doc_{int(time.time())}"
        tg_file = await doc.get_file()
    elif update.message.photo:
        photo = update.message.photo[-1]
        nom_fichier = f"photo_{int(time.time())}.jpg"
        tg_file = await photo.get_file()
    else:
        return

    dest = INBOX / nom_fichier
    # Éviter d'écraser un fichier existant du même nom
    if dest.exists():
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = INBOX / f"{dest.stem}_{timestamp}{dest.suffix}"

    msg_dl = await update.message.reply_text(f"⏳ Téléchargement de `{nom_fichier}` vers le PC...", parse_mode="Markdown")
    await tg_file.download_to_drive(custom_path=str(dest))
    await msg_dl.edit_text(f"✅ **Fichier enregistré avec succès :**\n`{dest}`", parse_mode="Markdown")


# ---------------------------------------------------------------------------
# Gestionnaire des boutons interactifs (Inline Keyboards)
# ---------------------------------------------------------------------------
async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not is_authorized(query.from_user.id):
        await query.answer("Accès non autorisé.", show_alert=True)
        return

    await query.answer()
    data = query.data
    action, _, extra = data.partition(":")

    if action == "screen":
        if extra == "cancel":
            await query.edit_message_text("❌ Capture d'écran annulée.")
        elif extra == "snap":
            await query.edit_message_text("⏳ Capture en cours...")
            screen_path = None
            try:
                screen_path = capture_ecran_locale()
                # Tenter l'envoi en photo, puis en document si photo échoue
                try:
                    with open(screen_path, "rb") as f:
                        await query.message.reply_photo(
                            photo=f,
                            caption=f"📸 **Capture d'écran PC** ({datetime.datetime.now().strftime('%H:%M:%S')})",
                            parse_mode="Markdown",
                        )
                except Exception:
                    with open(screen_path, "rb") as f:
                        await query.message.reply_document(
                            document=f,
                            filename="screenshot.png",
                            caption=f"📸 **Capture d'écran PC** ({datetime.datetime.now().strftime('%H:%M:%S')})",
                            parse_mode="Markdown",
                        )
                await query.edit_message_text("✅ Capture d'écran envoyée !")
            except Exception as e:
                print(f"⚠️ Erreur capture d'écran : {e}")
                await query.edit_message_text(f"❌ Échec de la capture d'écran :\n{e}")
            finally:
                if screen_path and screen_path.exists():
                    screen_path.unlink()
        return

    # Actions liées à la navigation de fichiers (nav / get)
    path = path_cache.get_path(extra)
    if not path:
        await query.edit_message_text("⚠️ Session expirée. Veuillez relancer la commande /ls ou /find.")
        return

    try:
        path = safe_path(str(path))
    except PermissionError:
        path = RACINE

    if action == "nav":
        await show_directory(query, path)

    elif action == "get":
        if not path.is_file():
            await query.edit_message_text(f"❌ Fichier introuvable : `{path.name}`", parse_mode="Markdown")
            return

        taille = path.stat().st_size
        if taille > MAX_FILE_SIZE:
            mo = taille / (1024 * 1024)
            await query.edit_message_text(
                f"⚠️ Fichier trop volumineux pour Telegram (> 50 Mo).\nTaille : `{mo:.1f} Mo`.",
                parse_mode="Markdown",
            )
            return

        try:
            with open(path, "rb") as f:
                await query.message.reply_document(document=f, filename=path.name)
            await query.edit_message_text(f"✅ **Fichier envoyé :** `{path.name}`", parse_mode="Markdown")
        except Exception as e:
            await query.edit_message_text(f"❌ Erreur lors de l'envoi : {e}")


# ---------------------------------------------------------------------------
# Gestionnaire d'erreurs global
# ---------------------------------------------------------------------------
async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    print(f"⚠️ Erreur interceptée : {context.error}")


# ---------------------------------------------------------------------------
# Enregistrement des commandes dans le menu officiel Telegram
# ---------------------------------------------------------------------------
async def post_init(application: Application) -> None:
    commandes = [
        BotCommand("start", "Démarrer le bot et afficher l'accueil"),
        BotCommand("help", "Afficher la liste des commandes"),
        BotCommand("ls", "Parcourir les dossiers et fichiers"),
        BotCommand("find", "Chercher un fichier par son nom"),
        BotCommand("get", "Télécharger un fichier (< 50 Mo)"),
        BotCommand("status", "Afficher l'état du PC (CPU, RAM, Disque, Uptime)"),
        BotCommand("screenshot", "Prendre une capture d'écran du PC"),
    ]
    await application.bot.set_my_commands(commandes)


# ---------------------------------------------------------------------------
# Point d'entrée principal
# ---------------------------------------------------------------------------
def main() -> None:
    if not TOKEN:
        print("❌ Erreur : BOT_TOKEN introuvable. Veuillez renseigner le fichier Bot/.env.")
        return

    req = HTTPXRequest(connect_timeout=25.0, read_timeout=25.0)
    app = (
        Application.builder()
        .token(TOKEN)
        .request(req)
        .get_updates_request(req)
        .post_init(post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler(["help", "menu"], help_command))
    app.add_handler(CommandHandler("ls", ls))
    app.add_handler(CommandHandler("find", find_file))
    app.add_handler(CommandHandler(["get", "getfile"], get_file))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler(["screenshot", "shot"], screenshot_command))
    app.add_handler(MessageHandler(filters.Document.ALL | filters.PHOTO, receive_file))
    app.add_handler(CallbackQueryHandler(button_callback))
    app.add_error_handler(error_handler)

    print("🚀 ORION Bot (V0.5) démarré avec succès !")
    print(f"📁 Racine autorisée : {RACINE}")
    print(f"📥 Dossier de réception : {INBOX}")
    if OWNER_ID:
        print(f"🔒 Mode sécurisé : restreint à l'utilisateur ID {OWNER_ID}")
    else:
        print("ℹ️ Mode ouvert : aucun OWNER_ID défini dans .env")

    app.run_polling()


if __name__ == "__main__":
    main()
