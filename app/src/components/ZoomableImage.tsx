import { useState } from 'react';
import { Image, type ImageSourcePropType, View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

/**
 * Image zoomable façon Photos : pincer pour zoomer (centré sous les doigts, jusqu'à ×5),
 * glisser pour se déplacer, double toucher pour zoomer là où l'on touche ou revenir à la vue entière.
 * Tout est calculé sur le thread UI (worklets) : aucune saccade, même sur une grande capture.
 */
const MAX = 5;
const DOUBLE = 2.5;
const SPRING = { damping: 22, stiffness: 240, mass: 0.9 };

export function ZoomableImage({ source, label }: { source: ImageSourcePropType; label?: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const w = useSharedValue(1);
  const h = useSharedValue(1);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const s0 = useSharedValue(1);
  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);

  /** Translation maximale pour que l'image zoomée ne quitte pas l'écran. */
  const bound = (s: number, len: number) => {
    'worklet';
    return Math.max(0, ((s - 1) * len) / 2);
  };
  const settle = () => {
    'worklet';
    if (scale.value <= 1.01) {
      scale.value = withSpring(1, SPRING);
      tx.value = withSpring(0, SPRING);
      ty.value = withSpring(0, SPRING);
      return;
    }
    if (scale.value > MAX) scale.value = withSpring(MAX, SPRING);
    const s = Math.min(scale.value, MAX);
    const bx = bound(s, w.value);
    const by = bound(s, h.value);
    tx.value = withSpring(Math.max(-bx, Math.min(bx, tx.value)), SPRING);
    ty.value = withSpring(Math.max(-by, Math.min(by, ty.value)), SPRING);
  };

  const pinch = usePinchGesture({
    onBegin: () => {
      'worklet';
      s0.value = scale.value;
      x0.value = tx.value;
      y0.value = ty.value;
    },
    onUpdate: (e) => {
      'worklet';
      // Léger dépassement autorisé (élastique), ramené ensuite par settle().
      const next = Math.max(0.8, Math.min(MAX * 1.2, s0.value * e.scale));
      const k = next / s0.value;
      // Le point sous les doigts reste sous les doigts.
      const fx = e.focalX - w.value / 2;
      const fy = e.focalY - h.value / 2;
      tx.value = fx - (fx - x0.value) * k;
      ty.value = fy - (fy - y0.value) * k;
      scale.value = next;
    },
    onDeactivate: () => {
      'worklet';
      settle();
    },
  });

  const pan = usePanGesture({
    minDistance: 4,
    onBegin: () => {
      'worklet';
      x0.value = tx.value;
      y0.value = ty.value;
    },
    onUpdate: (e) => {
      'worklet';
      if (scale.value <= 1.01) return;
      const bx = bound(scale.value, w.value);
      const by = bound(scale.value, h.value);
      // Au-delà des bords, résistance (rubber band) plutôt qu'un arrêt sec.
      const rub = (v: number, b: number) => (Math.abs(v) <= b ? v : Math.sign(v) * (b + (Math.abs(v) - b) * 0.35));
      tx.value = rub(x0.value + e.translationX, bx);
      ty.value = rub(y0.value + e.translationY, by);
    },
    onDeactivate: () => {
      'worklet';
      settle();
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      if (scale.value > 1.01) {
        scale.value = withTiming(1, { duration: 220 });
        tx.value = withTiming(0, { duration: 220 });
        ty.value = withTiming(0, { duration: 220 });
        return;
      }
      const fx = e.x - w.value / 2;
      const fy = e.y - h.value / 2;
      const bx = bound(DOUBLE, w.value);
      const by = bound(DOUBLE, h.value);
      scale.value = withTiming(DOUBLE, { duration: 240 });
      tx.value = withTiming(Math.max(-bx, Math.min(bx, -fx * (DOUBLE - 1))), { duration: 240 });
      ty.value = withTiming(Math.max(-by, Math.min(by, -fy * (DOUBLE - 1))), { duration: 240 });
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          w.value = width;
          h.value = height;
          setSize({ w: width, h: height });
        }}
        accessibilityLabel={label}
        accessibilityHint="Pincer pour zoomer, double toucher pour agrandir"
      >
        <Animated.View style={[{ width: size.w, height: size.h }, style]}>
          <Image source={source} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
