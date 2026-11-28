import { BlurMask, Canvas, Circle, Group, Path, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { SharedValue, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { OrbSettings } from '@/theme/appearance';

import { ConstellationOrb } from './ConstellationOrb';
import { canUseSkia, FallbackConstellation, FallbackOrb } from './fallback';
import { forScheme, orbPalettes } from './palettes';
import { useOrbSpin } from './useOrbSpin';

/**
 * Orbe ORION en Skia — sphère d'énergie : particules en orbite 3D autour d'un noyau
 * incandescent, rayons qui jaillissent et halo flouté quand il parle.
 *
 * Tout le calcul image par image tourne en worklet sur le thread UI (Reanimated) :
 * aucun re-rendu React pendant l'animation, donc pas d'à-coups même si le JS est occupé.
 *
 * `amplitude` est une SharedValue (0 → 1) : micro, voix de synthèse ou simulation.
 */
export type OrbMode = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Props {
  size: number;
  amplitude: SharedValue<number>;
  mode: OrbMode;
  settings: OrbSettings;
  scheme: 'light' | 'dark';
  reducedMotion?: boolean;
  /** Toucher simple (sans glisser) sur l'orbe. */
  onTap?: () => void;
  /** Rotation au doigt (actif par défaut). */
  interactive?: boolean;
}

type Spin = { yaw: SharedValue<number>; pitch: SharedValue<number> };

const DENSITY = { legere: [5, 22], normale: [7, 30], dense: [10, 38] } as const;
const GAIN = { douce: 0.6, normale: 1, intense: 1.45 } as const;
const MODE_ID: Record<OrbMode, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function OrionOrb(props: Props) {
  const { yaw, pitch, press, gesture } = useOrbSpin(props.size, props.onTap);
  const grab = useAnimatedStyle(() => ({ transform: [{ scale: 1 + press.value * 0.04 }] }));
  const body = (
    <Animated.View style={[{ width: props.size, height: props.size }, grab]}>
      <OrbBody {...props} yaw={yaw} pitch={pitch} />
    </Animated.View>
  );
  if (props.interactive === false) return body;
  return <GestureDetector gesture={gesture}>{body}</GestureDetector>;
}

function OrbBody(props: Props & Spin) {
  const colors = forScheme(orbPalettes[props.settings.palette], props.scheme);
  const constellation = props.settings.style === 'constellation';
  if (!canUseSkia()) {
    return constellation ? (
      <FallbackConstellation size={props.size} amplitude={props.amplitude} colors={colors} settings={props.settings} yaw={props.yaw} pitch={props.pitch} />
    ) : (
      <FallbackOrb size={props.size} amplitude={props.amplitude} colors={colors} />
    );
  }
  if (constellation) {
    return (
      <ConstellationOrb
        size={props.size}
        amplitude={props.amplitude}
        modeId={MODE_ID[props.mode]}
        settings={props.settings}
        colors={colors}
        scheme={props.scheme}
        reducedMotion={props.reducedMotion ?? false}
        yaw={props.yaw}
        pitch={props.pitch}
      />
    );
  }
  return <SkiaOrb {...props} />;
}

function SkiaOrb({ size, amplitude, mode, settings, scheme, reducedMotion = false, yaw, pitch }: Props & Spin) {
  const colors = forScheme(orbPalettes[settings.palette], scheme);
  const [ringCount, perRing] = DENSITY[settings.density];

  // Géométrie figée (tableaux plats : copiés une fois vers le thread UI).
  const geo = useMemo(() => {
    const rand = seeded(11);
    const ring = { tiltX: [] as number[], tiltZ: [] as number[], spin: [] as number[] };
    for (let i = 0; i < ringCount; i++) {
      ring.tiltX.push(0.3 + rand() * 1.2);
      ring.tiltZ.push((i / ringCount) * Math.PI + rand() * 0.5);
      ring.spin.push((rand() > 0.5 ? 1 : -1) * (0.3 + rand() * 0.5));
    }
    const p = { ring: [] as number[], phase: [] as number[], speed: [] as number[], radius: [] as number[], jitter: [] as number[] };
    for (let r = 0; r < ringCount; r++) {
      for (let k = 0; k < perRing; k++) {
        p.ring.push(r);
        p.phase.push((k / perRing) * Math.PI * 2 + rand() * 0.25);
        p.speed.push(0.7 + rand() * 0.7);
        p.radius.push(0.5 + rand() * 0.45);
        p.jitter.push(rand());
      }
    }
    const rays = { angle: [] as number[], len: [] as number[], seed: [] as number[] };
    for (let i = 0; i < 24; i++) {
      rays.angle.push((i / 24) * Math.PI * 2 + rand() * 0.25);
      rays.len.push(0.45 + rand() * 0.55);
      rays.seed.push(rand() * 10);
    }
    return { ring, p, rays, count: ringCount * perRing };
  }, [ringCount, perRing]);

  const modeSv = useSharedValue(MODE_ID[mode]);
  useEffect(() => {
    modeSv.value = MODE_ID[mode];
  }, [mode, modeSv]);

  const speed = reducedMotion ? 0.3 : settings.speed;
  const gain = GAIN[settings.reactivity];
  const showRays = settings.rays && !reducedMotion;
  const showOrbits = settings.orbits;

  const level = useSharedValue(0);
  const t = useSharedValue(0);

  useFrameCallback((frame) => {
    'worklet';
    const dt = Math.min(0.05, (frame.timeSincePreviousFrame ?? 16) / 1000);
    const target = Math.min(1, amplitude.value * gain) * (reducedMotion ? 0.35 : 1);
    // Montée rapide, retombée douce : comme un VU-mètre.
    const k = target > level.value ? 18 : 5;
    level.value += (target - level.value) * Math.min(1, k * dt);
    const boost = modeSv.value === 2 ? 0.8 : 0;
    t.value += dt * speed * (0.55 + boost + level.value * 2.4);
  });

  const c = size / 2;
  const R = size * 0.33;
  const unit = size / 300;

  // Une seule passe de calcul par image → 3 couches de particules, rayons, orbites.
  const frame = useDerivedValue(() => {
    const time = t.value;
    const a = level.value;
    const idle = modeSv.value === 0;
    const breathe = idle ? 0.035 * Math.sin(time * 2.2) : 0;
    const spread = 1 + a * 0.3 + breathe;
    const b0 = Skia.PathBuilder.Make();
    const b1 = Skia.PathBuilder.Make();
    const b2 = Skia.PathBuilder.Make();
    for (let i = 0; i < geo.count; i++) {
      const r = geo.p.ring[i];
      const ang = geo.p.phase[i] + time * geo.p.speed[i] * geo.ring.spin[r];
      const wobble = 1 + 0.07 * Math.sin(time * 3 + geo.p.jitter[i] * 20) * (0.3 + a);
      const rad = R * geo.p.radius[i] * spread * wobble;
      const x = Math.cos(ang) * rad;
      const y0 = Math.sin(ang) * rad;
      const tx = geo.ring.tiltX[r] + pitch.value;
      const z = y0 * Math.sin(tx);
      const y = y0 * Math.cos(tx);
      const rz = geo.ring.tiltZ[r] + time * 0.12 + yaw.value;
      const px = c + x * Math.cos(rz) - y * Math.sin(rz);
      const py = c + x * Math.sin(rz) + y * Math.cos(rz);
      const depth = (z / R + 1) / 2;
      if (depth < 0.38) b0.addCircle(px, py, 0.75 * unit * (1 + a * 0.5));
      else if (depth < 0.68) b1.addCircle(px, py, 1.45 * unit * (1 + a * 0.5));
      else b2.addCircle(px, py, 2.2 * unit * (1 + a * 0.5));
    }
    const coreR = size * (0.07 + a * 0.065 + breathe * 0.4);
    const br = Skia.PathBuilder.Make();
    if (showRays) {
      for (let i = 0; i < geo.rays.angle.length; i++) {
        const flicker = 0.5 + 0.5 * Math.sin(time * 7 + geo.rays.seed[i] * 3);
        const len = R * (0.2 + geo.rays.len[i] * (0.25 + a * 1.25) * (0.35 + flicker * 0.65));
        const ang = geo.rays.angle[i] + time * 0.18;
        const inner = coreR * 1.15;
        br.moveTo(c + Math.cos(ang) * inner, c + Math.sin(ang) * inner);
        br.lineTo(c + Math.cos(ang) * (inner + len), c + Math.sin(ang) * (inner + len));
      }
    }
    const bo = Skia.PathBuilder.Make();
    if (showOrbits) {
      const rx = R * 1.02 * spread;
      for (let e = 0; e < 2; e++) {
        const rot = ((e === 0 ? 1 : -1) * time * 0.16 + (e === 0 ? -0.6 : 0.95));
        const ry = rx * (e === 0 ? 0.34 : 0.3);
        const rxx = rx * (e === 0 ? 1 : 0.94);
        for (let s = 0; s <= 64; s++) {
          const th = (s / 64) * Math.PI * 2;
          const ex = Math.cos(th) * rxx;
          const ey = Math.sin(th) * ry;
          const X = c + ex * Math.cos(rot) - ey * Math.sin(rot);
          const Y = c + ex * Math.sin(rot) + ey * Math.cos(rot);
          if (s === 0) bo.moveTo(X, Y);
          else bo.lineTo(X, Y);
        }
      }
    }
    return [b0.build(), b1.build(), b2.build(), br.build(), bo.build()];
  });

  const back = useDerivedValue(() => frame.value[0]);
  const mid = useDerivedValue(() => frame.value[1]);
  const front = useDerivedValue(() => frame.value[2]);
  const rays = useDerivedValue(() => frame.value[3]);
  const orbits = useDerivedValue(() => frame.value[4]);

  const coreR = useDerivedValue(() => {
    const idle = modeSv.value === 0;
    const think = modeSv.value === 2 ? 0.5 + 0.5 * Math.sin(t.value * 7) : 0;
    const breathe = idle ? 0.035 * Math.sin(t.value * 2.2) : 0;
    return size * (0.07 + level.value * 0.065 + breathe * 0.4 + think * 0.012);
  });
  const glowR = useDerivedValue(() => coreR.value * 2.8);
  const haloR = useDerivedValue(() => size * (0.46 + level.value * 0.05));
  const haloOpacity = useDerivedValue(() => (scheme === 'dark' ? 0.75 : 0.5) + level.value * 0.25);
  const rayOpacity = useDerivedValue(() => 0.15 + level.value * 0.6);
  const orbitOpacity = useDerivedValue(() => 0.22 + level.value * 0.3);
  const bloom = useDerivedValue(() => 3 + level.value * 6);

  const center = vec(c, c);

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Canvas style={{ width: size, height: size }}>
        <Circle cx={c} cy={c} r={haloR} opacity={haloOpacity}>
          <RadialGradient c={center} r={size * 0.5} colors={[colors.glow, `${colors.glow}44`, `${colors.glow}00`]} positions={[0, 0.42, 1]} />
        </Circle>

        {showOrbits ? <Path path={orbits} style="stroke" strokeWidth={1} color={colors.ray} opacity={orbitOpacity} /> : null}

        <Path path={back} color={colors.particles[0]} opacity={0.55} />
        {showRays ? (
          <Path path={rays} style="stroke" strokeWidth={1.3 * unit} strokeCap="round" color={colors.ray} opacity={rayOpacity}>
            <BlurMask blur={1.2} style="solid" />
          </Path>
        ) : null}
        <Path path={mid} color={colors.particles[1]} opacity={0.85} />

        {/* Bloom : le noyau et les particules avant brillent */}
        <Circle cx={c} cy={c} r={glowR} color={colors.glow} opacity={0.55}>
          <BlurMask blur={bloom} style="normal" />
        </Circle>
        <Circle cx={c} cy={c} r={coreR} color={colors.core}>
          <BlurMask blur={4} style="solid" />
        </Circle>
        <Group opacity={0.6}>
          <Path path={front} color={colors.particles[2]}>
            <BlurMask blur={3} style="normal" />
          </Path>
        </Group>
        <Path path={front} color={colors.particles[2]} />
      </Canvas>
    </View>
  );
}

/**
 * Enveloppe de voix simulée (syllabes, pauses) pour le design — utilisable en worklet.
 * En production : niveau réel du micro (expo-audio, metering) ou de la synthèse vocale.
 */
export function speechEnvelope(t: number, intensity = 1) {
  'worklet';
  const syllable = Math.max(0, Math.sin(t * 13.0)) * Math.max(0, Math.sin(t * 5.3 + 1.2));
  const phrase = 0.55 + 0.45 * Math.sin(t * 0.9);
  const grain = 0.15 * Math.sin(t * 41.0);
  return Math.max(0, Math.min(1, (syllable * 0.9 + grain) * phrase * intensity + 0.08));
}
