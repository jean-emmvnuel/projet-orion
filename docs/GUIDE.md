# ORION — Guide d'utilisation

ORION te permet de piloter tes PC (Ubuntu, macOS, Windows) depuis ton téléphone : voir l'écran, récupérer ou envoyer des fichiers, contrôler la musique et le volume, verrouiller, éteindre…

Ce guide explique comment tout démarrer, associer un PC et s'en servir au quotidien.

---

## 1. Les trois pièces du projet

| Pièce | Dossier | Rôle |
| --- | --- | --- |
| **Core** (serveur relais) | `core/` | Comptes, appareils, transmission des commandes et des fichiers. Le téléphone et le PC ne se parlent jamais directement : tout passe par lui. |
| **App mobile** | `app/` | La télécommande : conversation avec ORION, commandes, explorateur de fichiers, télécommande multimédia. |
| **Agent PC** | `agent/` | Tourne sur chaque PC à piloter et exécute les actions. Il existe en application desktop (fenêtre) et en ligne de commande. |

```
Téléphone (app)  ──►  Core (relais)  ──►  Agent PC
        ◄────────── résultats, fichiers ◄──────────
```

Le PC se connecte **vers** le Core : aucun port à ouvrir sur le PC.

---

## 2. Démarrer le Core

### 2.1 Base de données PostgreSQL (à faire une fois)

Crée le compte et la base `orion` sur le PostgreSQL du système :

```bash
sudo -u postgres psql -c "CREATE ROLE orion LOGIN PASSWORD 'orion_dev_password' CREATEDB;" -c "CREATE DATABASE orion OWNER orion;"
```

Vérifie que `DATABASE_URL` dans `core/.env` pointe bien vers cette base (port 5432), puis crée les tables :

```bash
cd core && npx prisma migrate deploy
```

> **État actuel.** Pendant le développement, le Core tourne sur une base de test temporaire (port 5433), dans le dossier temporaire de la session. **Elle disparaît au redémarrage du PC**, ainsi que les comptes et appareils associés. Une fois l'étape ci-dessus faite, le Core utilise la base durable du `.env` et il faudra recréer ton compte et réassocier le PC.

### 2.2 Lancer le serveur

```bash
cd core && npm run start:dev
```

Le Core écoute sur `http://<IP-du-PC>:3001`. La documentation de l'API est sur `/api`.

---

## 3. L'app mobile

### 3.1 Lancer l'app (développement)

```bash
cd app && npx expo start
```

Scanne le QR code avec **Expo Go** (iPhone : appareil photo ; Android : app Expo Go). Le téléphone et le PC doivent être sur le **même réseau Wi-Fi**.

L'app trouve le Core toute seule (même machine que Metro, port 3001). Sinon : écran de connexion → « Serveur ORION Core » → saisis l'adresse, par exemple `http://192.168.1.20:3001`.

### 3.2 Créer son compte

Écran de connexion → **Créer un compte** : prénom, e-mail, mot de passe (8 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial). Ta session reste ouverte 7 jours et se renouvelle seule.

---

## 4. Associer un PC

1. **Sur le téléphone** : menu ORION (icône à neuf points, en haut à gauche de l'accueil) → **Appareils** → **Associer un PC**. Un code à 6 chiffres s'affiche, valable 10 minutes.
2. **Sur le PC**, ouvre l'application desktop ORION (voir section 6) → **Appareil** → saisis l'adresse du Core et le code → **Associer ce PC**.
   En ligne de commande : `orion-agent pair 123456 --server http://<IP>:3001`, puis `orion-agent run`.
3. Le PC apparaît dans l'app, avec la pastille **En ligne**.

> ⚠️ **Un seul agent à la fois par PC.** N'ouvre pas l'application desktop pendant que `orion-agent run` (ou le service en arrière-plan) tourne : deux connexions avec le même jeton se gêneraient.

---

## 5. Utiliser ORION au quotidien

### 5.1 La conversation

Depuis l'accueil, touche **Demander à ORION**. Écris une commande ou une phrase simple ; ORION l'exécute sur le PC ciblé et répond avec une carte (capture, fichier, état, liste…). Tape **`/`** pour voir la liste des commandes.

Tape **/** pour voir toutes les commandes, **groupées par thème**. Une commande par besoin ; l'argument précise ce que tu veux. Les anciens noms (`/lecture`, `/appli`, `/google`, `/copie`…) marchent toujours.

| Thème | Commande | Ce qu'elle fait |
| --- | --- | --- |
| Général | `/aide` · `/etat` | Tout ce qu'ORION sait faire · processeur, mémoire, disque, batterie |
| | `/message <texte>` | Afficher une notification sur le PC |
| Écran | `/direct` | **Écran du PC en direct**, à voir et contrôler |
| | `/capture` | Photo de l'écran, enregistrable dans Photos |
| Fichiers | `/fichiers [dossier]` | Parcourir tes dossiers |
| | `/cherche <nom>` | Trouver un fichier : envoyé directement s'il est seul, sinon liste à toucher |
| | `/zip <dossier>` | Télécharger un dossier en .zip |
| Ouvrir et naviguer | `/ouvre <appli, lien ou fichier>` | `/ouvre chrome`, `/ouvre youtube.com`, `/ouvre vacances.mp4` |
| | `/applis` | Toutes les applications du PC |
| | `/web <recherche ou action>` | `/web météo Abidjan` (Google) ou `/web retour`, `suivant`, `actualiser`, `onglet`, `fermer` |
| Clavier et presse-papiers | `/tape <texte ou touches>` | `/tape Bonjour` écrit le texte ; `/tape ctrl+t` envoie le raccourci |
| | `/presse [texte]` | Sans texte : récupérer le presse-papiers du PC · avec texte : l'y copier |
| Son et médias | `/media [pause, suivant, precedent]` | Seul : ce qui joue · sinon contrôle la lecture |
| | `/volume <+, -, muet, 0-100>` | Régler le son |
| Session | `/verrou` · `/deverrouille` | Verrouiller · déverrouiller (Face ID ou code du téléphone) |
| | `/veille` · `/reveil` | **Veille légère** (écran éteint, PC joignable) · réveiller et déverrouiller (Face ID) |
| | `/veille profonde` | Vraie veille : le PC ne pourra pas être réveillé depuis le téléphone |
| Alimentation | `/redemarre` · `/eteins` | Redémarrer · éteindre (confirmation demandée) |

Le bouton **+** de la barre de saisie envoie des **photos ou fichiers du téléphone vers le PC**. Ils sont rangés dans `Téléchargements/ORION`.

### 5.1 bis Écran en direct et contrôle à distance

Fiche du PC → **Écran en direct** (ou `/direct`). L'écran du PC s'affiche en vidéo (environ 8 images/s) et tu le contrôles depuis le téléphone :

| Geste | Effet sur le PC |
| --- | --- |
| Toucher l'image | Clic à cet endroit |
| Double toucher | Double-clic |
| Appui long | Clic droit |
| Pincer | Zoomer sur une partie de l'écran (« Recadrer » revient à la vue entière) |
| Glisser sur l'image | Faire défiler la page (ou déplacer la vue quand elle est zoomée) |
| **Pavé tactile** : glisser à un doigt | Déplacer la souris |
| Pavé tactile : toucher · deux doigts | Clic · défilement ou clic droit |
| Pavé tactile : **trois doigts** | Balayer ← / → : fenêtre suivante / précédente · ↑ : vue des activités · ↓ : afficher le bureau · toucher : clic du milieu |
| **Clavier** | Ce que tu tapes s'écrit sur le PC ; barre de raccourcis : Entrée, Effacer, Échap, Tab, flèches, Copier, Coller, Annuler, Fenêtres (Alt+Tab)… |
| **Maintenir** | Garde le clic enfoncé (glisser-déposer), puis **Relâcher** |

Qualité de l'image : **Fluide** (plus d'images, moins net), **Équilibré**, **Net** (texte lisible, plus lent).

Qualités : **Fluide** (jusqu'à 20 images/s), **Équilibré** (15 images/s), **Net** (10 images/s, texte plus lisible). Quand l'écran du PC ne bouge pas, rien n'est envoyé.

**Selon le système du PC :**

| Système | Ce qu'il faut | Première utilisation |
| --- | --- | --- |
| **Linux** (Ubuntu…) | GStreamer + PipeWire (paquets du système) | L'application desktop détecte ce qui manque et propose **Installer maintenant** (mot de passe administrateur demandé une fois). En ligne de commande : `orion-agent setup`. Puis accepter la fenêtre « partage d'écran / contrôle à distance » d'Ubuntu, une seule fois. |
| **Windows** | Rien à installer (tout est dans l'application) | Aucune autorisation à donner. |
| **macOS** | Rien à installer (tout est dans l'application) | Réglages système > Confidentialité et sécurité : cocher ORION Agent dans **Enregistrement de l'écran** et **Accessibilité**. L'application rappelle quoi cocher. |

> Sur Mac, les raccourcis « façon PC » envoyés par le téléphone sont traduits : Ctrl+C devient Cmd+C, Alt+Tab devient Cmd+Tab, etc.
>
> La version Windows et la version macOS n'ont pas encore été testées sur une vraie machine.

### 5.1 ter Applications et web

- Fiche du PC → **Applications** : toutes les applis du PC, avec recherche et catégories. Un toucher l'ouvre, puis **Voir l'écran** pour t'en servir.
- Fiche du PC → **Naviguer sur le web** : recherche Google ou adresse, puis retour, suivant, actualiser, nouvel onglet, onglet suivant, fermer l'onglet, haut et bas de page.

### 5.2 La fiche d'un PC

**Appareils** → touche un PC : état en direct (processeur, mémoire, disque, batterie), capture d'écran, télécommande multimédia (lecture, pistes, volume), échanges (presse-papiers, lien, envoi de fichiers), verrouillage et alimentation.

### 5.2 bis Veille légère et réveil

Une vraie veille coupe le PC du réseau : impossible ensuite de le réveiller depuis le téléphone (il faudrait du Wake-on-LAN et une autre machine allumée sur le même réseau). ORION propose donc une **veille légère** :

- **Veille** (fiche du PC ou `/veille`) : la session se verrouille, l'écran s'éteint, et ORION empêche la mise en veille automatique. Le PC reste joignable.
- **Réveiller** (fiche du PC, ou `/reveil`) : Face ID ou le code du téléphone, puis l'écran se rallume et la session s'ouvre.
- Si tu reviens devant le PC et le déverrouilles toi-même, la veille légère s'arrête seule.
- La veille légère consomme un peu plus qu'une vraie veille, car le PC reste allumé : branche-le si tu t'absentes longtemps.

### 5.2 ter Déverrouiller le PC

Quand le PC est verrouillé, sa fiche affiche **Session verrouillée · Déverrouiller**, et le bouton **Verrouiller** devient **Déverrouiller**. ORION demande d'abord **Face ID** (ou le code du téléphone), puis ouvre la session. Tu peux aussi écrire `/deverrouille` ou « déverrouille mon PC ».

- Fonctionne sous **Linux** (GNOME, KDE) pour la session déjà ouverte et verrouillée. Après un redémarrage, l'écran de connexion demande toujours le mot de passe sur le PC.
- **Windows et macOS** n'autorisent pas le déverrouillage à distance sans mot de passe : ORION le signale.
- Pour l'interdire : application desktop → Réglages → Autorisations → **Déverrouiller la session depuis le téléphone**.

### 5.3 L'explorateur de fichiers

Depuis la fiche du PC → **Fichiers** : navigation libre dans le dossier personnel, fil d'Ariane, retour au dossier parent, recherche. Touche un fichier pour l'**aperçu** (image, vidéo, musique, texte, PDF), le **lancer sur le PC** ou l'**enregistrer** sur le téléphone. Un dossier se télécharge en **.zip**.

Tout s'ouvre dans l'app : rien ne t'envoie vers le navigateur. Les liens de téléchargement expirent après 15 minutes.

### 5.4 La voix

Le bouton micro ouvre la vue vocale : l'orbe réagit à ta voix. *La reconnaissance vocale (comprendre ce que tu dis) arrive avec la V4 du projet.*

### 5.5 Personnaliser

Menu → **Personnaliser ORION** : couleurs et style de l'orbe, thème clair / sombre / système, durée de conservation de l'historique, compte.

---

## 6. L'application desktop (agent PC)

### 6.1 Lancer

- **Version construite** : `agent/build/linux/orion-agent` (garde tout le dossier `build/linux`, il contient Python).
- **Depuis les sources** : `cd agent && .venv/bin/orion-agent-gui`.

À l'ouverture, l'animation ORION (la ceinture d'Orion qui devient le logo) se joue, puis la fenêtre s'affiche, dimensionnée selon ton écran.

### 6.2 Les pages

| Page | Contenu |
| --- | --- |
| **Accueil** | État de la connexion, démarrer / arrêter l'agent, processeur, mémoire, disque, batterie en direct, dernières commandes |
| **Journal** | Toutes les commandes reçues du téléphone, avec leur résultat |
| **Appareil** | Associer le PC ; **modifier son nom** (il change aussitôt dans l'app) et **l'adresse du Core** (si l'IP du serveur change, elle est vérifiée avant d'être enregistrée) ; dissocier |
| **Réglages** | Thème, lancement au démarrage (service systemd), **état de l'écran en direct** (prêt, ou composants à installer d'un clic), **autorisations** : chaque type d'action peut être interdit sur ce PC (captures, fichiers, presse-papiers, alimentation…) |
| **À propos** | Le créateur, le portfolio, la version |

### 6.3 Construire l'application

```bash
cd agent && .venv/bin/flet build linux
```

Prérequis (une fois) : `sudo apt install clang cmake ninja-build pkg-config libgtk-3-dev liblzma-dev`.

---

## 7. En cas de problème

| Symptôme | Solution |
| --- | --- |
| Le PC est **hors ligne** dans l'app | Vérifie que l'agent tourne (application desktop → Accueil → Démarrer). Vérifie que le Core tourne. |
| L'**adresse IP** du PC qui héberge le Core a changé | Application desktop → Appareil → Adresse du Core → Modifier. Sur le téléphone : écran de connexion → Serveur ORION Core. |
| Le téléphone ne joint pas le Core | Même Wi-Fi que le PC ? Pare-feu : autoriser le port 3001 (`sudo ufw allow 3001`). |
| « Accès révoqué » sur le PC | Le PC a été retiré dans l'app : réassocie-le (section 4). |
| Le presse-papiers ne marche pas (Ubuntu) | `sudo apt install wl-clipboard` |
| Une action est refusée | Elle est peut-être désactivée dans les **Réglages → Autorisations** de l'application desktop. |
| L'écran en direct reste sur « Connexion… » | La première fois, accepte la fenêtre de partage d'écran sur le PC. Si tu l'as refusée, relance l'écran en direct pour qu'elle réapparaisse. |
| L'écran en direct saccade | Choisis la qualité **Fluide**, ou rapproche-toi du Wi-Fi. |
| Comptes et appareils disparus après un redémarrage | La base temporaire de développement a été effacée : voir section 2.1. |

---

## 8. Sécurité et confidentialité

- Le jeton du PC est stocké dans `~/.config/orion/agent.json`, lisible par toi seul. Ce jeton n'est jamais conservé en clair sur le Core.
- L'agent ne touche qu'à ton dossier personnel ; les dossiers sensibles (`.git`, `.venv`, `node_modules`…) sont ignorés.
- Éteindre, redémarrer et dissocier demandent une confirmation.
- Les fichiers transitent par le Core avec des liens signés qui expirent après 15 minutes.

---

## 9. Ce qui vient ensuite

Selon le cahier des charges : **V2 Mémoire** (recherche de fichiers par le sens, « Retiens que… »), **V3 Cerveau** (demandes libres en langage naturel avec un LLM), **V4 Voix** (parler à ORION et l'entendre répondre).
