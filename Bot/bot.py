import os
import hashlib
from pathlib import Path
from collections import OrderedDict
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, CallbackQueryHandler, filters
from telegram.request import HTTPXRequest

# Chargement des variables d'environnement
load_dotenv()
token = os.getenv("BOT_TOKEN")

# Racine fixe : toujours le dossier utilisateur
RACINE = Path.home().resolve()


# Cache des chemins pour respecter la limite stricte de 64 octets de Telegram pour callback_data
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


# Commande /start
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    texte = (
        "👋 Bonjour ! Je suis **Orion**, votre assistant Telegram pour gérer vos fichiers à distance.\n\n"
        "Tapez /help ou /menu pour afficher toutes les commandes, ou /ls pour explorer vos fichiers."
    )
    await update.message.reply_text(texte, parse_mode="Markdown")


# Commande /help et /menu
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    texte = (
        "📋 *Menu des commandes disponibles :*\n\n"
        "🔹 /start - Démarrer le bot et afficher l'accueil\n"
        "🔹 /help ou /menu - Afficher ce menu des commandes\n"
        "🔹 /ls `[dossier]` - Explorer les dossiers et fichiers de votre PC (boutons interactifs)\n"
        "🔹 /getfile `<chemin>` - Télécharger directement un fichier depuis votre PC\n\n"
        "📎 *Envoi de fichiers / photos :*\n"
        "Envoyez simplement n'importe quel document ou photo dans cette discussion, Orion le sauvegardera automatiquement sur votre PC dans `~/reçus`."
    )
    await update.message.reply_text(texte, parse_mode="Markdown")


# Commande /getfile
async def get_file(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text("Veuillez fournir un nom ou chemin de fichier après la commande /getfile.")
        return

    arg = " ".join(context.args).lstrip("/")
    chemin_fichier = (RACINE / arg).expanduser().resolve()

    # Sécurité : interdiction de sortir du dossier utilisateur
    if not chemin_fichier.is_relative_to(RACINE):
        await update.message.reply_text("⛔ Accès refusé : Impossible d'accéder en dehors du dossier utilisateur.")
        return

    if not chemin_fichier.is_file():
        await update.message.reply_text(f"Le fichier spécifié n'existe pas : {chemin_fichier}")
        return

    try:
        with open(chemin_fichier, "rb") as fichier:
            await update.message.reply_document(document=fichier, filename=chemin_fichier.name)
    except Exception as e:
        await update.message.reply_text(f"Une erreur s'est produite lors de l'envoi du fichier : {e}")


# Sauvegarder les fichiers reçus
async def receive_file(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message.document:
        fichier = await update.message.document.get_file()
        nom_fichier = update.message.document.file_name or "fichier_recu"
    elif update.message.photo:
        fichier = await update.message.photo[-1].get_file()
        nom_fichier = "photo_recue.jpg"
    else:
        await update.message.reply_text("Veuillez envoyer un fichier ou une photo.")
        return

    # Sauvegarde dans ~/reçus
    chemin_sauvegarde = RACINE / "reçus"
    chemin_sauvegarde.mkdir(parents=True, exist_ok=True)
    chemin_fichier = chemin_sauvegarde / nom_fichier

    await fichier.download_to_drive(custom_path=str(chemin_fichier))
    await update.message.reply_text(f"Fichier reçu et sauvegardé sous : {chemin_fichier}")


# Fonction de tri : dossiers normaux d'abord, puis dossiers cachés (.), puis fichiers normaux, puis fichiers cachés (.)
def tri_fichiers(p: Path):
    is_dir = p.is_dir()
    is_hidden = p.name.startswith(".")
    return (0 if is_dir else 1, 1 if is_hidden else 0, p.name.lower())


# Afficher le contenu d'un répertoire
async def show_directory(update: Update, dossier: Path) -> None:
    # On garantit que le dossier reste dans la racine utilisateur
    if not dossier.is_relative_to(RACINE):
        dossier = RACINE

    MAX_ITEMS = 30
    try:
        items = sorted(dossier.iterdir(), key=tri_fichiers)
    except PermissionError:
        await update.message.reply_text(f"Erreur : Permission refusée pour accéder au répertoire {dossier}.")
        return

    clavier = []
    for item in items[:MAX_ITEMS]:
        pid = path_cache.get_id(item)
        if item.is_dir():
            clavier.append([InlineKeyboardButton(f"📁 {item.name}", callback_data=f"nav:{pid}")])
        else:
            clavier.append([InlineKeyboardButton(f"📄 {item.name}", callback_data=f"get:{pid}")])

    # Le bouton retour n'apparaît que si on est dans un sous-dossier de RACINE
    if dossier != RACINE and dossier.is_relative_to(RACINE):
        parent_pid = path_cache.get_id(dossier.parent)
        clavier.append([InlineKeyboardButton("🔙 ..", callback_data=f"nav:{parent_pid}")])

    reply_markup = InlineKeyboardMarkup(clavier)
    await update.message.reply_text(f"📂 Dossier : {dossier}", reply_markup=reply_markup)


# Commande /ls
async def ls(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.args:
        arg = " ".join(context.args).lstrip("/")
        chemin = (RACINE / arg).expanduser().resolve()
    else:
        chemin = RACINE

    # Sécurité : interdiction de remonter au-dessus de la racine utilisateur
    if not chemin.is_relative_to(RACINE):
        await update.message.reply_text("⛔ Accès refusé : Impossible de naviguer au-dessus du dossier utilisateur.")
        return

    if not chemin.is_dir():
        await update.message.reply_text(f"Le chemin spécifié n'est pas un répertoire valide : {chemin}")
        return

    await show_directory(update, chemin)


# Gestion des clics sur les boutons
async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    data = query.data
    action, _, pid = data.partition(":")
    path = path_cache.get_path(pid)

    if not path:
        await query.edit_message_text("⚠️ Session expirée. Veuillez relancer la commande /ls.")
        return

    # Sécurité : empêcher tout accès hors de RACINE
    if not path.is_relative_to(RACINE):
        path = RACINE

    if action == "nav":
        try:
            items = sorted(path.iterdir(), key=tri_fichiers)
        except PermissionError:
            await query.edit_message_text(f"Erreur : Permission refusée pour accéder au répertoire {path}.")
            return

        clavier = []
        for item in items[:30]:
            item_pid = path_cache.get_id(item)
            if item.is_dir():
                clavier.append([InlineKeyboardButton(f"📁 {item.name}", callback_data=f"nav:{item_pid}")])
            else:
                clavier.append([InlineKeyboardButton(f"📄 {item.name}", callback_data=f"get:{item_pid}")])

        # Afficher le bouton parent uniquement si on n'est pas déjà à la racine utilisateur
        if path != RACINE and path.is_relative_to(RACINE):
            parent_pid = path_cache.get_id(path.parent)
            clavier.append([InlineKeyboardButton("⬅️ Dossier parent", callback_data=f"nav:{parent_pid}")])

        await query.edit_message_text(f"📂 Dossier : {path}", reply_markup=InlineKeyboardMarkup(clavier))

    elif action == "get":
        if not path.is_file():
            await query.edit_message_text(f"❌ Fichier introuvable : {path.name}")
            return
        try:
            with open(path, "rb") as f:
                await query.message.reply_document(document=f, filename=path.name)
            await query.edit_message_text(f"✅ Fichier envoyé : {path.name}")
        except Exception as e:
            await query.edit_message_text(f"❌ Erreur d'envoi : {e}")


# Gestionnaire d'erreurs global
async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    print(f"⚠️ Erreur interceptée : {context.error}")


# Configuration du menu officiel des commandes Telegram
async def post_init(application: Application) -> None:
    commandes = [
        BotCommand("start", "Démarrer le bot"),
        BotCommand("menu", "Afficher la liste des commandes"),
        BotCommand("help", "Afficher l'aide"),
        BotCommand("ls", "Parcourir les fichiers et dossiers"),
        BotCommand("getfile", "Télécharger un fichier spécifique"),
    ]
    await application.bot.set_my_commands(commandes)


def main() -> None:
    req = HTTPXRequest(connect_timeout=20.0, read_timeout=20.0)
    app = (
        Application.builder()
        .token(token)
        .request(req)
        .get_updates_request(req)
        .post_init(post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler(["help", "menu"], help_command))
    app.add_handler(CommandHandler("getfile", get_file))
    app.add_handler(CommandHandler("ls", ls))
    app.add_handler(MessageHandler(filters.Document.ALL | filters.PHOTO, receive_file))
    app.add_handler(CallbackQueryHandler(button_callback))
    app.add_error_handler(error_handler)

    print("Bot démarré...")
    app.run_polling()


if __name__ == "__main__":
    main()
