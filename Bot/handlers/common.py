from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from config import RACINE, INBOX, MAX_FILE_SIZE
from security import is_authorized, safe_path, path_cache
from handlers.system import status_command, shot_command, lock_command
from handlers.files import show_directory, traiter_envoi_zip


def get_help_keyboard() -> InlineKeyboardMarkup:
    """Clavier ergonomique d'actions rapides sous le message d'aide."""
    clavier = [
        [
            InlineKeyboardButton("📊 État du PC", callback_data="cmd:status"),
            InlineKeyboardButton("📸 Capture d'écran", callback_data="cmd:shot"),
        ],
        [
            InlineKeyboardButton("📁 Parcourir (~/)", callback_data="cmd:ls"),
            InlineKeyboardButton("🔒 Verrouiller le PC", callback_data="cmd:lock"),
        ],
    ]
    return InlineKeyboardMarkup(clavier)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Message d'accueil avec actions rapides."""
    if not is_authorized(update.effective_user.id):
        return

    texte = (
        "✨ **ORION — Centre de Contrôle (V0.5 Messager)** ✨\n\n"
        "Votre passerelle personnelle sécurisée Téléphone ⇄ PC.\n"
        "Pilotez votre ordinateur, parcourez vos fichiers et surveillez vos ressources depuis n'importe où.\n\n"
        "👇 _Sélectionnez une action rapide ou tapez /help :_"
    )
    await update.message.reply_text(texte, reply_markup=get_help_keyboard(), parse_mode="Markdown")


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Affichage stylé et ergonomique du menu des commandes."""
    if not is_authorized(update.effective_user.id):
        return

    msg = update.effective_message
    texte = (
        "🌌 **ORION — Centre de Contrôle (V0.5)**\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "🗂️ **Gestion des fichiers :**\n"
        "├ `/ls [dossier]` ➔ Explorateur interactif\n"
        "├ `/find <nom>`   ➔ Recherche rapide récursive\n"
        "├ `/get <chemin>` ➔ Télécharger un fichier (< 50 Mo)\n"
        "└ `/zip <dossier>` ➔ Compresser et envoyer un dossier\n\n"
        "💻 **Pilotage & Sécurité :**\n"
        "├ `/status` ➔ Métriques (CPU, RAM, Disque, 🔋 Batterie, Uptime)\n"
        "├ `/shot`   ➔ Capture d'écran instantanée (silencieuse)\n"
        "└ `/lock`   ➔ Verrouiller immédiatement la session du PC\n\n"
        "📥 **Réception automatique :**\n"
        f"Envoyez n'importe quel fichier ou photo : il sera automatiquement sauvegardé dans `{INBOX.name}` sur le PC.\n\n"
        "⚡ _Boutons d'accès direct :_"
    )
    await msg.reply_text(texte, reply_markup=get_help_keyboard(), parse_mode="Markdown")


async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Gestionnaire centralisé des clics sur les boutons interactifs."""
    query = update.callback_query
    if not is_authorized(query.from_user.id):
        await query.answer("Accès non autorisé.", show_alert=True)
        return

    await query.answer()
    data = query.data
    action, _, extra = data.partition(":")

    # 1. Raccourcis de commandes
    if action == "cmd":
        if extra == "status":
            await status_command(update, context)
        elif extra == "shot":
            await shot_command(update, context)
        elif extra == "ls":
            await show_directory(query, RACINE)
        elif extra == "lock":
            await lock_command(update, context)
        return

    # 2. Navigation et actions de fichiers
    path = path_cache.get_path(extra)
    if not path:
        await query.edit_message_text("⚠️ Session expirée. Relancez /ls ou /find.")
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
            await query.edit_message_text(f"⚠️ Fichier trop volumineux (> 50 Mo) : `{mo:.1f} Mo`.", parse_mode="Markdown")
            return

        try:
            with open(path, "rb") as f:
                await query.message.reply_document(document=f, filename=path.name)
            await query.edit_message_text(f"✅ **Fichier envoyé :** `{path.name}`", parse_mode="Markdown")
        except Exception as e:
            await query.edit_message_text(f"❌ Erreur lors de l'envoi : {e}")

    elif action == "zip":
        if not path.is_dir():
            await query.edit_message_text(f"❌ Dossier introuvable : `{path.name}`", parse_mode="Markdown")
            return
        if path == RACINE:
            await query.edit_message_text("⛔ Impossible de zipper tout votre dossier personnel.", parse_mode="Markdown")
            return
        await traiter_envoi_zip(query.message, path)


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Journalise les exceptions sans faire crasher l'application."""
    print(f"⚠️ Erreur interceptée : {context.error}")
