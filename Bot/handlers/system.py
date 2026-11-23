import asyncio
import datetime
from telegram import Update
from telegram.ext import ContextTypes
from security import is_authorized
from services.system import get_system_metrics, lock_session
from services.screenshot import capture_screen


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Affiche les métriques système du PC hôte (CPU, RAM, Disque, Batterie, Uptime)."""
    if not is_authorized(update.effective_user.id):
        return

    m = get_system_metrics()
    bat_ligne = f"🔋 **Batterie :** {m['battery']}\n" if m["battery"] else ""

    texte = (
        "📊 **État du système — ORION PC**\n"
        "────────────────────────\n"
        f"⚡ **CPU :** {m['cpu']}\n"
        f"🧠 **RAM :** {m['ram']}\n"
        f"💾 **Disque :** {m['disk']}\n"
        f"{bat_ligne}"
        f"⏱️ **Actif depuis :** `{m['uptime']}`\n"
        "────────────────────────\n"
        f"📁 **Racine :** `{m['racine']}`\n"
        f"📥 **Boîte :** `{m['inbox']}`"
    )
    msg = update.effective_message
    await msg.reply_text(texte, parse_mode="Markdown")


async def shot_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Capture d'écran 100% silencieuse, envoyée sur Telegram puis supprimée immédiatement du PC."""
    if not is_authorized(update.effective_user.id):
        return

    msg_status = await update.message.reply_text("⏳ Capture d'écran en cours...", parse_mode="Markdown")
    screen_path = None
    try:
        screen_path = await asyncio.to_thread(capture_screen)
        date_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        caption = f"📸 **Capture d'écran PC** ({date_str})"

        try:
            with open(screen_path, "rb") as f:
                await update.message.reply_photo(photo=f, caption=caption, parse_mode="Markdown")
        except Exception:
            with open(screen_path, "rb") as f:
                await update.message.reply_document(document=f, filename="screenshot.png", caption=caption, parse_mode="Markdown")

        await msg_status.delete()
    except Exception as e:
        await msg_status.edit_text(f"❌ Échec de la capture d'écran :\n{e}")
    finally:
        # Nettoyage immédiat : ne conserve aucune capture sur le PC
        if screen_path and screen_path.exists():
            try:
                screen_path.unlink()
            except OSError:
                pass


async def lock_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Verrouille instantanément la session du PC à distance."""
    if not is_authorized(update.effective_user.id):
        return

    msg = await update.message.reply_text("🔒 Verrouillage de la session en cours...", parse_mode="Markdown")
    try:
        ok = await asyncio.to_thread(lock_session)
        if ok:
            heure = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            await msg.edit_text(
                f"🔒 **Session verrouillée avec succès.**\n_{heure}_",
                parse_mode="Markdown",
            )
        else:
            await msg.edit_text("❌ Échec du verrouillage : session graphique introuvable.")
    except Exception as e:
        await msg.edit_text(f"❌ Erreur lors du verrouillage :\n{e}")
