/**
 * Thème ORION — palette officielle (Concept B) déclinée en clair et en sombre.
 * Encre #1a1919, Violet Orion #9810e6, Violet clair #b15cf0.
 *
 * Les composants lisent les couleurs via `useTheme()` et créent leurs styles avec
 * `makeStyles()`, qui recalcule seulement quand le mode change.
 */
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { Dimensions, ImageStyle, StyleSheet, TextStyle, useWindowDimensions, ViewStyle } from 'react-native';

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

import { useAppearance } from './appearance';

export type Palette = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  fill: string;
  fillStrong: string;
  separator: string;
  borderStrong: string;
  scrim: string;
  material: string; // teinte de repli des matières translucides
  text: string;
  textMuted: string;
  textFaint: string;
  violet: string;
  onViolet: string;
  accentText: string; // violet lisible comme texte sur le fond
  violetSoft: string;
  online: string;
  onlineSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  shadow: string;
};

export const dark: Palette = {
  bg: '#0b0a0e',
  surface: '#17151c',
  surfaceRaised: '#1f1c26',
  fill: 'rgba(235, 225, 255, 0.07)',
  fillStrong: 'rgba(235, 225, 255, 0.12)',
  separator: 'rgba(235, 225, 255, 0.09)',
  borderStrong: 'rgba(235, 225, 255, 0.16)',
  scrim: 'rgba(5, 3, 10, 0.72)',
  material: 'rgba(24, 21, 31, 0.72)',
  text: '#f5f3f8',
  textMuted: '#a7a1b2',
  textFaint: '#857f90',
  violet: '#9810e6',
  onViolet: '#ffffff',
  accentText: '#c18cf7',
  violetSoft: 'rgba(184, 120, 245, 0.16)',
  online: '#46d39a',
  onlineSoft: 'rgba(70, 211, 154, 0.14)',
  warning: '#f5b03a',
  warningSoft: 'rgba(245, 176, 58, 0.14)',
  danger: '#ff6475',
  dangerSoft: 'rgba(255, 100, 117, 0.15)',
  shadow: '#000000',
};

export const light: Palette = {
  bg: '#f4f2f7',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  fill: 'rgba(48, 22, 92, 0.06)',
  fillStrong: 'rgba(48, 22, 92, 0.10)',
  separator: 'rgba(48, 22, 92, 0.10)',
  borderStrong: 'rgba(48, 22, 92, 0.12)',
  scrim: 'rgba(244, 242, 247, 0.78)',
  material: 'rgba(255, 255, 255, 0.78)',
  text: '#16131b',
  textMuted: '#5c5566', // 7:1 sur bg
  textFaint: '#6f6879', // 5:1 sur bg
  violet: '#8a0fd1',
  onViolet: '#ffffff',
  accentText: '#7a12c4',
  violetSoft: 'rgba(138, 15, 209, 0.10)',
  online: '#0f9e66',
  onlineSoft: 'rgba(15, 158, 102, 0.12)',
  warning: '#b86e00',
  warningSoft: 'rgba(184, 110, 0, 0.12)',
  danger: '#d92c43',
  dangerSoft: 'rgba(217, 44, 67, 0.10)',
  shadow: '#2b1550',
};

/**
 * Échelle adaptative : la maquette de référence est l'iPhone 13 (390 × 844 pt).
 * Sur un écran plus petit (SE, petits Android) tout se resserre légèrement, sur un plus
 * grand (Pro Max, grands Android) tout respire un peu plus ; les tablettes sont plafonnées
 * (le contenu y garde de toute façon une largeur de lecture bornée).
 * Calculée une fois au lancement : l'app est verrouillée en portrait.
 */
const BASE = { width: 390, height: 844 };
const win = Dimensions.get('window');
const shortSide = Math.min(win.width, win.height) || BASE.width;
const longSide = Math.max(win.width, win.height) || BASE.height;
/** Rapport à l'iPhone 13, borné à [0,85 ; 1,12]. */
export const deviceScale = Math.min(1.12, Math.max(0.85, Math.min(shortSide / BASE.width, (longSide / BASE.height) * 1.05)));

/** Taille proportionnelle à l'écran (marges, icônes, composants). */
export const sc = (n: number) => Math.round(n * deviceScale);
/** Taille modérée (texte) : suit l'écran à moitié pour rester lisible partout. */
export const ms = (n: number, factor = 0.5) => Math.round((n + (n * deviceScale - n) * factor) * 2) / 2;

export const space = { xxs: 2, xs: sc(4), sm: sc(8), md: sc(12), lg: sc(16), xl: sc(24), xxl: sc(32), xxxl: sc(48) } as const;
export const radius = { sm: sc(10), md: sc(14), lg: sc(22), xl: sc(28), pill: 999 } as const;
/** Cible tactile minimale : 44 pt (Apple) / 48 dp (Material). */
export const touch = Platform.OS === 'android' ? 48 : 44;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** Échelle typographique : approche négative sur les grandes tailles, neutre sur le texte courant. */
export function typeFor(c: Palette) {
  return {
    largeTitle: { fontFamily: font.bold, fontSize: ms(34, 0.7), lineHeight: ms(40, 0.7), letterSpacing: -1.1, color: c.text },
    title: { fontFamily: font.bold, fontSize: ms(22), lineHeight: ms(28), letterSpacing: -0.5, color: c.text },
    headline: { fontFamily: font.semibold, fontSize: ms(17), lineHeight: ms(22), letterSpacing: -0.25, color: c.text },
    body: { fontFamily: font.regular, fontSize: ms(16), lineHeight: ms(23), letterSpacing: -0.1, color: c.text },
    callout: { fontFamily: font.medium, fontSize: ms(15), lineHeight: ms(20), letterSpacing: -0.1, color: c.text },
    subhead: { fontFamily: font.regular, fontSize: ms(14), lineHeight: ms(19), color: c.textMuted },
    footnote: { fontFamily: font.regular, fontSize: ms(13), lineHeight: ms(18), color: c.textMuted },
    caption: { fontFamily: font.medium, fontSize: ms(12), lineHeight: ms(16), letterSpacing: 0.1, color: c.textFaint },
    numeric: { fontFamily: font.semibold, fontVariant: ['tabular-nums' as const], color: c.text },
  } as const;
}
export type Type = ReturnType<typeof typeFor>;

const darkType = typeFor(dark);
const lightType = typeFor(light);

export function useTheme() {
  const { scheme } = useAppearance();
  const isDark = scheme === 'dark';
  return { c: isDark ? dark : light, t: isDark ? darkType : lightType, isDark };
}

/** Styles dépendants du thème, mémorisés par mode. */
export function makeStyles<T extends NamedStyles<T>>(fn: (c: Palette, t: Type) => T | NamedStyles<T>) {
  const cache: { dark?: T; light?: T } = {};
  return () => {
    const { isDark, c, t } = useTheme();
    return useMemo(() => {
      const key = isDark ? 'dark' : 'light';
      return (cache[key] ??= StyleSheet.create(fn(c, t) as T));
    }, [isDark, c, t]);
  };
}

/** Ressorts Reanimated (Apple : amortissement critique par défaut, rebond seulement après un geste à élan). */
export const springs = {
  press: { damping: 22, stiffness: 520, mass: 1 },
  settle: { damping: 26, stiffness: 240, mass: 1 },
  sheet: { damping: 20, stiffness: 200, mass: 1 },
  tab: { damping: 24, stiffness: 320, mass: 1 },
} as const;

/**
 * Classes de taille d'écran :
 * - `narrow` : téléphones étroits (iPhone SE 1re gén., petits Android) < 360 pt ;
 * - `short` : écrans courts (iPhone SE, 8) < 700 pt de haut ;
 * - `wide` : tablettes et grands écrans ≥ 700 pt de large.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  return { width, height, narrow: width < 360, short: height < 700, wide: width >= 700, gutter: width < 360 ? space.md : space.lg };
}
