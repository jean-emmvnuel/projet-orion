import { useEffect, useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';

import { previewSplashSlow } from '@/dev/DevicePreview';
import { font, useTheme } from '@/theme';

/**
 * Ouverture : la ceinture d'Orion devient le logo ORION.
 *
 *  1. un ciel apparaît, les trois étoiles de la ceinture (Alnitak, Alnilam, Mintaka)
 *     s'allument une à une et scintillent ;
 *  2. les deux étoiles extérieures glissent sur la diagonale et deviennent les deux nœuds
 *     du « O réciproque », l'étoile centrale se fond au centre ;
 *  3. les arcs se dessinent à partir des nœuds, le logo fait un tour, le nom apparaît ;
 *  4. zoom à travers le logo vers l'app.
 *
 * La première image (p = START, ceinture allumée) est identique au splash natif
 * (assets/splash-belt-*.png) : aucun saut. L'apparition étoile par étoile (p < START)
 * sert si l'on rejoue l'animation depuis le début.
 */
export const SPLASH_SIZE = 220; // = imageWidth du plugin expo-splash-screen

const DURATION = 2000 * previewSplashSlow;
/** Point de départ : ceinture déjà allumée, comme sur le splash natif. */
const START = 0.3;

export const SPLASH_COLORS = {
  light: { bg: '#f4f2f7', arc: '#16131b', node: '#8a0fd1', star: '#3b1a66', glow: '#8a0fd1', sky: '#8f7fae' },
  dark: { bg: '#0b0a0e', arc: '#f5f3f8', node: '#b878f5', star: '#ffffff', glow: '#9d7bff', sky: '#cfc6ff' },
};

/** Positions dans une boîte de 256 (comme le logo). */
export const BELT = [
  { from: { x: 34, y: 60, r: 7 }, to: { x: 70.99, y: 70.99, r: 23.44 }, appear: 0.04 },
  { from: { x: 128, y: 123, r: 8.5 }, to: { x: 128, y: 128, r: 0 }, appear: 0.11 },
  { from: { x: 222, y: 194, r: 7 }, to: { x: 185.01, y: 185.01, r: 23.44 }, appear: 0.18 },
];
const ARCS = ['M70.99 70.99 A80.63 80.63 0 0 1 208.31 135.03', 'M185.01 185.01 A80.63 80.63 0 0 1 47.69 120.97'];
const ARC_LEN = 200; // ≈ 80.63 × 140° en radians

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
const ease = (v: number) => {
  'worklet';
  const x = clamp01(v);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Avancement local d'une phase [a, b] de la timeline. */
const phase = (p: number, a: number, b: number) => {
  'worklet';
  return clamp01((p - a) / (b - a));
};

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ───────────── Étoile de la ceinture → nœud du logo ───────────── */

function BeltStar({ i, p, colors }: { i: number; p: SharedValue<number>; colors: (typeof SPLASH_COLORS)['dark'] }) {
  const b = BELT[i];
  const glowProps = useAnimatedProps(() => {
    const on = ease(phase(p.value, b.appear, b.appear + 0.1));
    const twinkle = 1 + 0.28 * Math.sin(p.value * 38 + i * 2.1) * phase(p.value, 0.25, 0.32) * (1 - phase(p.value, 0.42, 0.5));
    const move = ease(phase(p.value, 0.45, 0.68));
    const r = interpolate(move, [0, 1], [b.from.r, Math.max(b.to.r, 2)]) * twinkle;
    return {
      cx: interpolate(move, [0, 1], [b.from.x, b.to.x]),
      cy: interpolate(move, [0, 1], [b.from.y, b.to.y]),
      r: r * 3.2 * on,
      opacity: on * (1 - phase(p.value, 0.62, 0.78)),
    };
  });
  const starProps = useAnimatedProps(() => {
    const on = ease(phase(p.value, b.appear, b.appear + 0.1));
    const twinkle = 1 + 0.22 * Math.sin(p.value * 38 + i * 2.1) * phase(p.value, 0.25, 0.32) * (1 - phase(p.value, 0.42, 0.5));
    const move = ease(phase(p.value, 0.45, 0.68));
    return {
      cx: interpolate(move, [0, 1], [b.from.x, b.to.x]),
      cy: interpolate(move, [0, 1], [b.from.y, b.to.y]),
      r: interpolate(move, [0, 1], [b.from.r, b.to.r]) * twinkle * on,
      opacity: on * (1 - phase(p.value, 0.6, 0.72)),
    };
  });
  // Le nœud violet du logo prend le relais de l'étoile.
  const nodeProps = useAnimatedProps(() => {
    const move = ease(phase(p.value, 0.45, 0.68));
    return {
      cx: interpolate(move, [0, 1], [b.from.x, b.to.x]),
      cy: interpolate(move, [0, 1], [b.from.y, b.to.y]),
      r: interpolate(move, [0, 1], [b.from.r, b.to.r]),
      opacity: phase(p.value, 0.56, 0.7),
    };
  });
  return (
    <>
      <AnimatedCircle animatedProps={glowProps} fill="url(#glow)" />
      {b.to.r > 0 ? <AnimatedCircle animatedProps={nodeProps} fill={colors.node} /> : null}
      <AnimatedCircle animatedProps={starProps} fill={colors.star} />
    </>
  );
}

function Arc({ d, p, color }: { d: string; p: SharedValue<number>; color: string }) {
  const props = useAnimatedProps(() => ({
    strokeDashoffset: ARC_LEN * (1 - ease(phase(p.value, 0.58, 0.82))),
    opacity: phase(p.value, 0.56, 0.6),
  }));
  return <AnimatedPath d={d} animatedProps={props} fill="none" stroke={color} strokeWidth={22.5} strokeLinecap="round" strokeDasharray={[ARC_LEN, ARC_LEN]} />;
}

function SkyStar({ x, y, r, delay, p, color }: { x: number; y: number; r: number; delay: number; p: SharedValue<number>; color: string }) {
  const props = useAnimatedProps(() => ({
    opacity: phase(p.value, delay, delay + 0.08) * (1 - phase(p.value, 0.5, 0.62)) * (0.45 + 0.35 * Math.sin(p.value * 30 + x)),
  }));
  return <AnimatedCircle cx={x} cy={y} r={r} fill={color} animatedProps={props} />;
}

/* ───────────── Superposition ───────────── */

export function SplashOverlay({ onReady, onDone }: { onReady: () => void; onDone: () => void }) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const colors = SPLASH_COLORS[isDark ? 'dark' : 'light'];

  const p = useSharedValue(START);
  const exit = useSharedValue(0);

  // Ciel : petites étoiles autour de la ceinture (dans une boîte élargie -100…356).
  const sky = useMemo(() => {
    const rand = seeded(42);
    return Array.from({ length: 26 }, () => ({ x: -100 + rand() * 456, y: -100 + rand() * 456, r: 0.6 + rand() * 1.4, delay: START + rand() * 0.08 }));
  }, []);

  useEffect(() => {
    if (reduced) {
      p.value = 1;
      exit.value = withDelay(300, withTiming(1, { duration: 300 }, (done) => done && scheduleOnRN(onDone)));
      return;
    }
    p.value = withTiming(1, { duration: DURATION, easing: Easing.linear });
    exit.value = withDelay(DURATION + 150, withTiming(1, { duration: 480, easing: Easing.bezier(0.4, 0, 1, 1) }, (done) => done && scheduleOnRN(onDone)));
  }, [reduced, p, exit, onDone]);

  const bgStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exit.value, [0, 0.7], [1, 0], 'clamp'),
    // Tour complet du logo une fois formé, puis zoom de sortie.
    transform: [{ scale: interpolate(exit.value, [0, 1], [1, 2.4]) }, { rotate: `${360 * ease(phase(p.value, 0.8, 1))}deg` }],
  }));
  const wordStyle = useAnimatedStyle(() => {
    const w = ease(phase(p.value, 0.82, 0.96));
    return { opacity: w * (1 - exit.value), transform: [{ translateY: interpolate(w, [0, 1], [8, 0]) }] };
  });

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onReady}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg }, bgStyle]} />
      <Animated.View style={logoStyle}>
        <Svg width={SPLASH_SIZE} height={SPLASH_SIZE} viewBox="0 0 256 256" style={{ overflow: 'visible' }}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.glow} stopOpacity={0.75} />
              <Stop offset="0.35" stopColor={colors.glow} stopOpacity={0.25} />
              <Stop offset="1" stopColor={colors.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {sky.map((st, k) => (
            <SkyStar key={k} {...st} p={p} color={colors.sky} />
          ))}
          <G>
            {ARCS.map((d) => (
              <Arc key={d} d={d} p={p} color={colors.arc} />
            ))}
            {BELT.map((_, i) => (
              <BeltStar key={i} i={i} p={p} colors={colors} />
            ))}
          </G>
        </Svg>
      </Animated.View>
      <View style={{ position: 'absolute', top: '50%', marginTop: SPLASH_SIZE / 2 + 12 }}>
        <Animated.View style={wordStyle}>
          <Text style={{ fontFamily: font.bold, fontSize: 22, letterSpacing: 6, color: colors.arc }}>ORION</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
