import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';

export type MicStatus = 'idle' | 'starting' | 'listening' | 'denied' | 'unavailable';

/**
 * Niveau réel du micro, écrit ~20 fois par seconde dans `level` (0 → 1).
 * L'orbe et le halo lisent cette valeur sur le thread UI et la lissent eux-mêmes.
 *
 * Détection de fin de phrase (VAD simple) : une fois que tu as commencé à parler,
 * 1,4 s de silence déclenche `onSilence`. Arrêt de sécurité au bout de 20 s.
 *
 * Rien n'est conservé : l'enregistrement sert seulement à mesurer le volume.
 */
export function useMicLevel(active: boolean, level: SharedValue<number>, onSilence?: () => void) {
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true });
  const [status, setStatus] = useState<MicStatus>('idle');
  const [seconds, setSeconds] = useState(0);
  const silenceCb = useRef(onSilence);
  silenceCb.current = onSilence;

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const started = Date.now();
    let spoke = false;
    let quietSince = 0;
    let noMeter = 0;

    (async () => {
      setStatus('starting');
      setSeconds(0);
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) {
          setStatus('denied');
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        setStatus('listening');

        timer = setInterval(() => {
          const st = recorder.getStatus();
          const db = st.metering;
          if (db === undefined || db === null) {
            // Pas de mesure (certains navigateurs) : on le signale après 1 s.
            if (++noMeter > 20) setStatus('unavailable');
            return;
          }
          // dBFS (-160 silence … 0 saturation) → 0…1, avec une courbe douce.
          const lin = Math.min(1, Math.max(0, (db + 52) / 44));
          const v = Math.pow(lin, 1.35);
          level.value = v;

          const now = Date.now();
          setSeconds(Math.floor((now - started) / 1000));
          if (v > 0.22) {
            spoke = true;
            quietSince = 0;
          } else if (spoke) {
            quietSince ||= now;
            if (now - quietSince > 1400) silenceCb.current?.();
          }
          if (now - started > 20000) silenceCb.current?.();
        }, 50);
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      level.value = 0;
      try {
        recorder.stop().catch(() => {});
      } catch {
        // jamais démarré
      }
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, [active, recorder, level]);

  return { status, seconds };
}
