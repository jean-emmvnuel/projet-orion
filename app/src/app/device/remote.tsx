import { Ionicons } from '@expo/vector-icons';
import { Canvas, Image as SkiaImage, Skia, type SkImage } from '@shopify/react-native-skia';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, TextInput, type TextInputInstance, useWindowDimensions, View } from 'react-native';
import { GestureDetector, useExclusiveGestures, useLongPressGesture, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { onRemote, remoteAck, remoteInput, type RemoteInput, type RemoteQuality, remoteStart, remoteStop, useDevice } from '@/api/live';
import { IconButton, type IconName, PressableScale, Segmented, tap } from '@/components/ui';
import { font, radius, space } from '@/theme';

/**
 * Bureau à distance : l'écran du PC en direct, et tout ce qu'il faut pour s'en servir.
 *
 *  - Écran : toucher = clic à cet endroit, double toucher = double-clic, appui long = clic droit,
 *    pincer = zoomer, glisser = défiler (ou déplacer la vue quand elle est zoomée).
 *  - Pavé tactile : glisser = déplacer la souris, toucher = clic, deux doigts = défiler / clic droit.
 *  - Clavier du téléphone et raccourcis (Échap, Tab, Ctrl+C…).
 */
const BG = '#050407';
const FG = '#f5f3f8';
const MUTED = 'rgba(245,243,248,0.6)';
const CHIP = 'rgba(255,255,255,0.1)';
const VIOLET = '#9810e6';

/** Balayages à trois doigts sur le pavé tactile → raccourcis du bureau. */
const THREE_FINGER: Record<string, string> = {
  'alt+tab': 'Fenêtre suivante',
  'alt+shift+tab': 'Fenêtre précédente',
  super: 'Vue des activités',
  'super+d': 'Afficher le bureau',
};

const SHORTCUTS: { label: string; combo: string; icon?: IconName }[] = [
  { label: 'Entrée', combo: 'enter', icon: 'return-down-back' },
  { label: 'Effacer', combo: 'backspace', icon: 'backspace-outline' },
  { label: 'Échap', combo: 'escape' },
  { label: 'Tab', combo: 'tab' },
  { label: '←', combo: 'left' },
  { label: '→', combo: 'right' },
  { label: '↑', combo: 'up' },
  { label: '↓', combo: 'down' },
  { label: 'Copier', combo: 'ctrl+c' },
  { label: 'Coller', combo: 'ctrl+v' },
  { label: 'Annuler', combo: 'ctrl+z' },
  { label: 'Tout', combo: 'ctrl+a' },
  { label: 'Fenêtres', combo: 'alt+tab' },
  { label: 'Activités', combo: 'super' },
  { label: 'Fermer', combo: 'alt+f4' },
];

export default function RemoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useDevice(id);
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [quality, setQuality] = useState<RemoteQuality>('equilibre');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [slow, setSlow] = useState(false);
  const [fps, setFps] = useState(0);
  const [pad, setPad] = useState(true);
  const [holding, setHolding] = useState(false);
  const [swipeHint, setSwipeHint] = useState<string | null>(null);
  const frame = useFrame();
  const frames = useRef(0);
  const input = useRef<TextInputInstance>(null);

  const send = useCallback((ev: RemoteInput) => id && remoteInput(id, ev), [id]);

  // Démarre le flux ; le relance si la qualité change ; l'arrête en quittant l'écran.
  useEffect(() => {
    if (!id) return;
    setError(null);
    setWaiting(true);
    const off = onRemote(id, {
      frame: (seq, data) => {
        frame.push(data);
        frames.current += 1;
        setWaiting(false);
        remoteAck(id, seq);
      },
      ready: (r) => setSize({ width: r.width, height: r.height }),
      error: (m) => setError(m),
    });
    remoteStart(id, quality).then((r) => !r.ok && setError(r.error ?? 'Impossible de joindre le PC.'));
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    const fpsTimer = setInterval(() => {
      setFps(frames.current);
      frames.current = 0;
    }, 1000);
    return () => {
      off();
      clearTimeout(slowTimer);
      clearInterval(fpsTimer);
      remoteStop(id);
    };
  }, [id, quality, frame]);

  // Les déplacements de souris sont regroupés (une émission toutes les ~16 ms).
  const move = useRef({ dx: 0, dy: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const queueMove = (dx: number, dy: number) => {
    const m = move.current;
    m.dx += dx;
    m.dy += dy;
    if (m.timer) return;
    m.timer = setTimeout(() => {
      if (m.dx || m.dy) send({ t: 'move', dx: m.dx, dy: m.dy });
      m.dx = m.dy = 0;
      m.timer = null;
    }, 16);
  };
  const scrollAcc = useRef(0);
  const queueScroll = (pixels: number) => {
    scrollAcc.current += pixels;
    const steps = Math.trunc(scrollAcc.current / 28);
    if (steps) {
      scrollAcc.current -= steps * 28;
      send({ t: 'scroll', dx: 0, dy: steps });
    }
  };

  /* ───────────── Écran : zoom, toucher, défilement ───────────── */
  const viewW = winW;
  const ratio = size ? size.height / size.width : 9 / 16;
  const viewH = Math.round(viewW * ratio);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const base = useRef({ scale: 1 });

  const clampPan = (s: number) => {
    const mx = ((s - 1) * viewW) / 2;
    const my = ((s - 1) * viewH) / 2;
    tx.value = Math.max(-mx, Math.min(mx, tx.value));
    ty.value = Math.max(-my, Math.min(my, ty.value));
  };
  /** Point touché à l'écran → position (0–1) sur l'écran du PC, zoom compris. */
  const toPc = (x: number, y: number) => {
    const s = scale.value;
    const qx = viewW / 2 + (x - viewW / 2 - tx.value) / s;
    const qy = viewH / 2 + (y - viewH / 2 - ty.value) / s;
    return { x: Math.max(0, Math.min(1, qx / viewW)), y: Math.max(0, Math.min(1, qy / viewH)) };
  };

  const pinch = usePinchGesture({
    runOnJS: true,
    onBegin: () => {
      base.current.scale = scale.value;
    },
    onUpdate: (e) => {
      scale.value = Math.max(1, Math.min(4, base.current.scale * e.scale));
      clampPan(scale.value);
    },
    onDeactivate: () => {
      if (scale.value < 1.05) {
        scale.value = withSpring(1);
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    },
  });
  const viewPan = usePanGesture({
    runOnJS: true,
    minDistance: 8,
    maxPointers: 1,
    onUpdate: (e) => {
      if (scale.value > 1.02) {
        tx.value += e.changeX;
        ty.value += e.changeY;
        clampPan(scale.value);
      } else {
        queueScroll(-e.changeY); // glisser vers le haut = descendre dans la page
      }
    },
    onDeactivate: () => {
      scrollAcc.current = 0;
    },
  });
  const viewTap = useTapGesture({
    runOnJS: true,
    onActivate: (e) => {
      tap('select');
      send({ t: 'tap', ...toPc(e.x, e.y) });
    },
  });
  const viewDouble = useTapGesture({
    runOnJS: true,
    numberOfTaps: 2,
    onActivate: (e) => {
      tap('light');
      send({ t: 'tap', ...toPc(e.x, e.y), double: true });
    },
  });
  const viewLong = useLongPressGesture({
    runOnJS: true,
    minDuration: 450,
    onActivate: (e) => {
      tap('medium');
      send({ t: 'tap', ...toPc(e.x, e.y), button: 'right' });
    },
  });
  const viewGesture = useExclusiveGestures(useSimultaneousGestures(pinch, viewPan), viewLong, viewDouble, viewTap);
  const viewStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));

  /* ───────────── Pavé tactile ───────────── */
  // Un seul geste pour le glissement : 1 doigt = souris, 2 doigts = défilement,
  // 3 doigts = balayage (fenêtres, Activités, bureau), comme un pavé tactile de portable.
  // (Des gestes séparés s'attendaient l'un l'autre : la souris ne bougeait qu'au relâchement.)
  const swipe = useRef({ fingers: 0, x: 0, y: 0 });
  const padPan = usePanGesture({
    runOnJS: true,
    minDistance: 2,
    maxPointers: 3,
    onBegin: () => {
      swipe.current = { fingers: 0, x: 0, y: 0 };
    },
    onUpdate: (e) => {
      const sw = swipe.current;
      sw.fingers = Math.max(sw.fingers, e.numberOfPointers);
      if (sw.fingers >= 3) {
        sw.x += e.changeX;
        sw.y += e.changeY;
      } else if (e.numberOfPointers >= 2) queueScroll(-e.changeY);
      else queueMove(e.changeX * 1.8, e.changeY * 1.8);
    },
    onDeactivate: () => {
      scrollAcc.current = 0;
      const { fingers, x, y } = swipe.current;
      if (fingers < 3 || Math.max(Math.abs(x), Math.abs(y)) < 40) return;
      const combo = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'alt+tab' : 'alt+shift+tab') : y < 0 ? 'super' : 'super+d';
      tap('medium');
      send({ t: 'key', combo });
      setSwipeHint(THREE_FINGER[combo]);
      setTimeout(() => setSwipeHint(null), 1400);
    },
  });
  const pad3Tap = useTapGesture({
    runOnJS: true,
    minPointers: 3,
    onActivate: () => {
      tap('light');
      send({ t: 'click', button: 'middle' });
      setSwipeHint('Clic du milieu');
      setTimeout(() => setSwipeHint(null), 1200);
    },
  });
  const padTap = useTapGesture({
    runOnJS: true,
    onActivate: () => {
      tap('select');
      send({ t: 'click' });
    },
  });
  const padRight = useTapGesture({
    runOnJS: true,
    minPointers: 2,
    onActivate: () => {
      tap('light');
      send({ t: 'click', button: 'right' });
    },
  });
  const padGesture = useExclusiveGestures(padPan, pad3Tap, padRight, padTap);

  /* ───────────── Clavier ───────────── */
  const [kbOpen, setKbOpen] = useState(false);
  const toggleKeyboard = () => {
    tap('select');
    if (kbOpen) input.current?.blur();
    else input.current?.focus();
  };

  const toggleHold = () => {
    tap('light');
    send({ t: holding ? 'up' : 'down' });
    setHolding(!holding);
  };

  const live = !waiting && !error;
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* En-tête */}
      <View style={{ paddingTop: insets.top + space.xs, paddingHorizontal: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <IconButton icon="close" label="Fermer l’écran du PC" tint={FG} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: FG, fontFamily: font.semibold, fontSize: 16 }} numberOfLines={1}>
            {device?.name ?? 'PC'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: live ? '#46d39a' : error ? '#ff6475' : '#f5b03a' }} />
            <Text style={{ color: MUTED, fontFamily: font.medium, fontSize: 12 }}>{error ? 'Interrompu' : live ? `En direct · ${fps} img/s` : 'Connexion…'}</Text>
          </View>
        </View>
      </View>
      <View style={{ paddingHorizontal: space.lg, marginTop: space.sm }}>
        <Segmented
          label="Qualité de l’image"
          value={quality}
          onChange={setQuality}
          options={[
            { value: 'fluide', label: 'Fluide' },
            { value: 'equilibre', label: 'Équilibré' },
            { value: 'net', label: 'Net' },
          ]}
        />
      </View>

      {/* Écran du PC */}
      <GestureDetector gesture={viewGesture}>
        <View style={{ width: viewW, height: viewH, marginTop: space.md, overflow: 'hidden', backgroundColor: '#000' }} accessibilityLabel="Écran du PC en direct">
          <Animated.View style={[{ width: viewW, height: viewH }, viewStyle]}>
            <LiveFrame frame={frame} width={viewW} height={viewH} />
          </Animated.View>
          {waiting || error ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
              {error ? (
                <>
                  <Ionicons name="alert-circle" size={28} color="#ff6475" />
                  <Text style={{ color: FG, fontFamily: font.medium, fontSize: 14, textAlign: 'center', marginTop: space.sm }}>{error}</Text>
                  <PressableScale onPress={() => router.replace({ pathname: '/device/remote', params: { id } })} style={{ marginTop: space.md, padding: space.sm }} accessibilityRole="button">
                    <Text style={{ color: '#c18cf7', fontFamily: font.semibold }}>Réessayer</Text>
                  </PressableScale>
                </>
              ) : (
                <>
                  <ActivityIndicator color={FG} />
                  {slow ? (
                    <Text style={{ color: MUTED, fontFamily: font.regular, fontSize: 13, textAlign: 'center', marginTop: space.md }}>
                      La première fois, accepte le partage d’écran et le contrôle à distance sur le PC.
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </View>
      </GestureDetector>
      <Text style={{ color: MUTED, fontFamily: font.regular, fontSize: 12, textAlign: 'center', marginTop: space.sm, paddingHorizontal: space.lg }}>
        Toucher = clic · double toucher = double-clic · appui long = clic droit · pincer = zoom · glisser = défiler
      </Text>

      {/* Pavé tactile */}
      {pad ? (
        <GestureDetector gesture={padGesture}>
          <View style={{ flex: 1, margin: space.lg, marginBottom: space.sm, borderRadius: radius.xl, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="finger-print-outline" size={26} color="rgba(255,255,255,0.25)" />
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontFamily: font.medium, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
              {swipeHint ?? 'Pavé tactile'}
              {'\n'}1 doigt : souris · toucher : clic · 2 doigts : défiler / clic droit{'\n'}3 doigts : ← → fenêtres · ↑ activités · ↓ bureau · toucher : clic du milieu
            </Text>
          </View>
        </GestureDetector>
      ) : (
        <View style={{ flex: 1 }} />
      )}

      {/* Barre d'outils : reste au-dessus du clavier */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
          {SHORTCUTS.map((k) => (
            <Pressable
              key={k.combo}
              onPress={() => {
                tap('select');
                send({ t: 'key', combo: k.combo });
              }}
              style={({ pressed }) => ({ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: pressed ? 'rgba(255,255,255,0.2)' : CHIP, flexDirection: 'row', alignItems: 'center', gap: 6 })}
              accessibilityRole="button"
              accessibilityLabel={`Touche ${k.label}`}
            >
              {k.icon ? <Ionicons name={k.icon} size={15} color={FG} /> : null}
              <Text style={{ color: FG, fontFamily: font.medium, fontSize: 13 }}>{k.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: Math.max(insets.bottom, space.md) }}>
          <ToolButton icon={kbOpen ? 'chevron-down' : 'keypad'} label={kbOpen ? 'Fermer' : 'Clavier'} active={kbOpen} onPress={toggleKeyboard} />
          <ToolButton icon="hand-left" label={holding ? 'Relâcher' : 'Maintenir'} active={holding} onPress={toggleHold} />
          <ToolButton icon="finger-print" label="Pavé" active={pad} onPress={() => setPad((v) => !v)} />
          <ToolButton
            icon="contract"
            label="Recadrer"
            onPress={() => {
              scale.value = withSpring(1);
              tx.value = withSpring(0);
              ty.value = withSpring(0);
            }}
          />
        </View>
      </KeyboardStickyView>

      {/* Champ invisible : le clavier du téléphone écrit directement sur le PC */}
      <TextInput
        ref={input}
        value=""
        onChangeText={(text) => text && send({ t: 'text', text })}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Backspace') send({ t: 'key', combo: 'backspace' });
        }}
        onSubmitEditing={() => send({ t: 'key', combo: 'enter' })}
        submitBehavior="submit"
        onFocus={() => setKbOpen(true)}
        onBlur={() => setKbOpen(false)}
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        keyboardAppearance="dark"
        style={{ position: 'absolute', left: -1000, width: 10, height: 10, opacity: 0 }}
        accessibilityLabel="Taper sur le PC"
      />
    </View>
  );
}

function ToolButton({ icon, label, active, onPress }: { icon: IconName; label: string; active?: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.94} style={{ flex: 1, height: 52, borderRadius: radius.md, backgroundColor: active ? VIOLET : CHIP, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={19} color={FG} />
      <Text style={{ color: FG, fontFamily: font.medium, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </PressableScale>
  );
}

/* ───────────── Dernière image reçue ───────────── */

type FrameStore = { push: (data: ArrayBuffer) => void; subscribe: (l: () => void) => () => void; current: () => ArrayBuffer | null };

/** Image courante hors état React de l'écran : seul le cadre vidéo se redessine. */
function useFrame(): FrameStore {
  const ref = useRef<FrameStore | null>(null);
  if (!ref.current) {
    let last: ArrayBuffer | null = null;
    const listeners = new Set<() => void>();
    ref.current = {
      push: (d) => {
        last = d;
        listeners.forEach((l) => l());
      },
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      current: () => last,
    };
  }
  return ref.current;
}

function LiveFrame({ frame, width, height }: { frame: FrameStore; width: number; height: number }) {
  return Platform.OS === 'web' ? <WebFrame frame={frame} width={width} height={height} /> : <NativeFrame frame={frame} width={width} height={height} />;
}

/** iOS / Android : décodage et affichage avec Skia, sans clignotement entre deux images. */
function NativeFrame({ frame, width, height }: { frame: FrameStore; width: number; height: number }) {
  const [img, setImg] = useState<SkImage | null>(null);
  useEffect(
    () =>
      frame.subscribe(() => {
        const buf = frame.current();
        if (!buf) return;
        const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(new Uint8Array(buf)));
        if (!decoded) return;
        // L'image précédente est libérée après l'affichage de la nouvelle (mémoire native).
        setImg((old) => {
          if (old) setTimeout(() => old.dispose?.(), 100);
          return decoded;
        });
      }),
    [frame],
  );
  if (!img) return null;
  return (
    <Canvas style={{ width, height }}>
      <SkiaImage image={img} x={0} y={0} width={width} height={height} fit="contain" />
    </Canvas>
  );
}

/** Web : URL d'objet par image (le navigateur garde l'image précédente jusqu'au décodage). */
function WebFrame({ frame, width, height }: { frame: FrameStore; width: number; height: number }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let prev: string | null = null;
    const off = frame.subscribe(() => {
      const buf = frame.current();
      if (!buf) return;
      const next = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      setUri(next);
      const old = prev;
      prev = next;
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    });
    return () => {
      off();
      if (prev) URL.revokeObjectURL(prev);
    };
  }, [frame]);
  if (!uri) return null;
  return <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />;
}
