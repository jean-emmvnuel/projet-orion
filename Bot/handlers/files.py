import asyncio
import datetime
import time
from pathlib import Path
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from config import RACINE, INBOX, MAX_FILE_SIZE
from security import is_authorized, safe_path, path_cache
from services.files import list_directory, search_files, create_zip_archive


async def show_directory(update_or_query, dossier: Path) -> None:
    """Affiche le contenu d'un dossier sous forme de boutons interactifs."""
    try:
        dossier = safe_path(str(dossier))
    except PermissionError:
        dossier = RACINE

    try:
        items, has_more = list_directory(dossier, max_items=30)
    except PermissionError as e:
        msg = f"⛔ {e}"
        if hasattr(update_or_query, "message"):
            await update_or_query.message.reply_text(msg, parse_mode="Markdown")
        else:
            await update_or_query.edit_message_text(msg, parse_mode="Markdown")
        return

    clavier = []
    for item in items:
        pid = path_cache.get_id(item)
        if item.is_dir():
            clavier.append([InlineKeyboardButton(f"📁 {item.name}", callback_data=f"nav:{pid}")])
        else:
            clavier.append([InlineKeyboardButton(f"📄 {item.name}", callback_data=f"get:{pid}")])

    # Boutons d'action : zipper le dossier actuel et remonter au parent
    actions = []
    dossier_pid = path_cache.get_id(dossier)
    if dossier != RACINE:
        parent_pid = path_cache.get_id(dossier.parent)
        actions.append(InlineKeyboardButton("⬅️ Dossier parent", callback_data=f"nav:{parent_pid}"))

    actions.append(InlineKeyboardButton("📦 Zipper ce dossier", callback_data=f"zip:{dossier_pid}"))
    clavier.append(actions)

    plus_indication = "\n_(30 premiers éléments affichés)_" if has_more else ""
    texte = f"📂 **Dossier :** `{dossier}`{plus_indication}\n_Cliquez pour explorer ou télécharger :_"

    markup = InlineKeyboardMarkup(clavier)
    if hasattr(update_or_query, "edit_message_text"):
        await update_or_query.edit_message_text(texte, reply_markup=markup, parse_mode="Markdown")
    else:
        await update_or_query.message.reply_text(texte, reply_markup=markup, parse_mode="Markdown")


async def ls_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Explorateur de fichiers interactif."""
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


async def find_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Recherche rapide et sécurisée par motif dans les noms de fichiers."""
    if not is_authorized(update.effective_user.id):
        return

    if not context.args:
        await update.message.reply_text("💡 Usage : `/find <motif>` (ex: `/find facture` ou `/find .pdf`)", parse_mode="Markdown")
        return

    query = " ".join(context.args).strip()
    msg_search = await update.message.reply_text(f"🔍 Recherche de `{query}` en cours...", parse_mode="Markdown")

    resultats = await asyncio.to_thread(search_files, query, RACINE)

    if not resultats:
        await msg_search.edit_text(f"❌ Aucun fichier trouvé pour `{query}`.", parse_mode="Markdown")
        return

    clavier = []
    for f in resultats:
        pid = path_cache.get_id(f)
        label = f"📄 {f.name} ({f.parent.name})"
        clavier.append([InlineKeyboardButton(label[:60], callback_data=f"get:{pid}")])

    await msg_search.edit_text(
        f"🎯 **{len(resultats)} résultat(s) pour `{query}` :**\n_Cliquez pour télécharger directement :_",
        reply_markup=InlineKeyboardMarkup(clavier),
        parse_mode="Markdown",
    )


async def get_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Téléchargement direct d'un fichier (< 50 Mo)."""
    if not is_authorized(update.effective_user.id):
        return

    if not context.args:
        await update.message.reply_text("💡 Usage : `/get <chemin>` (ex: `/get Documents/cv.pdf`)", parse_mode="Markdown")
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
        await update.message.reply_text(f"⚠️ Fichier trop volumineux (> 50 Mo) : `{mo:.1f} Mo`.", parse_mode="Markdown")
        return

    msg_status = await update.message.reply_text(f"⏳ Envoi de `{fichier.name}`...", parse_mode="Markdown")
    try:
        with open(fichier, "rb") as f:
            await update.message.reply_document(document=f, filename=fichier.name)
        await msg_status.delete()
    except Exception as e:
        await msg_status.edit_text(f"❌ Erreur lors de l'envoi : {e}")


async def traiter_envoi_zip(message, dossier: Path) -> None:
    """Compresse et expédie un dossier sous forme d'archive zip."""
    msg_status = await message.reply_text(f"⏳ Compression de `{dossier.name}` en cours...", parse_mode="Markdown")
    zip_path = None
    try:
        zip_path = await asyncio.to_thread(create_zip_archive, dossier)
        taille = zip_path.stat().st_size
        taille_mo = taille / (1024 * 1024)

        if taille > MAX_FILE_SIZE:
            await msg_status.edit_text(
                f"⚠️ L'archive zip dépasse la limite de 50 Mo (`{taille_mo:.1f} Mo`).\n"
                "💡 Veuillez choisir un sous-dossier plus ciblé.",
                parse_mode="Markdown",
            )
            return

        with open(zip_path, "rb") as f:
            await message.reply_document(
                document=f,
                filename=f"{dossier.name}.zip",
                caption=f"📦 **Archive zip :** `{dossier.name}.zip` (`{taille_mo:.1f} Mo`)",
                parse_mode="Markdown",
            )
        await msg_status.delete()
    except ValueError as ve:
        await msg_status.edit_text(f"⚠️ {ve}", parse_mode="Markdown")
    except Exception as e:
        await msg_status.edit_text(f"❌ Erreur lors de la compression : {e}")
    finally:
        if zip_path and zip_path.exists():
            zip_path.unlink()


async def zip_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Commande /zip : Compression et envoi d'un dossier."""
    if not is_authorized(update.effective_user.id):
        return

    if not context.args:
        await update.message.reply_text("💡 Usage : `/zip <chemin_dossier>` (ex: `/zip Documents/Projet`)", parse_mode="Markdown")
        return

    raw_path = " ".join(context.args)
    try:
        dossier = safe_path(raw_path)
    except Exception as e:
        await update.message.reply_text(f"⛔ {e}")
        return

    if not dossier.is_dir():
        await update.message.reply_text(f"❌ Ce chemin n'est pas un dossier valide : `{dossier}`", parse_mode="Markdown")
        return

    if dossier == RACINE:
        await update.message.reply_text("⛔ Impossible de zipper tout votre répertoire personnel. Choisissez un sous-dossier.", parse_mode="Markdown")
        return

    await traiter_envoi_zip(update.message, dossier)


async def receive_file(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Enregistre automatiquement tout fichier ou photo reçu dans INBOX."""
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
    if dest.exists():
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = INBOX / f"{dest.stem}_{timestamp}{dest.suffix}"

    msg_dl = await update.message.reply_text(f"⏳ Téléchargement de `{nom_fichier}` vers le PC...", parse_mode="Markdown")
    await tg_file.download_to_drive(custom_path=str(dest))
    await msg_dl.edit_text(f"✅ **Fichier enregistré avec succès :**\n`{dest}`", parse_mode="Markdown")
