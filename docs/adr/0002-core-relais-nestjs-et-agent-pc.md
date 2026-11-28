# ADR 0002 — Core relais (NestJS) et agent PC (Python)

- **Date :** 27 novembre 2026
- **Statut :** Accepté (Core et agent implémentés, app à brancher)
- **Remplace :** la question « transport » laissée ouverte par l'ADR 0001

## Contexte

L'app mobile ORION (Expo) doit piloter les PC (Ubuntu, macOS, Windows) depuis n'importe où,
y compris en 4G. Le bot Telegram (`Bot/`) prouve que les actions marchent, mais Telegram
impose ses limites (50 Mo, 64 octets de `callback_data`, texte formaté) et son interface.

Le dossier `core/` contient une base **NestJS + Prisma (PostgreSQL)** avec authentification
JWT, Helmet, limitation de débit et Swagger.

## Décision

```
 App ORION (Expo)                 Core relais (NestJS, cloud)                Agent PC (Python)
 ───────────────────              ───────────────────────────                ─────────────────
 HTTPS  /auth, /devices  ───────▶ REST : comptes, appareils, appairage
 WSS    namespace /app   ◀──────▶ Passerelle temps réel (Socket.IO) ◀──────▶ WSS namespace /agents
                                  PostgreSQL : users, devices, commands       (connexion SORTANTE,
                                  Stockage temporaire : captures, fichiers     aucun port ouvert)
```

1. **Le Core est un relais**, pas un exécutant : il authentifie, route les commandes de l'app
   vers le bon PC, renvoie les résultats et garde l'historique (écran « Activité »).
2. **L'agent PC ouvre une seule connexion sortante** (WebSocket) vers le Core. Le PC n'expose
   aucun port : il marche derrière n'importe quelle box, sans Tailscale. MQTT (prévu au cahier
   des charges) n'est pas nécessaire tant qu'il n'y a qu'un relais : Socket.IO suffit.
3. **Appairage** : depuis l'app (« Associer un PC »), le Core génère un code à 6 chiffres valable
   10 min ; on le tape dans l'agent (`orion-agent pair 123456`). L'agent reçoit un jeton d'appareil
   à longue durée, stocké localement ; le Core n'en garde qu'une empreinte (SHA-256).
4. **Commandes** : enveloppe commune `{ id, deviceId, action, params, status, result, error }`.
   Statuts : `pending → sent → running → done | failed | timeout`. Actions V1 : `status`,
   `screenshot`, `lock`, `sleep`, `files.list`, `files.search`, `files.get`, `files.zip`, `notify`.
5. **Fichiers** : l'agent dépose le fichier sur le Core (upload HTTP authentifié par le jeton
   d'appareil), l'app le télécharge par une URL signée et éphémère. Suppression après 15 min.
6. **Agent multiplateforme** : `agent/` reprend les services de `Bot/services` (système, fichiers,
   capture), renvoie des **données** (nombres, JSON) et non du texte Telegram, et isole le code
   propre à chaque OS dans `agent/orion_agent/platform/{linux,macos,windows}.py`.
7. **Telegram reste un canal de secours** : le bot importe les mêmes services que l'agent.

## Conséquences

- Le Core doit être hébergé (Render, comme prévu dans `core/README.md`) avec une base PostgreSQL.
- La limitation de débit globale (10 requêtes/min) doit être revue : trop basse pour l'app.
- Le jeton JWT d'1 h sans renouvellement obligerait à se reconnecter : ajout d'un jeton de
  renouvellement (refresh) côté app.
- Le cahier des charges (FastAPI, MQTT) est à mettre à jour pour refléter ces choix.
