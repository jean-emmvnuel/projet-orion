# ORION — Guide d'utilisation du logo

## 1. Le logo

**L'idée :** la ceinture d'Orion (trois étoiles alignées et inclinées) devient les « … » d'un assistant qui réfléchit, à l'intérieur du O d'ORION. Le symbole se lit de trois façons : le nom, la constellation, l'assistant au travail.

| Version | Fichier (fond clair) | Fichier (fond sombre) | Usage |
|---|---|---|---|
| Horizontale (principale) | `svg/orion-horizontal-color.svg` | `svg/orion-horizontal-reversed.svg` | README, site, en-têtes |
| Empilée | `svg/orion-stacked-color.svg` | `svg/orion-stacked-reversed.svg` | Formats carrés, affiches, écran de démarrage |
| Symbole | `svg/orion-symbol-color.svg` | `svg/orion-symbol-reversed.svg` | À partir de 48 px |
| Symbole petite taille | `svg/orion-symbol-small-color.svg` | `svg/orion-symbol-small-reversed.svg` | En dessous de 48 px (anneau plus épais, étoiles plus grosses) |
| Nom seul | `svg/orion-wordmark-color.svg` | `svg/orion-wordmark-reversed.svg` | Quand le symbole est déjà présent à côté |

Les lettres du nom sont dessinées sur mesure, en tracés vectoriels : **ne retape jamais « ORION » dans une police pour remplacer le logo.**

## 2. Zone de protection

L'unité de mesure **u** est le diamètre de l'étoile centrale. Laisse au moins **2 u** de vide autour du logo, de tous les côtés. Cette zone grandit avec le logo.

## 3. Tailles minimales

| Version | Écran | Impression |
|---|---|---|
| Horizontale | 96 px de large | 25 mm |
| Empilée | 64 px de large | 18 mm |
| Symbole | 48 px | 10 mm |
| Symbole petite taille | 16 px | 5 mm |

## 4. Couleurs

| Rôle | Nom | HEX | RGB | CMJN (approx.) |
|---|---|---|---|---|
| Principale | Encre | `#1a1919` | 26 25 25 | 0 4 4 90 |
| Secondaire | Violet Orion | `#9810e6` | 152 16 230 | 34 93 0 10 |
| Tertiaire | Gris lune | `#817d7d` | 129 125 125 | 0 3 3 49 |
| Dérivée, fonds sombres | Violet clair | `#b15cf0` | 177 92 240 | 26 62 0 6 |

**Pourquoi un violet clair ?** Le violet `#9810e6` sur le fond `#1a1919` n'atteint qu'un contraste de 2,97:1, sous le minimum de 3:1 conseillé pour un élément graphique. Sur fond sombre, on utilise donc `#b15cf0` (4,73:1). Sur fond blanc, le violet de la charte fonctionne très bien (5,91:1).

Pour l'impression en Pantone, demande à l'imprimeur l'équivalent le plus proche de `#9810e6` sur un nuancier physique (une piste : Pantone 2592 C).

**Associations validées :**
- couleur sur blanc ou sur fond clair ;
- version inversée (anneau blanc, étoiles violet clair) sur `#1a1919` ou sur fond sombre ;
- une seule couleur : noir, blanc, encre ou violet (`export/symbol/`, `export/horizontal/`…) ;
- sur une photo, utilise la version blanche ou noire sur une zone calme.

**Le gris lune (tertiaire)** ne sert pas dans le logo lui-même. Il est réservé aux textes secondaires et à l'état « au repos » des étoiles dans l'animation (voir §6).

## 5. Typographie

- **Logo :** lettres géométriques dessinées sur mesure (aucune police à licence dans le logo).
- **Interface et documentation (suggestion) :** une géométrique libre comme **Jost** ou **Outfit** (licence OFL) pour les titres, et **Inter** pour le texte courant. Les deux sont gratuites et compatibles avec un projet open source.

## 6. Animation (suggestion)

Pendant que l'agent travaille, les trois étoiles s'allument l'une après l'autre (violet), puis reviennent au gris lune, comme un indicateur « … ». C'est le même geste que le logo : l'assistant réfléchit.

Respecte `prefers-reduced-motion` : dans ce cas, garde les trois étoiles allumées, sans mouvement.

## 7. À ne pas faire

- Étirer, écraser ou faire pivoter le logo, y compris pour remettre les étoiles à l'horizontale : l'inclinaison de 20° fait partie de l'identité.
- Changer les couleurs en dehors de la palette, ajouter dégradés, ombres, contours ou effets lumineux.
- Mettre le violet `#9810e6` directement sur fond sombre : utilise la version inversée.
- Changer la taille ou la position du symbole par rapport au nom.
- Ajouter des étoiles, ou remplacer les étoiles par des emoji ou des icônes.

## 8. Web et application

Les fichiers de `export/web/` sont prêts à copier à la racine d'un site ou dans l'application :
- `favicon.svg` : suit automatiquement le thème clair ou sombre du navigateur ;
- `favicon.ico` et `favicon-16/32/48.png` : tuile sombre, lisible sur tous les onglets ;
- `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` et `maskable-512.png` (Android, PWA, Flet) ;
- `site.webmanifest` et `head-snippet.html` : les balises à coller dans le `<head>`.

### Dans le README GitHub (bascule clair / sombre automatique)

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo/kit/svg/orion-horizontal-reversed.svg">
    <img alt="ORION" src="logo/kit/svg/orion-horizontal-color.svg" width="320">
  </picture>
</p>
```

### Variables CSS

```css
:root {
  --color-primary: #1a1919;
  --color-secondary: #9810e6;
  --color-secondary-on-dark: #b15cf0;
  --color-tertiary: #817d7d;
}
```

## 9. Avant de publier

- **Marque :** aucune vérification juridique n'a été faite. Lance une recherche d'antériorité (bases INPI, EUIPO, WIPO) et une recherche d'image inversée avant d'utiliser le logo publiquement.
- **Licence du logo :** dans un projet open source, le code est sous licence libre, mais le logo est souvent protégé à part. Ajoute au dépôt une courte politique de marque (`TRADEMARK.md`) qui précise qui peut utiliser le logo et comment.
