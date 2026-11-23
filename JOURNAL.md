# 📓 ORION — Journal de bord

> **Principe :** Chaque jour de travail sur ORION, noter brièvement :
> 1. **Ce qui a été fait** (fonctionnalités, refactoring, tests)
> 2. **Ce qui a été appris** (technologies, pièges, concepts)
> 3. **Les points de blocage ou prochaines étapes**

---

## 📅 23 novembre 2026 — Clôture du Jalon V0.5 (Messager) & Préparation V1

### 1. Ce qui a été fait
- **Refactoring modulaire & Nettoyage du code indésirable :**
  - Découpage du fichier monolithique `bot.py` (1010 lignes) en une architecture modulaire et maintenable :
    - `config.py` : centralisation de la configuration, dossiers racines et seuils.
    - `security.py` : confinement `safe_path`, filtrage d'accès et cache LRU `PathCache` en O(1).
    - `services/` : logique système (`system.py`), capture Wayland sans pop-up (`screenshot.py`) et manipulation optimisée de fichiers (`files.py`).
    - `handlers/` : dispatching clair des commandes (`common.py`, `files.py`, `system.py`).
    - `bot.py` : orchestrateur allégé de moins de 100 lignes.
  - Élimination du code mort et des outils incompatibles avec Wayland (`gnome-screenshot`, `flameshot`).
- **Optimisations algorithmiques (faible coût de calcul) :**
  - `/find` : passage à `os.scandir` avec profondeur bornée (`MAX_FIND_DEPTH = 4`) et arrêt anticipé (`MAX_FIND_RESULTS = 15`), évitant les scans récursifs infinis et l'épuisement CPU/disque.
  - `/zip` : pré-contrôle en O(N) de la taille brute (refus immédiat si > 100 Mo) évitant de compresser inutilement des gigaoctets de données, compression avec niveau rapide (`compresslevel=1`).
  - `/status` : lecture directe en O(1) depuis `sysfs` et `/proc`, ajout du **pourcentage et état de batterie**.
- **Nouvelles fonctionnalités V0.5 :**
  - `/shot` uniforme : commande unique et explicite pour la capture d'écran distante immédiate.
  - `/lock` : verrouillage instantané de la session du PC à distance via `loginctl` / D-Bus.
  - Interface `/help` & `/start` stylée et ergonomique avec clavier de boutons d'action rapide.
- **Packaging & Automatisation du service d'arrière-plan :**
  - Création de l'unité systemd utilisateur `Bot/orion-bot.service` pour exécution continue en tâche de fond avec accès au bus D-Bus utilisateur.
  - Rédaction du guide d'exploitation complet [`Bot/README.md`](Bot/README.md).
- **Site vitrine PWA ORION :**
  - Déploiement d'une landing page PWA responsive (`site/`) avec animations GSAP vivantes style Claude Code (titres en reveal mot à mot, magnetic buttons, parallax de particules stellaires, terminal interactif, timeline interactive V0→V9).
  - Intégration du favicon et icones PWA générés depuis le **Concept 1 Logo B (« Le O réciproque »)**.

### 2. Ce qui a été appris
- **Wayland vs X11 pour les captures d'écran :** Sous Ubuntu avec Mutter/GNOME Shell, les outils traditionnels comme `grim` (spécifique à wlroots) ou `import` échouent. L'appel D-Bus `org.gnome.Shell.Screenshot` ou `gnome-screenshot -f` avec transmission des descripteurs de session D-Bus constitue la seule méthode fiable sans privilèges root.
- **Philosophie d'un assistant distant :** Aucune interaction physique sur la machine cible ne doit être requise lors d'une commande déclenchée à distance (suppression des invites de validation locale).
- **Compression asynchrone dans Telegram :** Utiliser `asyncio.to_thread` pour les opérations I/O lourdes (création d'archive zip) est indispensable pour ne pas bloquer la boucle d'événements du bot.

### 3. Prochaines étapes (Cap sur la V1 — Pont)
- Lancement de la **V1 — Pont (téléphone ⇄ PC)** :
  - Initialiser le package `core/src/orion_core/` (FastAPI, SQLAlchemy/PostgreSQL, Redis).
  - Configurer l'authentification propriétaire (F001 : Argon2id, JWT, TOTP).
  - Définir le protocole d'appairage par QR code (F002) et le bus MQTT Mosquitto.
  - Développer l'agent local `agent/src/orion_agent/`.

---

## 📅 22 novembre 2026 — Jalon V0 (Atelier) & V0.5 (Messager)

### 1. Ce qui a été fait
- **Identité de marque :** Sélection officielle du **Concept 1 — Logo B (« Le O réciproque »)**. Génération des assets vectoriels haute fidélité (`assets/logo.svg`, `logo-light.svg`, `logo-dark.svg`, `logo-symbol.svg`) avec prise en charge native des thèmes clair et sombre.
- **Documentation & Spécifications :**
  - Rédaction complète du [`README.md`](README.md) aligné sur le cahier des charges (v1.3) : présentation de la vision multidirectionnelle, état d'avancement V0/V0.5, feuille de route V0 → V9, architecture en étoile et démarrage rapide.
- **Sécurité & Hygiène du dépôt :**
  - Mise en place d'un [`.gitignore`](.gitignore) strict protégeant les secrets (`.env`, certificats), environnements virtuels (`.venv`, `Training/.env`), caches (`__pycache__`, `.ruff_cache`, `.pytest_cache`) et fichiers temporaires/téléchargés (`Bot/reçus/`).
  - Ajout du modèle [`Bot/.env.example`](Bot/.env.example) pour le déploiement sécurisé du Bot Telegram.
- **Validation V0.5 (Bot Telegram) :**
  - Revue du code de [`Bot/bot.py`](Bot/bot.py) : navigation arborescente sécurisée (`/ls`), cache MD5 des chemins pour respecter le plafond de 64 octets de `callback_data`, téléchargement direct (`/getfile`), réception automatique dans `~/reçus`.
- **Validation V0 (Banc d'essai) :**
  - Exploration des capacités Flet multiplateformes dans le dossier `Training/`.

### 2. Ce qui a été appris
- La contrainte forte de l'API Telegram sur la taille maximale de `callback_data` (64 octets maximum), élégamment résolue par un cache LRU / OrderedDict avec hachage MD5 tronqué à 12 caractères.
- L'importance de confiner systématiquement les chemins (`is_relative_to(RACINE)`) dès les premiers prototypes pour éviter les failles de traversée de répertoire (*Path Traversal*).
- L'utilisation des balises HTML `<picture>` avec `media="(prefers-color-scheme: dark|light)"` pour offrir une expérience visuelle parfaite sur GitHub selon le thème de l'utilisateur.

### 3. Prochaines étapes
- Initialiser le dépôt Git local et configurer le remote GitHub.
- Mettre en place le workflow d'intégration continue GitHub Actions (`.github/workflows/ci.yml`).
- Préparer les fondations de la **V1 — Pont** : structure des modules `core/` (FastAPI), `agent/` (Python/systemd) et `app/` (Flet).

---

## 📅 21 novembre 2026 — Conception de l'identité visuelle

### 1. Ce qui a été fait
- Exploration de plusieurs pistes graphiques pour ORION :
  - Concept 1 : Variantes géométriques (A, B, C).
  - Concept 2 & 3 : Variantes typographiques et symboles alternatifs.
- Retenue unanime du **Concept B** : la symétrie des deux arcs et de leurs nœuds cardinaux symbolisant la communication bidirectionnelle parfaite Téléphone ⇄ PC.

### 2. Ce qui a été appris
- Règle de contraste WCAG : pourquoi un violet `#9810e6` sur fond sombre ne suffit pas (ratio < 3:1) et nécessite la déclinaison claire `#b15cf0` (ratio 4,73:1).

---

## 📅 20 novembre 2026 — Finalisation du Cahier des charges (v1.3)

### 1. Ce qui a été fait
- Finalisation et validation du document de référence : [`ORION_Cahier_des_charges.md`](ORION_Cahier_des_charges.md).
- Structuration des 9 versions livrables (V1 à V9) précédées des étapes V0 (Atelier) et V0.5 (Messager).
- Choix structurants : Linux natif pour le poste de dev, Flet pour l'application multiplateforme, Tailscale pour le réseau maillé chiffré, MQTT (Mosquitto) pour le bus d'événements.
