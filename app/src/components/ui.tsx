import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { ReactNode, useEffect, useState } from 'react';
import { Platform, Pressable, PressableProps, ScrollView, StyleProp, Switch, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion as useRMReduced, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import type { CommandStatus, Os } from '@/api/types';

export type DeviceState = 'online' | 'sleeping' | 'offline';
import { font, makeStyles, radius, space, springs, touch, useTheme } from '@/theme';

const android = Platform.OS === 'android';

export type IconName = keyof typeof Ionicons.glyphMap;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/* ───────────────────────── Système ───────────────────────── */

/** Respecte le réglage « Réduire les animations » du système. */
export const useReducedMotion = useRMReduced;

/** Retour haptique discret, sans effet sur le web. */
export function tap(kind: 'select' | 'light' | 'medium' | 'success' | 'warning' = 'select') {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'select'
      ? Haptics.selectionAsync()
      : kind === 'success'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === 'warning'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          : Haptics.impactAsync(kind === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
  run.catch(() => {});
}

/* ───────────────────────── Marque ───────────────────────── */

/** Symbole ORION « Le O réciproque » (assets/logo-symbol.svg). */
export function OrionMark({ size = 28 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 256 256">
        <Path d="M67.19 67.19 A86 86 0 0 1 213.67 135.50" fill="none" stroke={c.text} strokeWidth={24} strokeLinecap="round" />
        <Circle cx={67.19} cy={67.19} r={25} fill={c.accentText} />
        <Path d="M188.81 188.81 A86 86 0 0 1 42.33 120.50" fill="none" stroke={c.text} strokeWidth={24} strokeLinecap="round" />
        <Circle cx={188.81} cy={188.81} r={25} fill={c.accentText} />
      </Svg>
    </View>
  );
}

/* ───────────────────────── Matières & mise en page ───────────────────────── */

/** Liquid Glass natif (iOS 26+). Vérifié une seule fois. */
const liquidGlass = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
export const hasLiquidGlass = liquidGlass;

/**
 * Matière translucide (barres, boutons flottants, cartes de réponse).
 * - iPhone sous iOS 26+ : vrai Liquid Glass (réfraction, reflets, réaction au toucher) — par défaut ;
 * - iPhone plus ancien / web : flou de matière ;
 * - Android : surface quasi opaque.
 */
export function Material({
  children,
  style,
  intensity = 40,
  interactive,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  /** Le verre réagit au toucher (boutons). */
  interactive?: boolean;
}) {
  const { c, isDark } = useTheme();
  if (liquidGlass) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  }
  if (android) {
    // Material 3 : surface tonale opaque (surfaceContainerHigh), sans flou.
    return <View style={[{ backgroundColor: isDark ? '#221e2a' : '#f7f2fb' }, style]}>{children}</View>;
  }
  return (
    <BlurView intensity={intensity} tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'} style={[{ backgroundColor: c.material }, style]}>
      {children}
    </BlurView>
  );
}

/** Écran défilant : marges sûres, largeur de lecture bornée, place pour la barre flottante. */
export function Screen({ children, inStack = false }: { children: ReactNode; inStack?: boolean }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: inStack ? 0 : insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + space.xxl }]} showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic">
        <View style={s.screenInner}>{children}</View>
      </ScrollView>
    </View>
  );
}

export function LargeHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const { t } = useTheme();
  const s = useStyles();
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={t.largeTitle} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[t.subhead, { marginTop: space.xs }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionHeader({ children, action }: { children: string; action?: ReactNode }) {
  const { t } = useTheme();
  const s = useStyles();
  return (
    <View style={s.sectionHeader}>
      <Text style={[t.headline, { fontSize: 15 }]} accessibilityRole="header">
        {children}
      </Text>
      {action}
    </View>
  );
}

/* ───────────────────────── Interaction ───────────────────────── */

/**
 * Pressable qui répond à l'appui (pas au relâchement) avec un ressort critique,
 * calculé sur le thread UI et interruptible : il repart toujours de la valeur affichée.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  haptic = 'select',
  onPress,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: Parameters<typeof tap>[0] | false;
  children: ReactNode;
}) {
  const { c } = useTheme();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // Android (Material) : l'onde de toucher porte le retour, la réduction reste discrète.
  const to = android ? 1 - (1 - scaleTo) / 2 : scaleTo;
  return (
    <AnimatedPressable
      android_ripple={android ? { color: c.fillStrong, foreground: true } : undefined}
      {...rest}
      style={[style, anim, android && { overflow: 'hidden' }]}
      onPressIn={(e) => {
        scale.value = withSpring(to, springs.press);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, springs.press);
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tap(haptic);
        onPress?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

export function IconButton({ icon, onPress, label, tint }: { icon: IconName; onPress?: () => void; label: string; tint?: string }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={[s.iconButton, liquidGlass && { backgroundColor: 'transparent' }]} scaleTo={0.9}>
      {liquidGlass ? (
        <Material interactive style={{ width: touch, height: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={20} color={tint ?? c.text} />
        </Material>
      ) : (
        <Ionicons name={icon} size={20} color={tint ?? c.text} />
      )}
    </PressableScale>
  );
}

/**
 * Garde une fenêtre modale ouverte le temps de son animation de sortie : le contenu
 * disparaît tout de suite (ce qui déclenche `exiting`), la Modal se ferme juste après.
 */
export function useModalPresence(visible: boolean, exitMs = 240) {
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const tm = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(tm);
  }, [visible, exitMs]);
  return mounted;
}

/* ───────────────────────── Statuts ───────────────────────── */

export function useStateMeta() {
  const { c } = useTheme();
  return {
    online: { label: 'En ligne', color: c.online, soft: c.onlineSoft },
    sleeping: { label: 'En veille', color: c.warning, soft: c.warningSoft },
    offline: { label: 'Hors ligne', color: c.textMuted, soft: c.fill },
  } satisfies Record<DeviceState, { label: string; color: string; soft: string }>;
}

export function StatePill({ state }: { state: DeviceState }) {
  const m = useStateMeta()[state];
  const s = useStyles();
  return (
    <View style={[s.pill, { backgroundColor: m.soft }]}>
      <View style={[s.dot, { backgroundColor: m.color }]} />
      <Text style={[s.pillText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

const osIcon: Record<Os, IconName> = { linux: 'logo-tux', macos: 'logo-apple', windows: 'logo-windows' };

export function OsGlyph({ os, size = 44, tint }: { os: Os; size?: number; tint?: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: tint ?? c.fillStrong, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name={osIcon[os]} size={size * 0.5} color={c.text} />
    </View>
  );
}

export function StatusIcon({ status }: { status: CommandStatus }) {
  const { c } = useTheme();
  const m =
    status === 'done'
      ? { icon: 'checkmark-circle' as IconName, color: c.online, label: 'Terminé' }
      : status === 'failed' || status === 'timeout'
        ? { icon: 'alert-circle' as IconName, color: c.danger, label: status === 'timeout' ? 'Sans réponse' : 'Échec' }
        : { icon: 'ellipsis-horizontal-circle' as IconName, color: c.accentText, label: 'En cours' };
  return <Ionicons name={m.icon} size={18} color={m.color} accessibilityLabel={m.label} />;
}

/* ───────────────────────── Données ───────────────────────── */

/** Mesure : grand chiffre + jauge fine. `higherIsBetter` pour la batterie (pleine = vert). */
export function Meter({ label, value, higherIsBetter }: { label: string; value: number | null; higherIsBetter?: boolean }) {
  const { c, t } = useTheme();
  const s = useStyles();
  const v = value ?? 0;
  const load = higherIsBetter ? 100 - v : v;
  const tone = load >= 85 ? c.danger : load >= 70 ? c.warning : higherIsBetter ? c.online : c.accentText;
  return (
    <View style={{ flex: 1 }} accessible accessibilityLabel={`${label} ${value === null ? 'indisponible' : `${v} pour cent`}`}>
      <Text style={[t.caption, { color: c.textMuted }]}>{label}</Text>
      <Text style={[t.numeric, { fontSize: 22, letterSpacing: -0.6, marginTop: 2 }]}>
        {value === null ? '—' : v}
        {value === null ? null : <Text style={{ fontSize: 13, color: c.textMuted, fontFamily: font.medium }}> %</Text>}
      </Text>
      <View style={s.track}>
        <View style={[s.fill, { width: `${v}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}

/* ───────────────────────── Listes groupées ───────────────────────── */

export function InsetList({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.inset}>{children}</View>;
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  last,
  label,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  label?: string;
}) {
  const { c, t } = useTheme();
  const s = useStyles();
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              tap('select');
              onPress();
            }
          : undefined
      }
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      android_ripple={onPress ? { color: c.fillStrong } : undefined}
      style={({ pressed }) => [s.row, pressed && !android && { backgroundColor: c.fill }]}
    >
      {leading}
      <View style={[s.rowBody, !last && s.rowDivider, { marginLeft: leading ? space.md : 0 }]}>
        <View style={{ flex: 1 }}>
          <Text style={t.callout} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing}
      </View>
    </Pressable>
  );
}

/** Ligne avec interrupteur (réglages). */
export function SwitchRow({ title, subtitle, value, onChange, last }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const { c } = useTheme();
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      last={last}
      trailing={
        <Switch
          value={value}
          onValueChange={(v) => {
            tap('select');
            onChange(v);
          }}
          trackColor={{ true: c.violet, false: c.fillStrong }}
          thumbColor="#ffffff"
          accessibilityLabel={title}
        />
      }
    />
  );
}

/** Contrôle segmenté : la pastille glisse avec un ressort vers l'option choisie. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const width = useSharedValue(0);
  const x = useSharedValue(index);
  useEffect(() => {
    x.value = withSpring(index, springs.tab);
  }, [index, x]);
  const pill = useAnimatedStyle(() => ({
    width: width.value / options.length - 4,
    transform: [{ translateX: (x.value * width.value) / options.length }],
  }));
  return (
    <View
      style={s.segmented}
      onLayout={(e) => {
        width.value = e.nativeEvent.layout.width - 4;
      }}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      <Animated.View style={[s.segmentPill, pill]} />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            style={s.segment}
            android_ripple={{ color: c.fillStrong, borderless: false }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap('select');
              onChange(o.value);
            }}
          >
            <Text style={[s.segmentText, { color: on ? c.text : c.textMuted, fontFamily: on ? font.semibold : font.medium }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ───────────────────────── Contrôles (façon Centre de contrôle) ───────────────────────── */

/** Bouton rond : action ponctuelle (capture, verrouiller, son…). */
export function ControlButton({ icon, label, onPress, disabled, danger }: { icon: IconName; label: string; onPress?: () => void; disabled?: boolean; danger?: boolean }) {
  const { c, t } = useTheme();
  const s = useStyles();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      haptic={danger ? 'warning' : 'light'}
      scaleTo={0.9}
      style={[s.control, disabled && { opacity: 0.35 }]}
    >
      <View style={[s.controlCircle, { backgroundColor: danger ? c.dangerSoft : c.surface }]}>
        <Ionicons name={icon} size={24} color={danger ? c.danger : c.text} />
      </View>
      <Text style={[t.caption, { color: c.textMuted, marginTop: space.sm, textAlign: 'center' }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Grand module : action principale avec un état lisible. */
export function ControlModule({ icon, title, value, onPress, disabled, accent }: { icon: IconName; title: string; value: string; onPress?: () => void; disabled?: boolean; accent?: boolean }) {
  const { c, t } = useTheme();
  const s = useStyles();
  const fg = accent ? c.onViolet : c.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value}`}
      disabled={disabled}
      onPress={onPress}
      haptic="light"
      scaleTo={0.97}
      style={[s.module, accent && { backgroundColor: c.violet }, disabled && { opacity: 0.35 }]}
    >
      <View style={[s.moduleIcon, { backgroundColor: accent ? 'rgba(255,255,255,0.2)' : c.fillStrong }]}>
        <Ionicons name={icon} size={20} color={fg} />
      </View>
      <View style={{ marginTop: space.lg }}>
        <Text style={[t.callout, { fontFamily: font.semibold, color: fg }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[t.footnote, accent && { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </PressableScale>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: {},
  screenInner: { paddingHorizontal: space.lg, paddingTop: space.sm, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.md, marginBottom: space.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xxl, marginBottom: space.md, paddingHorizontal: space.xs },
  iconButton: { width: touch, height: touch, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill, marginLeft: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontFamily: font.semibold, fontSize: 12 },
  track: { height: 4, borderRadius: 2, backgroundColor: c.fillStrong, overflow: 'hidden', marginTop: space.sm },
  fill: { height: '100%', borderRadius: 2 },
  inset: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, minHeight: 60 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingVertical: space.md, paddingRight: space.lg },
  rowDivider: { borderBottomWidth: 0.5, borderBottomColor: c.separator },
  control: { width: '25%', alignItems: 'center', paddingVertical: space.sm },
  controlCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  module: { flex: 1, backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg, minHeight: 128 },
  moduleIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', backgroundColor: c.fill, borderRadius: radius.md, padding: 2, minHeight: 40 },
  segmentPill: { position: 'absolute', top: 2, bottom: 2, left: 4, borderRadius: radius.md - 2, backgroundColor: c.surfaceRaised, shadowColor: c.shadow, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40, paddingHorizontal: 4 },
  segmentText: { fontSize: 13 },
}));
