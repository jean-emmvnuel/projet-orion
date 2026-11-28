import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeGlow } from '@/components/orb/EdgeGlow';
import { OrbMode, OrionOrb, speechEnvelope } from '@/components/orb/OrionOrb';
import { orbPalettes } from '@/components/orb/palettes';
import { IconButton, Material, OrionMark, OsGlyph, PressableScale, tap, useReducedMotion } from '@/components/ui';
import { useTargetDevice } from '@/api/live';
import { font, makeStyles, radius, space, springs, useLayout, useTheme } from '@/theme';
import { useAppearance } from '@/theme/appearance';
import { useMicLevel } from '@/hooks/useMicLevel';

/**
 * Conversation orale, sur le modèle d'interaction de Siri.
 * Toutes les animations (orbe, halo, ressorts, voix simulée) tournent sur le thread UI :
 * React ne re-rend que lorsqu'un mot apparaît.
 */
// Réponse de démonstration : la transcription et l'exécution réelles viendront avec l'agent PC.
const replyFor = (sec: number) =>
  `J'ai bien entendu ton message de ${Math.max(1, sec)} seconde${sec > 1 ? 's' : ''}. Bientôt, je le transcrirai et je l'exécuterai sur l'Atelier.`;

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done';
const PHASE_ID: Record<Phase, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3, done: 4 };

const ORB = 300;
const ORB_SMALL = 0.3;

export default function VoiceScreen() {
  // Mode vocal plein écran, ouvert depuis l'historique ou une conversation.
  const { width, height } = useWindowDimensions();
  const { narrow, short } = useLayout();
  const insets = useSafeAreaInsets();
  const tabInset = Math.max(insets.bottom, space.md);
  const reduced = useReducedMotion();
  const { c, t } = useTheme();
  const { orb, scheme } = useAppearance();
  const s = useStyles();

  const [phase, setPhase] = useState<Phase>('idle');
  const [orionWords, setOrionWords] = useState(0);
  const [heardSec, setHeardSec] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [orionLine, setOrionLine] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const device = useTargetDevice();
  const target = { name: device?.name ?? 'aucun PC', os: device?.os ?? 'linux', online: !!device?.online } as const;
  const orionTokens = orionLine ? orionLine.split(' ') : [];
  const active = phase !== 'idle';
  const live = phase === 'listening' || phase === 'thinking' || phase === 'speaking';

  // Niveau de voix : vrai micro pendant l'écoute, voix d'ORION simulée pendant la réponse.
  const amp = useSharedValue(0);
  const mic = useSharedValue(0);
  const micReal = useSharedValue(0);
  const phaseSv = useSharedValue(0);
  const clock = useSharedValue(0);
  useEffect(() => {
    phaseSv.value = PHASE_ID[phase];
  }, [phase, phaseSv]);
  useFrameCallback((f) => {
    'worklet';
    clock.value += (f.timeSincePreviousFrame ?? 16) / 1000;
    const p = phaseSv.value;
    amp.value = p === 1 ? (micReal.value ? mic.value : speechEnvelope(clock.value * 0.9, 0.55)) : p === 3 ? speechEnvelope(clock.value, 1) : p === 2 ? 0.16 : 0;
  });

  // Chorégraphie : ressorts critiques, interruptibles.
  const summon = useSharedValue(0);
  const card = useSharedValue(0);
  const result = useSharedValue(0);
  const dots = useSharedValue(0);
  useEffect(() => {
    const go = (v: SharedValue<number>, to: number, cfg: { damping: number; stiffness: number; mass: number }) => {
      v.value = reduced ? withTiming(to, { duration: 180 }) : withSpring(to, cfg);
    };
    go(summon, active ? 1 : 0, springs.sheet);
    go(card, phase === 'thinking' || phase === 'speaking' || phase === 'done' ? 1 : 0, springs.settle);
    go(result, 0, springs.settle); // pas de pièce jointe pour un message vocal (démo)
    dots.value = phase === 'thinking' ? withRepeat(withTiming(1, { duration: 900 }), -1, false) : 0;
    if (phase === 'done') tap('success');
  }, [phase, active, orionWords, reduced, summon, card, result, dots]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const listeningRef = useRef(false);
  const startedAt = useRef(0);

  const finishListening = () => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    const sec = Math.round((Date.now() - startedAt.current) / 1000);
    setHeardSec(sec);
    const line = replyFor(sec);
    setOrionLine(line);
    tap('light');
    setPhase('thinking');
    const words = line.split(' ');
    later(1200, () => setPhase('speaking'));
    words.forEach((_, i) => later(1350 + i * 230, () => setOrionWords(i + 1)));
    later(1350 + words.length * 230 + 400, () => setPhase('done'));
  };

  const run = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    tap('medium');
    setMicError(null);
    setOrionWords(0);
    setOrionLine('');
    setHeardSec(0);
    listeningRef.current = true;
    startedAt.current = Date.now();
    setPhase('listening');
  };

  const dismiss = () => {
    timers.current.forEach(clearTimeout);
    listeningRef.current = false;
    tap('light');
    setPhase('idle');
    setOrionWords(0);
  };

  // Micro réel : l'orbe suit ta voix ; 1,4 s de silence termine l'écoute.
  const { status: micStatus, seconds } = useMicLevel(phase === 'listening', mic, finishListening);
  useEffect(() => {
    micReal.value = micStatus === 'listening' ? 1 : 0;
    if (micStatus === 'denied') {
      listeningRef.current = false;
      setPhase('idle');
      setMicError('ORION n’a pas accès au micro. Autorise-le dans les Réglages du téléphone.');
    }
    if (micStatus === 'unavailable') {
      // Pas de niveau sonore (ex. navigateur) : écoute simulée de 4 s.
      later(4000, finishListening);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micStatus]);

  // Orbe : grande en haut au repos → petite en bas au centre pendant l'échange.
  // Orbe au repos : plus petite sur les écrans courts, plafonnée sur tablette.
  const restSize = Math.min(width - space.xl * 2, height * (short ? 0.36 : 0.42), 360);
  const restY = insets.top + 56 + restSize / 2;
  const liveY = height - tabInset - 64;
  const restScale = restSize / ORB;
  const orbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(summon.value, [0, 1], [restY - ORB / 2, liveY - ORB / 2]) },
      { scale: interpolate(summon.value, [0, 1], [restScale, ORB_SMALL]) },
    ],
  }));
  const idleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(summon.value, [0, 0.6], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(summon.value, [0, 1], [1, 0.94]) }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: summon.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: card.value,
    transform: [{ translateY: interpolate(card.value, [0, 1], [-28, 0]) }, { scale: interpolate(card.value, [0, 1], [0.96, 1]) }],
  }));
  const resultStyle = useAnimatedStyle(() => ({
    opacity: result.value,
    height: interpolate(result.value, [0, 1], [0, 214], 'clamp'),
    transform: [{ translateY: interpolate(result.value, [0, 1], [10, 0]) }],
  }));

  const orbMode: OrbMode = phase === 'done' ? 'idle' : phase;

  return (
    <View style={s.root}>
      {/* Contenu au repos : s'efface et recule quand ORION est appelé */}
      <Animated.View pointerEvents={active ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, idleStyle]}>
        {/* Marge haute calculée (pas SafeAreaView) : sous un fondu/zoom plein écran, celui-ci mesure 0. */}
        <View style={{ flex: 1, paddingTop: insets.top }}>
          <View style={s.top}>
            <IconButton icon="close" label="Fermer le mode vocal" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            <PressableScale onPress={() => router.push('/appareils')} accessibilityRole="button" accessibilityLabel={`Appareil ciblé : ${target.name}. Changer`} style={s.target}>
              <OsGlyph os={target.os} size={28} />
              <View style={{ marginLeft: space.sm, marginRight: space.xs }}>
                <Text style={[t.callout, { fontFamily: font.semibold, fontSize: 14 }]}>{target.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[s.dot, { backgroundColor: target.online ? c.online : c.textFaint }]} />
                  <Text style={[t.caption, { color: c.textMuted }]}>{target.online ? 'En ligne' : 'Hors ligne'}</Text>
                </View>
              </View>
              <Ionicons name="chevron-down" size={14} color={c.textMuted} />
            </PressableScale>
            <IconButton icon="color-palette-outline" label="Personnaliser l’animation d’ORION" onPress={() => router.push('/personnaliser')} />
          </View>

          <View style={{ height: restSize + space.lg + 8 }} />

          <View style={s.idle}>
            <Text style={[s.prompt, (narrow || short) && { fontSize: 22, lineHeight: 28 }]} accessibilityRole="header">
              Que fait-on sur{'\n'}
              <Text style={{ color: c.accentText }}>{target.name}</Text> ?
            </Text>
            <Text style={[s.hint, micError && { color: c.danger }]}>{micError ?? 'Touche l’orbe ou le micro, puis parle.'}</Text>
          </View>
        </View>

        <View style={[s.dock, { bottom: tabInset + space.sm }]}>
          <Material style={s.inputBar} intensity={60}>
            <PressableScale accessibilityRole="button" accessibilityLabel="Écrire à ORION" style={s.inputField} scaleTo={0.98} haptic={false} onPress={() => router.replace('/conversation/nouvelle')}>
              <Text style={[t.body, { color: c.textFaint }]}>Demander à ORION…</Text>
            </PressableScale>
            <PressableScale onPress={run} haptic={false} accessibilityRole="button" accessibilityLabel="Parler à ORION" style={s.mic} scaleTo={0.88}>
              <Ionicons name="mic" size={22} color={c.onViolet} />
            </PressableScale>
          </Material>
        </View>
      </Animated.View>

      {/* Voile : assombrit (ou éclaircit) l'écran pendant l'échange ; un toucher ferme ORION */}
      <Animated.View pointerEvents={active ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, scrimStyle]}>
        <Pressable style={s.scrim} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Fermer ORION" />
      </Animated.View>

      {/* Carte réponse : descend du haut, matière de verre */}
      <Animated.View pointerEvents={active ? 'box-none' : 'none'} style={[s.cardWrap, { top: insets.top + space.sm }, cardStyle]}>
        <Material style={s.card} intensity={80}>
          <View style={s.cardHead}>
            <OrionMark size={18} />
            <Text style={[t.caption, { color: c.textMuted, marginLeft: space.sm, fontFamily: font.semibold }]}>ORION · {target.name}</Text>
          </View>
          {phase === 'thinking' ? (
            <View style={s.thinking} accessibilityLabel="ORION réfléchit">
              {[0, 1, 2].map((i) => (
                <ThinkDot key={i} index={i} progress={dots} color={c.accentText} />
              ))}
            </View>
          ) : (
            <Text style={s.answer} accessibilityLiveRegion="polite">
              {orionTokens.map((w, i) => (
                <Text key={i} style={{ color: i < orionWords ? c.text : 'transparent' }}>
                  {w}{' '}
                </Text>
              ))}
            </Text>
          )}

          <Animated.View style={[{ overflow: 'hidden' }, resultStyle]}>
            <View style={s.preview}>
              <View style={s.previewBar}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={s.previewDot} />
                ))}
              </View>
              <View style={[s.previewWindow, { left: '6%', top: '28%', width: '50%', height: '56%' }]} />
              <View style={[s.previewWindow, { left: '40%', top: '40%', width: '52%', height: '50%', backgroundColor: 'rgba(184,120,245,0.3)' }]} />
            </View>
            <View style={s.resultMeta}>
              <Text style={[t.footnote, { flex: 1 }]}>1920 × 1080 · 412 Ko</Text>
              <PressableScale accessibilityRole="button" accessibilityLabel="Partager la capture" style={s.metaButton} scaleTo={0.88}>
                <Ionicons name="share-outline" size={17} color={c.text} />
              </PressableScale>
              <PressableScale accessibilityRole="button" accessibilityLabel="Enregistrer la capture" style={[s.metaButton, { marginLeft: space.sm }]} scaleTo={0.88}>
                <Ionicons name="arrow-down" size={17} color={c.text} />
              </PressableScale>
            </View>
          </Animated.View>
        </Material>
      </Animated.View>

      {/* État de l'écoute, au-dessus de l'orbe */}
      <Animated.View pointerEvents="none" style={[s.heard, { bottom: tabInset + 120 }, scrimStyle]}>
        {phase === 'listening' ? (
          <>
            <Text style={s.heardText}>{micStatus === 'starting' ? 'Ouverture du micro…' : 'Je t’écoute…'}</Text>
            <Text style={[t.footnote, { marginTop: space.xs, fontVariant: ['tabular-nums'] }]}>
              {micStatus === 'unavailable' ? 'Micro sans mesure sur cet appareil : écoute simulée' : `${seconds} s · touche l’orbe quand tu as fini`}
            </Text>
          </>
        ) : heardSec > 0 ? (
          <View style={s.voiceChip}>
            <Ionicons name="mic" size={14} color={c.textMuted} />
            <Text style={[t.footnote, { marginLeft: 6 }]}>Message vocal · {heardSec} s</Text>
          </View>
        ) : null}
      </Animated.View>

      {/* L'orbe. Toucher = parler / arrêter ; glisser = la faire tourner. */}
      <Animated.View style={[s.orb, { left: width / 2 - ORB / 2 }, orbStyle]}>
        <View accessible accessibilityRole="button" accessibilityLabel={phase === 'listening' ? 'J’ai fini de parler' : active ? 'Arrêter ORION' : 'Parler à ORION. Glisse pour faire tourner l’orbe'} accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => (phase === 'listening' ? finishListening() : active ? dismiss() : run())}>
          <OrionOrb size={ORB} amplitude={amp} mode={orbMode} settings={orb} scheme={scheme} reducedMotion={reduced} onTap={phase === 'listening' ? finishListening : active ? dismiss : run} />
        </View>
      </Animated.View>

      {orb.edgeGlow ? <EdgeGlow visible={live} amplitude={amp} colors={orbPalettes[orb.palette].iris} reducedMotion={reduced} /> : null}
    </View>
  );
}

/** Point de « réflexion » : vague décalée, sur le thread UI. */
function ThinkDot({ index, progress, color }: { index: number; progress: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const v = Math.sin((progress.value - index * 0.18) * Math.PI * 2);
    return { opacity: 0.35 + 0.65 * Math.max(0, v), transform: [{ translateY: -3 * Math.max(0, v) }] };
  });
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 6 }, style]} />;
}

const useStyles = makeStyles((c, t) => ({
  root: { flex: 1, backgroundColor: c.bg, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.sm },
  target: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingLeft: 6, paddingRight: space.md, borderRadius: radius.pill, backgroundColor: c.fill },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  idle: { alignItems: 'center', paddingHorizontal: space.xl },
  prompt: { ...t.title, fontSize: 26, lineHeight: 32, letterSpacing: -0.7, textAlign: 'center' },
  hint: { ...t.subhead, textAlign: 'center', marginTop: space.md },
  dock: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 20, alignItems: 'center' },
  inputBar: { width: '100%', maxWidth: 420, flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, padding: 6, paddingLeft: space.lg, overflow: 'hidden', borderWidth: 0.5, borderColor: c.borderStrong },
  inputField: { flex: 1, minHeight: 44, justifyContent: 'center' },
  mic: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.violet, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: c.scrim },
  cardWrap: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center' },
  card: { width: '100%', maxWidth: 560, borderRadius: radius.xl, padding: space.lg, overflow: 'hidden', borderWidth: 0.5, borderColor: c.borderStrong },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  answer: { fontFamily: font.medium, fontSize: 19, lineHeight: 26, letterSpacing: -0.3, color: c.text },
  thinking: { flexDirection: 'row', height: 26, alignItems: 'center' },
  preview: { height: 150, backgroundColor: '#1b1030', borderRadius: radius.lg, overflow: 'hidden', marginTop: space.lg },
  previewBar: { height: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.35)' },
  previewDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginRight: 4 },
  previewWindow: { position: 'absolute', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.10)' },
  resultMeta: { flexDirection: 'row', alignItems: 'center', marginTop: space.md },
  metaButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  heard: { position: 'absolute', left: space.xl, right: space.xl, alignItems: 'center' },
  voiceChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.fill },
  heardText: { fontFamily: font.semibold, fontSize: 22, lineHeight: 29, letterSpacing: -0.5, textAlign: 'center', maxWidth: 480 },
  orb: { position: 'absolute', top: 0, width: ORB, height: ORB },
}));
