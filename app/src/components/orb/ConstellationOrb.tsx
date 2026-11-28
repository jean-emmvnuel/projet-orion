import { BlurMask, Canvas, Circle, Group, Path, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { SharedValue, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { OrbSettings } from '@/theme/appearance';

import type { OrbColors } from './palettes';

/**
 * Orbe « Constellation » — sphère en réseau (plexus) : des nœuds répartis sur et dans
 * une boule en 3D, reliés à leurs plus proches voisins par des fils lumineux, autour
 * d'un cœur incandescent. La sphère tourne, respire et se hérisse quand ORION parle.
 *
 * Calcul image par image en worklet (thread UI), dessin Skia en 6 tracés.
 */
interface Props {
  size: number;
  amplitude: SharedValue<number>;
  modeId: number; // 0 repos, 1 écoute, 2 réflexion, 3 parole
  settings: OrbSettings;
  colors: OrbColors;
  scheme: 'light' | 'dark';
  reducedMotion: boolean;
  yaw: SharedValue<number>;
  pitch: SharedValue<number>;
}

export const COUNT = { legere: 120, normale: 190, dense: 280 } as const;
const GAIN = { douce: 0.6, normale: 1, intense: 1.45 } as const;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Nœuds (coquille + intérieur) et liaisons vers les plus proches voisins, calculés une fois. */
export function buildGraph(shell: number) {
  const rand = seeded(7);
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const phase: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < shell; i++) {
    const yy = 1 - (i / (shell - 1)) * 2;
    const rr = Math.sqrt(1 - yy * yy);
    const th = golden * i;
    const r = 0.86 + rand() * 0.2; // bord irrégulier, comme dans la vidéo
    x.push(Math.cos(th) * rr * r);
    y.push(yy * r);
    z.push(Math.sin(th) * rr * r);
    phase.push(rand() * Math.PI * 2);
  }
  const inner = Math.round(shell * 0.6);
  for (let i = 0; i < inner; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    const r = Math.pow(rand(), 0.7) * 0.82; // plus dense vers le centre
    x.push(Math.cos(th) * rr * r);
    y.push(u * r);
    z.push(Math.sin(th) * rr * r);
    phase.push(rand() * Math.PI * 2);
  }
  const n = x.length;
  const a: number[] = [];
  const b: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const near: [number, number][] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      const dz = z[i] - z[j];
      near.push([dx * dx + dy * dy + dz * dz, j]);
    }
    near.sort((p, q) => p[0] - q[0]);
    const k = i < shell ? 5 : 4;
    for (let m = 0; m < k; m++) {
      const j = near[m][1];
      const key = i < j ? i * 10000 + j : j * 10000 + i;
      if (!seen.has(key) && near[m][0] < 0.2) {
        seen.add(key);
        a.push(i);
        b.push(j);
      }
    }
  }
  return { x, y, z, phase, n, a, b };
}

export function ConstellationOrb({ size, amplitude, modeId, settings, colors, scheme, reducedMotion, yaw, pitch }: Props) {
  const g = useMemo(() => buildGraph(COUNT[settings.density]), [settings.density]);

  const mode = useSharedValue(modeId);
  useEffect(() => {
    mode.value = modeId;
  }, [modeId, mode]);

  const speed = reducedMotion ? 0.3 : settings.speed;
  const gain = GAIN[settings.reactivity];
  const spikes = settings.rays && !reducedMotion;

  const level = useSharedValue(0);
  const t = useSharedValue(0);
  const spin = useSharedValue(0);

  useFrameCallback((f) => {
    'worklet';
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    const target = Math.min(1, amplitude.value * gain) * (reducedMotion ? 0.35 : 1);
    const k = target > level.value ? 16 : 4.5;
    level.value += (target - level.value) * Math.min(1, k * dt);
    t.value += dt;
    // Rotation : lente au repos, plus vive en réflexion et quand il parle.
    const boost = mode.value === 2 ? 1.4 : 0;
    spin.value += dt * speed * (0.28 + boost + level.value * 0.9);
  });

  const c = size / 2;
  const R = size * 0.36;
  const unit = size / 300;

  const frame = useDerivedValue(() => {
    const time = t.value;
    const a = level.value;
    const idle = mode.value === 0;
    const breathe = idle ? 0.025 * Math.sin(time * 1.8) : 0;
    const ry = spin.value + yaw.value;
    const rx = 0.38 + 0.18 * Math.sin(time * 0.23) + pitch.value;
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const focal = 3.2;

    const px: number[] = new Array(g.n);
    const py: number[] = new Array(g.n);
    const pd: number[] = new Array(g.n);
    for (let i = 0; i < g.n; i++) {
      // Respiration + hérissement : chaque nœud s'écarte selon sa phase et la voix.
      const wob = Math.sin(time * 2.6 + g.phase[i]);
      const spike = spikes ? Math.max(0, Math.sin(time * 5.2 + g.phase[i] * 3)) * a * 0.22 : 0;
      const s = 1 + breathe + a * 0.12 + wob * (0.015 + a * 0.05) + spike;
      const X = g.x[i] * s;
      const Y = g.y[i] * s;
      const Z = g.z[i] * s;
      // rotation Y puis X
      const x1 = X * cy + Z * sy;
      const z1 = -X * sy + Z * cy;
      const y2 = Y * cx - z1 * sx;
      const z2 = Y * sx + z1 * cx;
      const persp = focal / (focal - z2);
      px[i] = c + x1 * R * persp;
      py[i] = c + y2 * R * persp;
      pd[i] = (z2 + 1.2) / 2.4; // 0 fond → 1 devant
    }

    const l0 = Skia.PathBuilder.Make();
    const l1 = Skia.PathBuilder.Make();
    const l2 = Skia.PathBuilder.Make();
    for (let e = 0; e < g.a.length; e++) {
      const i = g.a[e];
      const j = g.b[e];
      const d = (pd[i] + pd[j]) / 2;
      const target = d < 0.4 ? l0 : d < 0.62 ? l1 : l2;
      target.moveTo(px[i], py[i]);
      target.lineTo(px[j], py[j]);
    }
    const n0 = Skia.PathBuilder.Make();
    const n1 = Skia.PathBuilder.Make();
    for (let i = 0; i < g.n; i++) {
      if (pd[i] < 0.5) n0.addCircle(px[i], py[i], 0.9 * unit);
      else n1.addCircle(px[i], py[i], (1.2 + pd[i] * 1.1) * unit * (1 + a * 0.4));
    }
    return [l0.build(), l1.build(), l2.build(), n0.build(), n1.build()];
  });

  const linesBack = useDerivedValue(() => frame.value[0]);
  const linesMid = useDerivedValue(() => frame.value[1]);
  const linesFront = useDerivedValue(() => frame.value[2]);
  const nodesBack = useDerivedValue(() => frame.value[3]);
  const nodesFront = useDerivedValue(() => frame.value[4]);

  const glow = useDerivedValue(() => 0.55 + level.value * 0.4 + (mode.value === 2 ? 0.15 * Math.sin(t.value * 6) : 0));
  const coreR = useDerivedValue(() => size * (0.1 + level.value * 0.06));
  const bloom = useDerivedValue(() => 10 + level.value * 14);
  const frontOpacity = useDerivedValue(() => 0.6 + level.value * 0.35);
  const dark = scheme === 'dark';
  const line = dark ? colors.ray : colors.glow;

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Canvas style={{ width: size, height: size }}>
        {/* Halo de fond */}
        <Circle cx={c} cy={c} r={size * 0.5} opacity={dark ? 0.45 : 0.3}>
          <RadialGradient c={vec(c, c)} r={size * 0.5} colors={[`${colors.glow}aa`, `${colors.glow}22`, `${colors.glow}00`]} positions={[0, 0.5, 1]} />
        </Circle>

        <Path path={linesBack} style="stroke" strokeWidth={0.6 * unit} color={line} opacity={0.18} />
        <Path path={nodesBack} color={colors.particles[1]} opacity={0.45} />
        <Path path={linesMid} style="stroke" strokeWidth={0.8 * unit} color={line} opacity={0.38} />

        {/* Cœur incandescent */}
        <Group opacity={glow}>
          <Circle cx={c} cy={c} r={coreR} color={colors.glow}>
            <BlurMask blur={bloom} style="normal" />
          </Circle>
          <Circle cx={c} cy={c} r={size * 0.05} color={colors.core}>
            <BlurMask blur={8} style="normal" />
          </Circle>
        </Group>

        {/* Avant : fils et nœuds nets + léger bloom */}
        <Group opacity={frontOpacity}>
          <Path path={linesFront} style="stroke" strokeWidth={1 * unit} color={line}>
            <BlurMask blur={1.5} style="solid" />
          </Path>
          <Path path={nodesFront} color={colors.particles[2]}>
            <BlurMask blur={2} style="solid" />
          </Path>
        </Group>
      </Canvas>
    </View>
  );
}
