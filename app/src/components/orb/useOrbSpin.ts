import { useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import { useFrameCallback, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { tap } from '@/components/ui';

/**
 * Rotation de l'orbe au doigt, façon objet physique :
 * - suivi 1:1 pendant le glissé (la sphère reste « collée » au doigt) ;
 * - au lâcher, la vitesse du doigt est transmise à la sphère, qui continue sur sa lancée
 *   puis ralentit (décroissance exponentielle, comme le défilement iOS) ;
 * - l'inclinaison verticale est bornée et revient doucement à l'horizontale ;
 * - un simple toucher (sans glisser) déclenche `onTap`.
 * Tout tourne sur le thread UI.
 */
export function useOrbSpin(size: number, onTap?: () => void) {
  const yaw = useSharedValue(0);
  const pitch = useSharedValue(0);
  const velYaw = useSharedValue(0);
  const velPitch = useSharedValue(0);
  const dragging = useSharedValue(false);
  const startYaw = useSharedValue(0);
  const startPitch = useSharedValue(0);
  const press = useSharedValue(0); // 0 → 1 : léger grossissement sous le doigt

  // Radians par point : un glissé sur toute la largeur de l'orbe ≈ un demi-tour.
  const k = Math.PI / Math.max(120, size);
  const PITCH_MAX = 1.1;

  useFrameCallback((f) => {
    'worklet';
    if (dragging.value) return;
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    yaw.value += velYaw.value * dt;
    pitch.value += velPitch.value * dt;
    velYaw.value *= Math.exp(-1.8 * dt); // longue inertie horizontale
    velPitch.value *= Math.exp(-5 * dt);
    // Retour doux vers l'horizontale + butée élastique.
    pitch.value += (0 - pitch.value) * Math.min(1, 1.2 * dt);
    if (pitch.value > PITCH_MAX) pitch.value = PITCH_MAX;
    if (pitch.value < -PITCH_MAX) pitch.value = -PITCH_MAX;
  });

  const pan = usePanGesture({
    minDistance: 6,
    onBegin: () => {
      'worklet';
      press.value = withSpring(1, { damping: 20, stiffness: 420 });
    },
    onActivate: () => {
      'worklet';
      dragging.value = true;
      velYaw.value = 0;
      velPitch.value = 0;
      startYaw.value = yaw.value;
      startPitch.value = pitch.value;
      scheduleOnRN(tap, 'light');
    },
    onUpdate: (e) => {
      'worklet';
      yaw.value = startYaw.value + e.translationX * k;
      const p = startPitch.value + e.translationY * k;
      // Résistance progressive au-delà de la butée (rubber-band).
      const over = Math.abs(p) - PITCH_MAX;
      pitch.value = over > 0 ? Math.sign(p) * (PITCH_MAX + (over * 0.55) / (1 + over)) : p;
    },
    onDeactivate: (e) => {
      'worklet';
      velYaw.value = e.velocityX * k;
      velPitch.value = e.velocityY * k * 0.6;
      dragging.value = false;
    },
    onFinalize: () => {
      'worklet';
      dragging.value = false;
      press.value = withSpring(0, { damping: 20, stiffness: 300 });
    },
  });

  const tapGesture = useTapGesture({
    onActivate: () => {
      'worklet';
      if (onTap) scheduleOnRN(onTap);
    },
  });

  const gesture = useExclusiveGestures(pan, tapGesture);

  return { yaw, pitch, press, gesture };
}
