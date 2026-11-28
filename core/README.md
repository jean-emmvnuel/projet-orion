# ORION Core — relais

Serveur **NestJS + Prisma (PostgreSQL)** entre l'app mobile ORION et les agents PC.
Il authentifie, enregistre les PC, route les commandes, relaie les fichiers et garde l'historique.
Décision : [ADR 0002](../docs/adr/0002-core-relais-nestjs-et-agent-pc.md).

## Démarrer en développement

```bash
cp .env.example .env        # puis remplir JWT_SECRET et FILES_SECRET : openssl rand -hex 32
npm install
npx prisma migrate deploy   # crée les tables
npm run start:dev           # http://localhost:3001 — documentation : http://localhost:3001/api
```

Base locale (une seule fois) :

```bash
sudo -u postgres psql -c "CREATE ROLE orion LOGIN PASSWORD 'orion_dev_password' CREATEDB;" -c "CREATE DATABASE orion OWNER orion;"
```

## API

| Méthode | Route | Qui | Rôle |
| --- | --- | --- | --- |
| POST | `/auth/register`, `/auth/login` | app | Compte (10 essais/min) |
| POST | `/auth/refresh` | app | Renouvelle le jeton (7 jours) |
| GET | `/devices` | app | PC du compte + présence + dernière télémétrie |
| POST | `/devices/pairing-codes` | app | Code d'appairage à 6 chiffres (10 min) |
| POST | `/devices/pair` | agent | Échange le code contre un jeton d'appareil (5 essais/min) |
| PATCH / DELETE | `/devices/:id` | app | Renommer / dissocier (révoque le jeton) |
| POST | `/devices/:id/commands[?wait=1]` | app | Envoie une action au PC |
| GET | `/commands`, `/commands/:id` | app | Historique (« Activité ») |
| POST | `/files` | agent | Dépose un fichier (≤ 200 Mo) |
| GET | `/files/:id?exp&sig` | app | Téléchargement par lien signé (15 min) |

## Temps réel (Socket.IO)

- **`/agents`** — `auth: { token: <jeton d'appareil> }`
  - reçoit `command` `{ id, action, params }`
  - envoie `command:update` `{ id, status: running|done|failed, result?, error? }` et `telemetry` `{ cpu, ram, … }`
- **`/app`** — `auth: { token: <JWT> }`
  - reçoit `device:presence`, `device:telemetry`, `device:paired`, `command:update`

## Cycle d'une commande

`pending → sent → running → done | failed | timeout` — chaque action a son délai maximal
(`ACTIONS` dans `src/commands/commands.service.ts`). Un PC hors ligne fait échouer la commande
immédiatement ; une déconnexion en cours fait échouer les commandes en vol.
