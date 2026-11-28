import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { runCommand } from '@/api/live';
import { font, makeStyles, radius, space, useTheme } from '@/theme';

import { IconName, PressableScale, tap, useModalPresence } from './ui';

/* ───────────── Lecture en cours + volume ───────────── */

interface MediaState {
  player: string | null;
  playing: boolean | null;
  title: string | null;
  artist: string | null;
}

/** Télécommande multimédia : morceau en cours, lecture/pause, pistes, volume. */
export function MediaRemote({ deviceId, online, onError }: { deviceId: string; online: boolean; onError: (msg: string) => void }) {
  const { c, t } = useTheme();
  const s = useStyles();
  const [media, setMedia] = useState<MediaState | null>(null);
  const [vol, setVol] = useState<{ level: number | null; muted: boolean | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!online) return;
    try {
      const [m, v] = await Promise.all([runCommand(deviceId, 'media', { op: 'status' }), runCommand(deviceId, 'volume', { op: 'status' })]);
      setMedia(m.result as MediaState);
      setVol(v.result as { level: number | null; muted: boolean | null });
    } catch {
      // Silencieux : la télécommande reste utilisable.
    }
  }, [deviceId, online]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const send = async (key: string, action: 'media' | 'volume', op: string) => {
    setBusy(key);
    tap('light');
    try {
      const cmd = await runCommand(deviceId, action, { op });
      if (action === 'media') setMedia(cmd.result as MediaState);
      else setVol(cmd.result as { level: number | null; muted: boolean | null });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Échec');
    } finally {
      setBusy(null);
    }
  };

  const Btn = ({ k, icon, action, op, big }: { k: string; icon: IconName; action: 'media' | 'volume'; op: string; big?: boolean }) => (
    <PressableScale onPress={() => send(k, action, op)} disabled={!online || !!busy} style={[s.mBtn, big && s.mBig, !online && { opacity: 0.35 }]} scaleTo={0.88} haptic={false} accessibilityRole="button" accessibilityLabel={k}>
      {busy === k ? <ActivityIndicator size="small" color={big ? c.onViolet : c.text} /> : <Ionicons name={icon} size={big ? 28 : 22} color={big ? c.onViolet : c.text} />}
    </PressableScale>
  );

  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={s.art}>
          <Ionicons name={media?.playing ? 'musical-notes' : 'musical-note'} size={22} color={c.accentText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={t.callout} numberOfLines={1}>
            {media?.title ?? (media?.player ? `${media.player}` : 'Rien en lecture')}
          </Text>
          <Text style={t.footnote} numberOfLines={1}>
            {media?.artist ?? (media?.player ? (media.playing ? 'En lecture' : 'En pause') : 'Lance un média sur le PC ou depuis les fichiers')}
          </Text>
        </View>
        <Pressable onPress={refresh} hitSlop={10} accessibilityLabel="Actualiser la lecture en cours">
          <Ionicons name="refresh" size={18} color={c.textMuted} />
        </Pressable>
      </View>
      <View style={s.mRow}>
        <Btn k="Précédent" icon="play-skip-back" action="media" op="previous" />
        <Btn k="Lecture / pause" icon={media?.playing ? 'pause' : 'play'} action="media" op="play-pause" big />
        <Btn k="Suivant" icon="play-skip-forward" action="media" op="next" />
      </View>
      <View style={s.vRow}>
        <Btn k="Moins fort" icon="volume-low" action="volume" op="down" />
        <View style={{ flex: 1 }}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${vol?.level ?? 0}%`, backgroundColor: vol?.muted ? c.textFaint : c.accentText }]} />
          </View>
          <Text style={[t.caption, { textAlign: 'center', marginTop: 4 }]}>{vol?.muted ? 'Muet' : vol?.level != null ? `Volume ${vol.level} %` : 'Volume'}</Text>
        </View>
        <Btn k="Plus fort" icon="volume-high" action="volume" op="up" />
        <Btn k="Muet" icon={vol?.muted ? 'volume-mute' : 'volume-off'} action="volume" op="toggle" />
      </View>
    </View>
  );
}

/* ───────────── Saisie rapide (texte à copier, lien à ouvrir) ───────────── */

export function PromptSheet({
  visible,
  title,
  placeholder,
  action,
  keyboardType,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  action: string;
  keyboardType?: 'default' | 'url';
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (visible) setValue('');
  }, [visible]);
  return (
    <Modal visible={useModalPresence(visible)} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {visible ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={s.scrim}>
            <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Fermer" />
          </Animated.View>
          <Animated.View entering={SlideInDown.springify().damping(22)} exiting={SlideOutDown.duration(180)} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
            <View style={s.grabber} />
            <Text style={[t.headline, { marginBottom: space.md }]}>{title}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={c.textFaint}
              autoFocus
              multiline={keyboardType !== 'url'}
              keyboardType={keyboardType === 'url' ? 'url' : 'default'}
              autoCapitalize={keyboardType === 'url' ? 'none' : 'sentences'}
              autoCorrect={keyboardType !== 'url'}
              style={s.promptInput}
            />
            <PressableScale
              onPress={() => {
                if (value.trim()) onSubmit(value.trim());
              }}
              disabled={!value.trim()}
              style={[s.promptBtn, !value.trim() && { opacity: 0.5 }]}
              accessibilityRole="button"
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 16, color: c.onViolet }}>{action}</Text>
            </PressableScale>
          </Animated.View>
        </KeyboardAvoidingView>
      ) : null}
    </Modal>
  );
}

/* ───────────── Presse-papiers récupéré ───────────── */

export function ClipboardResult({ text, onClose }: { text: string; onClose: () => void }) {
  const { c, t } = useTheme();
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
        <Ionicons name="clipboard" size={16} color={c.accentText} />
        <Text style={[t.caption, { marginLeft: 6, flex: 1, fontFamily: font.semibold }]}>Presse-papiers du PC</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Fermer">
          <Ionicons name="close" size={18} color={c.textMuted} />
        </Pressable>
      </View>
      <Text style={t.body} selectable numberOfLines={12}>
        {text || '(vide)'}
      </Text>
      <PressableScale
        onPress={async () => {
          await Clipboard.setStringAsync(text);
          setCopied(true);
          tap('success');
        }}
        style={[s.promptBtn, { marginTop: space.md, backgroundColor: c.fill }]}
        accessibilityRole="button"
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 15, color: copied ? c.online : c.accentText }}>{copied ? 'Copié sur le téléphone' : 'Copier sur le téléphone'}</Text>
      </PressableScale>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg, marginTop: space.lg },
  art: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' },
  mRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, marginTop: space.lg },
  vRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  mBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  mBig: { width: 62, height: 62, borderRadius: 31, backgroundColor: c.violet },
  track: { height: 6, borderRadius: 3, backgroundColor: c.fillStrong, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8, 5, 14, 0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, maxWidth: 560, alignSelf: 'center', width: '100%' },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.fillStrong, marginBottom: space.lg },
  promptInput: { minHeight: 52, maxHeight: 160, borderRadius: radius.md, backgroundColor: c.fill, padding: space.md, fontFamily: font.regular, fontSize: 16, color: c.text },
  webField: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.fill, borderRadius: radius.md, paddingHorizontal: space.md, height: 48 },
  webInput: { flex: 1, fontFamily: font.regular, fontSize: 15, color: c.text },
  webGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm, marginTop: space.md },
  webBtn: { width: '23%', height: 46, borderRadius: radius.md, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  promptBtn: { height: 50, borderRadius: radius.pill, backgroundColor: c.violet, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
}));

/* ───────────── Navigation web (Google, onglets, retour…) ───────────── */

const WEB_OPS: { op: string; icon: IconName; label: string }[] = [
  { op: 'back', icon: 'arrow-back', label: 'Retour' },
  { op: 'forward', icon: 'arrow-forward', label: 'Suivant' },
  { op: 'reload', icon: 'refresh', label: 'Actualiser' },
  { op: 'newtab', icon: 'add', label: 'Nouvel onglet' },
  { op: 'nexttab', icon: 'swap-horizontal', label: 'Onglet suivant' },
  { op: 'closetab', icon: 'close', label: 'Fermer l’onglet' },
  { op: 'pagedown', icon: 'chevron-down', label: 'Descendre' },
  { op: 'pageup', icon: 'chevron-up', label: 'Monter' },
];

/** Chercher sur Google et piloter le navigateur du PC, sans quitter l'app. */
export function WebRemote({ deviceId, online, onDone, onError }: { deviceId: string; online: boolean; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const { c } = useTheme();
  const s = useStyles();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, params: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try {
      await runCommand(deviceId, 'web', params);
      tap('success');
      onDone(ok);
    } catch (e) {
      tap('warning');
      onError(e instanceof Error ? e.message : 'Échec');
    } finally {
      setBusy(null);
    }
  };
  const search = () => {
    const v = q.trim();
    if (!v) return;
    const isUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v) && !v.includes(' ');
    run('search', isUrl ? { op: 'url', url: v } : { op: 'search', q: v }, isUrl ? `${v} s’ouvre sur le PC` : `Recherche Google ouverte : « ${v} »`);
    setQ('');
  };

  return (
    <View style={s.card}>
      <View style={s.webField}>
        <Ionicons name="logo-google" size={17} color={c.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Rechercher sur Google ou taper une adresse"
          placeholderTextColor={c.textFaint}
          style={s.webInput}
          returnKeyType="search"
          onSubmitEditing={search}
          autoCorrect={false}
          autoCapitalize="none"
          editable={online}
          accessibilityLabel="Recherche Google sur le PC"
        />
        {busy === 'search' ? (
          <ActivityIndicator size="small" color={c.accentText} />
        ) : (
          <Pressable onPress={search} disabled={!q.trim() || !online} hitSlop={8} accessibilityLabel="Lancer la recherche">
            <Ionicons name="arrow-forward-circle" size={26} color={q.trim() ? c.accentText : c.textFaint} />
          </Pressable>
        )}
      </View>
      <View style={s.webGrid}>
        {WEB_OPS.map((w) => (
          <PressableScale
            key={w.op}
            onPress={() => run(w.op, { op: w.op }, w.label)}
            disabled={!online || !!busy}
            scaleTo={0.9}
            haptic={false}
            style={[s.webBtn, !online && { opacity: 0.35 }]}
            accessibilityRole="button"
            accessibilityLabel={w.label}
          >
            {busy === w.op ? <ActivityIndicator size="small" color={c.text} /> : <Ionicons name={w.icon} size={20} color={c.text} />}
          </PressableScale>
        ))}
      </View>
    </View>
  );
}
