import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { coreLink } from '@/api/client';
import { isAudio, isImage, isPdf, isText, isVideo, saveToPhone, shareFile } from '@/api/download';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { IconButton, Material, PressableScale, tap } from '@/components/ui';
import { ZoomableImage } from '@/components/ZoomableImage';
import { font, makeStyles, radius, space, useTheme } from '@/theme';

/**
 * Aperçu intégré d'un fichier venu du PC (capture, document) : tout se passe dans l'app.
 * Image en plein écran, texte lisible, PDF ; sinon une fiche avec Enregistrer / Partager.
 */
export default function ApercuScreen() {
  const { url, name = 'fichier', size } = useLocalSearchParams<{ url: string; name?: string; size?: string }>();
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const image = isImage(name);
  const pdf = isPdf(name);
  const textual = isText(name);
  const video = isVideo(name);
  const audio = isAudio(name);

  useEffect(() => {
    if (!textual || !url) return;
    fetch(coreLink(url))
      .then((r) => r.text())
      .then((v) => setText(v.length > 200_000 ? `${v.slice(0, 200_000)}\n\n… (aperçu tronqué)` : v))
      .catch(() => setText('Aperçu impossible. Enregistre le fichier pour l’ouvrir.'));
  }, [url, textual]);

  const act = async (kind: 'save' | 'share') => {
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === 'share') await shareFile(url, name);
      else {
        const r = await saveToPhone(url, name);
        if (r === 'denied') setNotice({ ok: false, text: 'Autorise ORION à ajouter des photos dans les Réglages du téléphone.' });
        else if (r === 'saved') setNotice({ ok: true, text: image ? 'Enregistrée dans Photos' : 'Téléchargé' });
      }
      tap('success');
    } catch (e) {
      tap('warning');
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Échec du téléchargement (le lien expire après 15 min).' });
    } finally {
      setBusy(null);
    }
  };

  const dark = image || video;
  return (
    <View style={[s.root, dark && { backgroundColor: '#000' }]}>
      <View style={[s.top, { paddingTop: insets.top + space.xs }]}>
        <IconButton icon="close" label="Fermer l’aperçu" tint={dark ? '#fff' : c.text} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[t.headline, dark && { color: '#fff' }]} numberOfLines={1}>
            {name}
          </Text>
          {size ? <Text style={[t.caption, dark && { color: 'rgba(255,255,255,0.6)' }]}>{size}</Text> : null}
        </View>
        <View style={{ width: 52 }} />
      </View>

      <View style={{ flex: 1 }}>
        {image ? (
          <ZoomableImage source={{ uri: coreLink(url) }} label={name} />
        ) : video ? (
          <VideoPane uri={coreLink(url)} />
        ) : audio ? (
          <AudioPane uri={coreLink(url)} name={name} />
        ) : textual ? (
          text === null ? (
            <ActivityIndicator color={c.accentText} style={{ marginTop: space.xxl }} />
          ) : (
            <ScrollView contentContainerStyle={s.text}>
              <Text style={s.mono} selectable>
                {text}
              </Text>
            </ScrollView>
          )
        ) : pdf && Platform.OS === 'ios' ? (
          <WebView source={{ uri: coreLink(url) }} style={{ flex: 1, backgroundColor: c.bg }} originWhitelist={['*']} />
        ) : (
          <View style={s.fallback}>
            <View style={s.fileIcon}>
              <Ionicons name={pdf ? 'document-text' : 'document'} size={40} color={c.accentText} />
            </View>
            <Text style={[t.title, { marginTop: space.lg, textAlign: 'center' }]} numberOfLines={2}>
              {name}
            </Text>
            <Text style={[t.subhead, { marginTop: space.xs, textAlign: 'center' }]}>Pas d’aperçu pour ce type de fichier : enregistre-le sur le téléphone.</Text>
          </View>
        )}
      </View>

      {notice ? (
        <View style={[s.notice, { backgroundColor: notice.ok ? c.onlineSoft : c.dangerSoft }]}>
          <Ionicons name={notice.ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={notice.ok ? c.online : c.danger} />
          <Text style={[t.footnote, { marginLeft: space.sm, flex: 1, color: notice.ok ? c.text : c.danger }]}>{notice.text}</Text>
        </View>
      ) : null}

      <Material style={[s.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]} intensity={70}>
        <PressableScale style={[s.btn, s.primary]} onPress={() => act('save')} disabled={!!busy} accessibilityRole="button">
          {busy === 'save' ? <ActivityIndicator color={c.onViolet} /> : <Ionicons name="download" size={18} color={c.onViolet} />}
          <Text style={[s.btnText, { color: c.onViolet }]}>{image ? 'Enregistrer dans Photos' : 'Enregistrer'}</Text>
        </PressableScale>
        <PressableScale style={s.btn} onPress={() => act('share')} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Partager">
          {busy === 'share' ? <ActivityIndicator color={c.text} /> : <Ionicons name="share-outline" size={18} color={c.text} />}
        </PressableScale>
      </Material>
    </View>
  );
}

/** Vidéo du PC, lue en streaming dans l'app (contrôles natifs, plein écran). */
function VideoPane({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" allowsPictureInPicture />;
}

/** Musique du PC, écoutée dans l'app. */
function AudioPane({ uri, name }: { uri: string; name: string }) {
  const { c, t } = useTheme();
  const player = useAudioPlayer(uri);
  const st = useAudioPlayerStatus(player);
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const progress = st.duration ? st.currentTime / st.duration : 0;
  useEffect(() => {
    player.play();
  }, [player]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
      <View style={{ width: 160, height: 160, borderRadius: 32, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="musical-notes" size={64} color={c.accentText} />
      </View>
      <Text style={[t.title, { marginTop: space.xl, textAlign: 'center' }]} numberOfLines={2}>
        {name.replace(/\.[^.]+$/, '')}
      </Text>
      <View style={{ width: '100%', maxWidth: 360, height: 4, borderRadius: 2, backgroundColor: c.fillStrong, marginTop: space.xl, overflow: 'hidden' }}>
        <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: c.accentText }} />
      </View>
      <View style={{ width: '100%', maxWidth: 360, flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }}>
        <Text style={[t.caption, { fontVariant: ['tabular-nums'] }]}>{fmt(st.currentTime)}</Text>
        <Text style={[t.caption, { fontVariant: ['tabular-nums'] }]}>{st.duration ? fmt(st.duration) : '--:--'}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.lg }}>
        <PressableScale onPress={() => player.seekTo(Math.max(0, st.currentTime - 15))} accessibilityRole="button" accessibilityLabel="Reculer de 15 secondes">
          <Ionicons name="play-back" size={30} color={c.text} />
        </PressableScale>
        <PressableScale
          onPress={() => (st.playing ? player.pause() : player.play())}
          style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.violet, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityLabel={st.playing ? 'Pause' : 'Lecture'}
        >
          {st.isLoaded ? <Ionicons name={st.playing ? 'pause' : 'play'} size={32} color={c.onViolet} /> : <ActivityIndicator color={c.onViolet} />}
        </PressableScale>
        <PressableScale onPress={() => player.seekTo(st.currentTime + 15)} accessibilityRole="button" accessibilityLabel="Avancer de 15 secondes">
          <Ionicons name="play-forward" size={30} color={c.text} />
        </PressableScale>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingBottom: space.sm },
  text: { padding: space.lg },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 13, lineHeight: 19, color: c.text },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  fileIcon: { width: 88, height: 88, borderRadius: 24, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', marginHorizontal: space.lg, marginBottom: space.sm, borderRadius: radius.md, padding: space.md },
  bar: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  btn: { height: 52, minWidth: 52, borderRadius: radius.pill, backgroundColor: c.fill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  primary: { flex: 1, backgroundColor: c.violet },
  btnText: { fontFamily: font.semibold, fontSize: 16 },
}));
