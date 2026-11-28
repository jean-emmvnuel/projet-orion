# ORION — agent PC

L'agent tourne sur chaque PC piloté (Ubuntu, macOS, Windows). Il ouvre **une connexion sortante**
vers le Core relais et exécute les actions demandées depuis l'app ORION. Le PC n'expose aucun port.

```
App ORION ──HTTPS/WSS──▶ Core relais ◀──WSS (sortant)── orion-agent (ce PC)
```

## Installation

Python 3.12 ou plus récent.

```bash
cd agent
python3 -m venv .venv
.venv/bin/pip install -e .
```

## Associer ce PC

1. Dans l'app : **Appareils → Associer un PC**. Un code à 6 chiffres s'affiche (valable 10 min).
2. Sur le PC :

```bash
.venv/bin/orion-agent pair 482913 --server https://<adresse-du-core> --name "Atelier"
.venv/bin/orion-agent run
```

Le jeton de l'appareil est enregistré dans `~/.config/orion/agent.json` (macOS :
`~/Library/Application Support/orion/`, Windows : `%APPDATA%\orion\`), lisible par toi seul.

Autres commandes : `orion-agent info`, `orion-agent unpair`, `orion-agent gui`.

## Interface graphique

```bash
.venv/bin/orion-agent gui        # ou : .venv/bin/orion-agent-gui
```

Une fenêtre Flet aux couleurs de l'app ORION (police Inter, listes groupées, thème clair ou sombre) :

- **Accueil** — l'orbe « Constellation » reflète l'état de l'agent (gris à l'arrêt, bleu pendant la
  connexion, violet en ligne, qui s'anime à chaque commande reçue) ; bouton Démarrer / Arrêter l'agent ;
  CPU, mémoire (avec historique), disque et batterie en direct.
- **Journal** — chaque commande reçue du téléphone : action, heure, statut (en cours, terminé, échec et motif).
- **Appareil** — appairage (adresse du Core + code à 6 chiffres, comme `orion-agent pair`), état de
  l'association, bouton « Dissocier ce PC ».
- **Réglages** — thème ; lancement au démarrage (Linux : installe et active l'unité systemd utilisateur
  `orion-agent`) ; **autorisations par action** (captures, verrouillage, veille, notifications,
  navigation dans les fichiers, envoi de fichiers).

À l'ouverture, si le PC est associé, la fenêtre démarre l'agent elle-même — sauf si le service systemd
tourne déjà : elle le suit alors (état et journal lus dans `journalctl`) sans ouvrir de seconde connexion.
Fermer la fenêtre arrête l'agent qu'elle a lancé ; le service, lui, continue.

Les réglages sont dans `~/.config/orion/preferences.json`. Les actions désactivées y sont lues à chaque
commande, y compris par `orion-agent run` et le service : une action refusée remonte à l'app comme un échec
« Action désactivée sur ce PC ».

## Lancer au démarrage (Linux)

Le plus simple : **Réglages → Lancer au démarrage** dans l'interface. À la main :

```bash
mkdir -p ~/.config/systemd/user
cp orion-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now orion-agent
journalctl --user -u orion-agent -f
```

## Actions prises en charge

| Action | Paramètres | Linux | macOS | Windows |
| --- | --- | --- | --- | --- |
| `status` | — | ✅ | ✅ | ✅ |
| `screenshot` | — | portail XDG, grim, X11 | `screencapture` ¹ | Pillow |
| `lock` | — | loginctl, GNOME | `pmset displaysleepnow` ² | `LockWorkStation` |
| `sleep` | — | `systemctl suspend` | `pmset sleepnow` | `SetSuspendState` |
| `notify` | `title`, `body` | `notify-send` | `osascript` | PowerShell |
| `files.list` | `path` | ✅ | ✅ | ✅ |
| `files.search` | `query`, `root` | ✅ | ✅ | ✅ |
| `files.get` | `path` (≤ 200 Mo) | ✅ | ✅ | ✅ |
| `files.zip` | `path` (≤ 300 Mo bruts) | ✅ | ✅ | ✅ |

¹ autoriser le terminal dans *Confidentialité → Enregistrement de l'écran*.
² verrouille si « Exiger le mot de passe immédiatement » est activé.

## Sécurité

- Toutes les opérations sur les fichiers sont **confinées au dossier personnel** (`security.safe_path`).
- Le Core refuse toute action hors catalogue avant qu'elle n'atteigne le PC.
- Dissocier le PC dans l'app révoque son jeton et coupe immédiatement la connexion.
- Les fichiers envoyés transitent par le Core et y sont effacés au bout de 15 minutes.
