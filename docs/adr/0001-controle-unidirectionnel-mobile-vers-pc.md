# ADR 0001 — Contrôle unidirectionnel : le mobile et la montre pilotent les PC

- **Date :** 26 novembre 2026
- **Statut :** Accepté (conception) — l'implémentation réseau n'est pas commencée

## Contexte

Le cahier des charges v1.3 décrit un maillage **multidirectionnel** : n'importe quel appareil
pilote n'importe quel autre (PC → téléphone, téléphone → PC, etc.). Ça multiplie les agents
(agent Android natif, wake-up du téléphone, présence croisée) et la complexité du protocole.

## Décision

ORION devient un **centre de contrôle à sens unique** :

```
 Contrôleurs                     Appareils pilotés
 ┌──────────────────┐            ┌──────────────────────┐
 │ App mobile (RN)  │ ─────────▶ │ Agent PC Ubuntu      │
 │ Montre (plus tard│ ─────────▶ │ Agent PC macOS       │
 │ Bot Telegram     │ ─────────▶ │ Agent PC Windows     │
 └──────────────────┘            └──────────────────────┘
```

- Les **contrôleurs** (app mobile React Native, montre, bot Telegram) envoient des ordres
  et reçoivent des résultats. Ils n'exécutent jamais d'action pour un autre appareil.
- Les **PC** (Mac, Windows, Ubuntu) exécutent les actions via un agent multiplateforme.
- L'interaction principale est **vocale** : on parle à ORION, il agit sur le PC ciblé et répond.

## Conséquences

- L'agent Android et toute action « PC → téléphone » sortent du périmètre.
- L'app mobile est réécrite en **React Native (Expo + TypeScript)** dans `app/`, à la place de Flet.
- Le transport (direct via Tailscale, ou via un Core central) reste **à décider** ; l'app
  utilise pour l'instant des données fictives (`app/src/data/mock.ts`).
- La montre (Wear OS ou watchOS) viendra dans une étape ultérieure.
