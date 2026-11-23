#!/usr/bin/env python3
"""
ORION Bot — Point d'entrée principal (V0.5 Messager)
Architecture modulaire :
- config.py           : Paramètres, chemins et plafonds de sécurité
- security.py         : Confinement safe_path, vérification d'accès et PathCache O(1)
- services/           : Logique système, capture d'écran et manipulation de fichiers
- handlers/           : Gestionnaires d'événements et de commandes Telegram
"""

import sys
from pathlib import Path

# Assurer la résolution des modules que le script soit lancé depuis Bot/ ou depuis la racine
BOT_DIR = str(Path(__file__).resolve().parent)
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

from telegram import BotCommand
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
)
from telegram.request import HTTPXRequest

from config import TOKEN, OWNER_ID, RACINE, INBOX
from handlers.common import start, help_command, button_callback, error_handler
from handlers.system import status_command, shot_command, lock_command
from handlers.files import ls_command, find_command, get_command, zip_command, receive_file


async def post_init(application: Application) -> None:
    """Enregistre la liste des commandes auprès de Telegram pour l'autocomplétion."""
    commandes = [
        BotCommand("start", "Démarrer ORION et afficher le centre de contrôle"),
        BotCommand("help", "Afficher toutes les commandes"),
        BotCommand("ls", "Parcourir les dossiers et fichiers"),
        BotCommand("find", "Chercher un fichier par son nom"),
        BotCommand("get", "Télécharger un fichier (< 50 Mo)"),
        BotCommand("zip", "Zipper un dossier et l'envoyer (< 50 Mo)"),
        BotCommand("status", "État du PC (CPU, RAM, Disque, 🔋, Uptime)"),
        BotCommand("shot", "Capture d'écran distante immédiate"),
        BotCommand("lock", "Verrouiller la session du PC à distance"),
    ]
    await application.bot.set_my_commands(commandes)


def main() -> None:
    """Initialise et lance le bot Telegram en écoute continue (long polling)."""
    if not TOKEN:
        print("❌ Erreur : BOT_TOKEN introuvable. Veuillez renseigner le fichier Bot/.env.")
        return

    req = HTTPXRequest(connect_timeout=20.0, read_timeout=20.0)
    app = (
        Application.builder()
        .token(TOKEN)
        .request(req)
        .get_updates_request(req)
        .post_init(post_init)
        .build()
    )

    # 1. Commandes générales
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler(["help", "menu"], help_command))

    # 2. Gestion des fichiers
    app.add_handler(CommandHandler("ls", ls_command))
    app.add_handler(CommandHandler("find", find_command))
    app.add_handler(CommandHandler(["get", "getfile"], get_command))
    app.add_handler(CommandHandler("zip", zip_command))
    app.add_handler(MessageHandler(filters.Document.ALL | filters.PHOTO, receive_file))

    # 3. Pilotage & Système
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("shot", shot_command))
    app.add_handler(CommandHandler("lock", lock_command))

    # 4. Boutons interactifs & erreurs
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
