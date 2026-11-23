# 🤖 ORION — Bot Telegram (V0.5 Messager)

Ce composant implémente le jalon **V0.5 (Messager)** du projet ORION. Il constitue le premier pont opérationnel entre le PC et l'utilisateur à distance via Telegram.

---

## 📋 Fonctionnalités

| Commande | Action | Détails |
|---|---|---|
| `/ls [chemin]` | Explorateur de fichiers interactif | Clavier en ligne, pagination (30 items), bouton direct `📦 Zipper ce dossier` |
| `/find <nom>` | Recherche de fichiers par motif | Recherche récursive avec exclusion automatique des caches |
| `/get <chemin>` | Téléchargement direct de fichier | Limite Telegram de 50 Mo respectée avec avertissement |
| `/zip <chemin>` | Compression & envoi d'archive | Crée un `.zip` en tâche de fond et l'envoie dans la conversation |
| `/screenshot` | Capture d'écran instantanée | **100% autonome sans confirmation physique**, compatible Wayland (GNOME Shell) et X11 |
| `/status` | État des ressources du PC | CPU, RAM, espace disque et durée d'activité (uptime) |
| *Envoi de fichier* | Réception automatique | Rangement direct dans `~/Téléchargements/ORION` ou `~/Downloads/ORION` |

---

## 🔒 Sécurité intégrée

1. **Confinement `safe_path`** : L'accès est strictement confiné au répertoire personnel (`Path.home()`). Tout accès à `/etc`, `/root` ou tentative de *path traversal* (`../`) est bloqué.
2. **Filtrage `OWNER_ID`** : Seul l'identifiant Telegram configuré peut interagir avec le bot. Les utilisateurs inconnus subissent un silence total.
3. **Exclusion des répertoires lourds & sensibles** : `.git`, `node_modules`, `.venv`, caches, corbeille (`.local/share/Trash`) sont exclus des recherches et des archives.

---

## 🚀 Installation & Configuration

### 1. Variables d'environnement
Créez un fichier `.env` dans le dossier `Bot/` à partir de `.env.example` :
```bash
cp .env.example .env
```

Renseignez votre jeton et votre identifiant :
```ini
TELEGRAM_BOT_TOKEN="votre_token_botfather"
TELEGRAM_OWNER_ID=votre_id_telegram
```

### 2. Dépendances
Dans l'environnement virtuel du bot :
```bash
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 🖥️ Utilisation

### Lancement manuel
```bash
python3 bot.py
```

### Lancement en tâche de fond via systemd (Recommandé)
Pour que le bot tourne en continu dès le démarrage de votre session utilisateur :

1. **Copier le fichier de service :**
```bash
mkdir -p ~/.config/systemd/user
cp orion-bot.service ~/.config/systemd/user/
```

2. **Recharger et activer le service :**
```bash
systemctl --user daemon-reload
systemctl --user enable --now orion-bot.service
```

3. **Vérifier le statut :**
```bash
systemctl --user status orion-bot.service
```

4. **Consulter les journaux en direct :**
```bash
journalctl --user -u orion-bot.service -f
```
