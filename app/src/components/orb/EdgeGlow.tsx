import { BlurMask, Canvas, Group, RoundedRect, SweepGradient, vec } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedValue, useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * Halo irisé qui court le long des bords de l'écran pendant l'échange (signature Siri).
 * Dégradé conique qui tourne, flou réel (BlurMask), épaisseur pilotée par la voix.
 * Entièrement sur le thread UI.
 */
import { canUseSkia, FallbackEdgeGlow } from './fallback';

type EdgeProps = { visible: boolean; amplitude: SharedValue<number>; colors: string[]; reducedMotion?: boolean };

export function EdgeGlow(props: EdgeProps) {
  return canUseSkia() ? <SkiaEdgeGlow {...props} /> : <FallbackEdgeGlow {...props} />;
}

function SkiaEdgeGlow({
  visible,
  amplitude,
  colors,
  reducedMotion,
}: {
  visible: boolean;
  amplitude: SharedValue<number>;
  colors: string[];
  reducedMotion?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const shown = useSharedValue(0);
  const angle = useSharedValue(0);
  const level = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, { duration: visible ? 380 : 520 });
  }, [visible, shown]);

  useFrameCallback((f) => {
    'worklet';
    if (shown.value === 0) return;
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    level.value += (amplitude.value - level.value) * Math.min(1, 10 * dt);
    if (!reducedMotion) angle.value = (angle.value + dt * (0.5 + level.value * 1.8)) % (Math.PI * 2);
  });

  const insets = useSafeAreaInsets();
  // Écran à coins arrondis (iPhone X et +) ⇔ home bar présente ; sinon coins carrés.
  const r = Platform.OS === 'web' ? 28 : insets.bottom > 0 ? 48 : 0;
  const k = useDerivedValue(() => 0.75 + level.value * 1.1);
  const wide = useDerivedValue(() => 22 * k.value);
  const mid = useDerivedValue(() => 9 * k.value);
  const blurWide = useDerivedValue(() => 14 * k.value);
  const transform = useDerivedValue(() => [{ rotate: angle.value }]);
  const origin = vec(width / 2, height / 2);

  const stroke = (w: SharedValue<number> | number, blur?: SharedValue<number> | number, opacity = 1) => (
    <RoundedRect x={0} y={0} width={width} height={height} r={r} style="stroke" strokeWidth={w} opacity={opacity}>
      <SweepGradient c={origin} colors={colors} transform={transform} origin={origin} />
      {blur ? <BlurMask blur={blur} style="normal" /> : null}
    </RoundedRect>
  );

  return (
    <Canvas style={{ position: 'absolute', top: 0, left: 0, width, height, zIndex: 20 }} pointerEvents="none">
      <Group opacity={shown}>
        {stroke(wide, blurWide, 0.55)}
        {stroke(mid, 5, 0.7)}
        {stroke(2.5, undefined, 1)}
      </Group>
    </Canvas>
  );
}
