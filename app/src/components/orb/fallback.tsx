import { Platform, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEffect, useMemo, useRef, useState } from 'react';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import type { OrbSettings } from '@/theme/appearance';

import { buildGraph, COUNT } from './ConstellationOrb';

import type { OrbColors } from './palettes';

/** Skia sur le web a besoin de WebGL ; certains navigateurs (ou aperçus) ne l'ont pas. */
let webgl: boolean | undefined;
export function canUseSkia() {
  if (Platform.OS !== 'web') return true;
  if (webgl === undefined) {
    try {
      const cv = document.createElement('canvas');
      webgl = !!(cv.getContext('webgl2') || cv.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/**
 * Orbe de secours sans WebGL : halos concentriques et noyau qui pulsent avec la voix.
 * Moins riche que la version Skia, mais même comportement et même palette.
 */
export function FallbackOrb({ size, amplitude, colors }: { size: number; amplitude: SharedValue<number>; colors: OrbColors }) {
  const level = useSharedValue(0);
  const t = useSharedValue(0);
  useFrameCallback((f) => {
    'worklet';
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    const k = amplitude.value > level.value ? 18 : 5;
    level.value += (amplitude.value - level.value) * Math.min(1, k * dt);
    t.value += dt;
  });
  const halo = useAnimatedStyle(() => ({ transform: [{ scale: 0.9 + level.value * 0.18 + 0.03 * Math.sin(t.value * 2.2) }], opacity: 0.35 + level.value * 0.3 }));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 0.62 + level.value * 0.22 }, { rotate: `${t.value * 20}deg` }], opacity: 0.5 + level.value * 0.4 }));
  const core = useAnimatedStyle(() => ({ transform: [{ scale: 1 + level.value * 0.9 + 0.05 * Math.sin(t.value * 2.2) }] }));
  const disc = (d: number) => ({ position: 'absolute' as const, width: d, height: d, borderRadius: d / 2, left: (size - d) / 2, top: (size - d) / 2 });
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View style={[disc(size * 0.98), { backgroundImage: `radial-gradient(circle, ${colors.glow}ee 0%, ${colors.glow}55 35%, ${colors.glow}00 70%)` } as object, halo]} />
      <Animated.View style={[disc(size * 0.7), { borderWidth: 1, borderColor: colors.ray, borderStyle: 'dotted' }, ring]} />
      <Animated.View style={[disc(size * 0.52), { borderWidth: 1, borderColor: colors.particles[1], borderStyle: 'dotted' }, ring]} />
      <Animated.View style={[disc(size * 0.16), { backgroundColor: colors.core, boxShadow: `0 0 ${size * 0.12}px ${colors.core}` } as object, core]} />
    </View>
  );
}

/** Halo des bords de secours : liseré coloré qui apparaît et respire avec la voix. */
export function FallbackEdgeGlow({ visible, amplitude, colors }: { visible: boolean; amplitude: SharedValue<number>; colors: string[] }) {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, { duration: visible ? 380 : 520 });
  }, [visible, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.value, borderWidth: 2 + amplitude.value * 4 }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, borderRadius: 28, borderColor: colors[0] },
        { boxShadow: `inset 0 0 28px ${colors[1]}, 0 0 24px ${colors[0]}` } as object,
        style,
      ]}
    />
  );
}

/**
 * Constellation de secours (web sans WebGL) : même graphe que la version Skia,
 * dessiné en SVG. Plus lourde, réservée à l'aperçu web.
 */
export function FallbackConstellation({
  size,
  amplitude,
  colors,
  settings,
  yaw,
  pitch,
}: {
  size: number;
  amplitude: SharedValue<number>;
  colors: OrbColors;
  settings: OrbSettings;
  yaw: SharedValue<number>;
  pitch: SharedValue<number>;
}) {
  const g = useMemo(() => buildGraph(COUNT[settings.density]), [settings.density]);
  const [, setTick] = useState(0);
  const st = useRef({ t: 0, spin: 0, level: 0, last: 0 });
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const s = st.current;
      const dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 0.016;
      s.last = now;
      const target = amplitude.value;
      s.level += (target - s.level) * Math.min(1, (target > s.level ? 16 : 4.5) * dt);
      s.t += dt;
      s.spin += dt * settings.speed * (0.28 + s.level * 0.9);
      setTick((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [amplitude, settings.speed]);

  const { t, spin, level: a } = st.current;
  const c = size / 2;
  const R = size * 0.36;
  const ry = spin + yaw.value;
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const rx = 0.38 + 0.18 * Math.sin(t * 0.23) + pitch.value;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const px: number[] = [], py: number[] = [], pd: number[] = [];
  for (let i = 0; i < g.n; i++) {
    const s = 1 + a * 0.12 + Math.sin(t * 2.6 + g.phase[i]) * (0.015 + a * 0.05);
    const X = g.x[i] * s, Y = g.y[i] * s, Z = g.z[i] * s;
    const x1 = X * cy + Z * sy, z1 = -X * sy + Z * cy;
    const y2 = Y * cx - z1 * sx, z2 = Y * sx + z1 * cx;
    const p = 3.2 / (3.2 - z2);
    px.push(c + x1 * R * p);
    py.push(c + y2 * R * p);
    pd.push((z2 + 1.2) / 2.4);
  }
  let back = '', front = '', nodes = '';
  for (let e = 0; e < g.a.length; e++) {
    const i = g.a[e], j = g.b[e];
    const seg = `M${px[i].toFixed(1)},${py[i].toFixed(1)}L${px[j].toFixed(1)},${py[j].toFixed(1)}`;
    if ((pd[i] + pd[j]) / 2 < 0.5) back += seg;
    else front += seg;
  }
  for (let i = 0; i < g.n; i++) {
    const r = (0.9 + pd[i] * 1.2) * (size / 300);
    nodes += `M${(px[i] - r).toFixed(1)},${py[i].toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Defs>
        <RadialGradient id="cg" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colors.core} stopOpacity={0.9} />
          <Stop offset="0.25" stopColor={colors.glow} stopOpacity={0.55 + a * 0.3} />
          <Stop offset="1" stopColor={colors.glow} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={c} cy={c} r={size * 0.42} fill="url(#cg)" />
      <Path d={back} stroke={colors.ray} strokeOpacity={0.2} strokeWidth={0.6} fill="none" />
      <Path d={front} stroke={colors.ray} strokeOpacity={0.55 + a * 0.35} strokeWidth={0.9} fill="none" />
      <Path d={nodes} fill={colors.particles[2]} fillOpacity={0.85} />
    </Svg>
  );
}
