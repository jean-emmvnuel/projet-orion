import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { coreLink } from '@/api/client';
import { openPreview, saveImageToPhotos } from '@/api/download';
import { ACTION_META, formatSize, lastSeen, uptime } from '@/api/format';
import { forgetDevice, runCommand, useDevice } from '@/api/live';
import { pickDocuments, pickPhotos, sendToPc } from '@/api/transfer';
import { ClipboardResult, MediaRemote, PromptSheet, WebRemote } from '@/components/remote';
import type { Action, Command } from '@/api/types';
import { ControlButton, ControlModule, IconButton, Meter, OsGlyph, PressableScale, Screen, SectionHeader, StatePill, tap } from '@/components/ui';
import { font, makeStyles, radius, space, useTheme } from '@/theme';
import { confirmOwner } from '@/api/secure';

type Feedback = { kind: 'busy' | 'ok' | 'error'; text: string } | null;

export default function DeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useDevice(id);
  const { c, t } = useTheme();
  const s = useStyles();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [capture, setCapture] = useState<Command | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<'copy' | 'url' | 'message' | null>(null);

  if (!d)
    return (
      <Screen inStack>
        <Text style={t.body}>Cet appareil n’existe plus. Il a peut-être été dissocié.</Text>
      </Screen>
    );
  const online = d.online;
  const m = d.telemetry?.data;
  const standby = online && m?.standby === true;
  const locked = online && m?.locked === true && !standby;

  const run = async (action: Action, params: Record<string, unknown> = {}) => {
    setFeedback({ kind: 'busy', text: `${ACTION_META[action].label} en cours…` });
    try {
      const cmd = await runCommand(d.id, action, params);
      tap('success');
      if (action === 'screenshot') setCapture(cmd);
      const okText: Partial<Record<Action, string>> = {
        lock: 'Session verrouillée',
        unlock: cmd.result?.already ? 'La session était déjà ouverte' : 'Session déverrouillée',
        standby: params.op === 'enter' ? 'Veille légère : écran éteint, PC joignable' : 'Écran rallumé',
        sleep: 'Le PC se met en veille',
        'clipboard.set': 'Texte copié dans le presse-papiers du PC',
        'open.url': 'Lien ouvert sur le PC',
        notify: 'Message affiché sur le PC',
        power: params.op === 'restart' ? 'Le PC redémarre' : 'Le PC s’éteint',
      };
      setFeedback({ kind: 'ok', text: okText[action] ?? `${ACTION_META[action].label} : c’est fait` });
      // L'état « verrouillé » change : on rafraîchit la fiche sans attendre la télémétrie suivante.
      if (action === 'lock' || action === 'unlock' || action === 'standby') setTimeout(() => runCommand(d.id, 'status').catch(() => {}), 1200);
    } catch (e) {
      tap('warning');
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Échec' });
    }
    setTimeout(() => setFeedback((f) => (f?.kind === 'busy' ? f : null)), 4000);
  };

  /** Déverrouillage : Face ID / code du téléphone d'abord, puis l'ordre au PC. */
  const unlock = async () => {
    const err = await confirmOwner(`Déverrouiller ${d.name}`);
    if (err) {
      tap('warning');
      setFeedback({ kind: 'error', text: err });
      return;
    }
    run('unlock');
  };

  /** Réveil : Face ID / code, puis écran rallumé et session ouverte. */
  const wake = async () => {
    const err = await confirmOwner(`Réveiller ${d.name}`);
    if (err) {
      tap('warning');
      setFeedback({ kind: 'error', text: err });
      return;
    }
    setFeedback({ kind: 'busy', text: 'Réveil en cours…' });
    try {
      await runCommand(d.id, 'standby', { op: 'exit' });
      await runCommand(d.id, 'unlock');
      tap('success');
      setFeedback({ kind: 'ok', text: `${d.name} est réveillé et déverrouillé` });
      setTimeout(() => runCommand(d.id, 'status').catch(() => {}), 1200);
    } catch (e) {
      tap('warning');
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Réveil impossible' });
    }
  };

  const readClipboard = async () => {
    setFeedback({ kind: 'busy', text: 'Lecture du presse-papiers…' });
    try {
      const cmd = await runCommand(d.id, 'clipboard.get');
      setClip(String(cmd.result?.text ?? ''));
      setFeedback(null);
    } catch (e) {
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Échec' });
    }
  };

  /** Envoie des photos ou des fichiers du téléphone vers Téléchargements/ORION sur le PC. */
  const send = async (kind: 'photos' | 'docs') => {
    const files = kind === 'photos' ? await pickPhotos() : await pickDocuments();
    if (!files.length) return;
    let done = 0;
    for (const f of files) {
      setFeedback({ kind: 'busy', text: `Envoi de « ${f.name} » (${done + 1}/${files.length})…` });
      try {
        await sendToPc(d.id, f);
        done++;
      } catch (e) {
        setFeedback({ kind: 'error', text: `« ${f.name} » : ${e instanceof Error ? e.message : 'échec'}` });
        tap('warning');
        return;
      }
    }
    tap('success');
    setFeedback({ kind: 'ok', text: `${done} fichier(s) rangé(s) dans Téléchargements/ORION sur ${d.name}` });
  };

  const confirm = (title: string, message: string, onOk: () => void) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) onOk();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: onOk },
    ]);
  };

  return (
    <Screen inStack>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              icon="trash-outline"
              label="Dissocier ce PC"
              tint={c.danger}
              onPress={() =>
                confirm(`Dissocier ${d.name} ?`, 'Son agent sera déconnecté et il faudra un nouveau code pour l’associer à nouveau.', async () => {
                  await forgetDevice(d.id).catch(() => {});
                  router.back();
                })
              }
            />
          ),
        }}
      />
      <View style={s.hero}>
        <OsGlyph os={d.os} size={72} tint={c.surface} />
        <Text style={[t.largeTitle, { marginTop: space.lg, textAlign: 'center' }]}>{d.name}</Text>
        <Text style={[t.subhead, { marginTop: space.xs, marginBottom: space.md }]}>
          {d.osVersion} · {d.hostname}
        </Text>
        <StatePill state={online ? 'online' : 'offline'} />
        {standby ? (
          <PressableScale onPress={wake} style={[s.lockedPill, { backgroundColor: c.violetSoft }]} accessibilityRole="button" accessibilityLabel="En veille légère. Réveiller">
            <Ionicons name="cloudy-night" size={14} color={c.accentText} />
            <Text style={[t.footnote, { color: c.text, fontFamily: font.semibold }]}>En veille légère</Text>
            <Text style={[t.footnote, { color: c.accentText, fontFamily: font.semibold }]}>Réveiller</Text>
          </PressableScale>
        ) : null}
        {locked ? (
          <PressableScale onPress={unlock} style={s.lockedPill} accessibilityRole="button" accessibilityLabel="Session verrouillée. Déverrouiller">
            <Ionicons name="lock-closed" size={14} color={c.warning} />
            <Text style={[t.footnote, { color: c.text, fontFamily: font.semibold }]}>Session verrouillée</Text>
            <Text style={[t.footnote, { color: c.accentText, fontFamily: font.semibold }]}>Déverrouiller</Text>
          </PressableScale>
        ) : null}
        {!online ? <Text style={[t.footnote, { marginTop: space.sm }]}>{lastSeen(d)}</Text> : null}
      </View>

      <View style={s.metrics}>
        <View style={s.metricsRow}>
          <Meter label="Processeur" value={online && m ? m.cpu : null} />
          <View style={s.gap} />
          <Meter label="Mémoire" value={online && m ? m.ram : null} />
        </View>
        <View style={[s.metricsRow, { marginTop: space.lg }]}>
          <Meter label="Disque" value={m ? m.disk : null} />
          <View style={s.gap} />
          <Meter label={m?.battery?.charging ? 'Batterie · en charge' : 'Batterie'} value={m?.battery ? m.battery.percent : null} higherIsBetter />
        </View>
        <Text style={[t.caption, { marginTop: space.lg }]}>
          {online ? `Allumé depuis ${uptime(m?.uptimeS)}${m?.diskFreeGb ? ` · ${String(m.diskFreeGb).replace('.', ',')} Go libres` : ''}` : 'Les mesures reprendront au retour du PC.'}
        </Text>
      </View>

      {feedback ? (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut} style={[s.feedback, { backgroundColor: feedback.kind === 'error' ? c.dangerSoft : feedback.kind === 'ok' ? c.onlineSoft : c.fill }]}>
          {feedback.kind === 'busy' ? <ActivityIndicator size="small" color={c.textMuted} /> : <Ionicons name={feedback.kind === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={18} color={feedback.kind === 'ok' ? c.online : c.danger} />}
          <Text style={[t.footnote, { marginLeft: space.sm, flex: 1, color: feedback.kind === 'error' ? c.danger : c.text }]}>{feedback.text}</Text>
        </Animated.View>
      ) : null}

      {capture?.result?.url ? (
        <Animated.View entering={FadeInDown.springify().damping(20)} style={s.capture}>
          <Pressable onPress={() => openPreview(capture.result!.url, capture.result!.name ?? 'capture.png', formatSize(capture.result!.size))} accessibilityRole="imagebutton" accessibilityLabel="Ouvrir la capture en grand">
            <Image source={{ uri: coreLink(capture.result.url) }} style={[s.captureImg, capture.result.width ? { aspectRatio: capture.result.width / capture.result.height } : null]} resizeMode="contain" />
          </Pressable>
          <View style={s.captureMeta}>
            <Text style={[t.footnote, { flex: 1 }]}>
              {capture.result.width} × {capture.result.height} · {formatSize(capture.result.size)}
            </Text>
            <IconButton
              icon="download-outline"
              label="Enregistrer dans Photos"
              onPress={async () => {
                setFeedback({ kind: 'busy', text: 'Enregistrement dans Photos…' });
                try {
                  const r = await saveImageToPhotos(capture.result!.url, capture.result!.name ?? 'capture.png');
                  setFeedback(r === 'saved' ? { kind: 'ok', text: 'Capture enregistrée dans Photos' } : { kind: 'error', text: 'Autorise ORION à ajouter des photos dans les Réglages.' });
                } catch (e) {
                  setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Échec de l’enregistrement' });
                }
              }}
            />
            <IconButton icon="close" label="Fermer la capture" onPress={() => setCapture(null)} />
          </View>
        </Animated.View>
      ) : null}

      <SectionHeader>Commandes</SectionHeader>
      <View style={s.modules}>
        <ControlModule icon="tv" title="Écran en direct" value="Voir et contrôler" accent disabled={!online} onPress={() => router.push({ pathname: '/device/remote', params: { id: d.id } })} />
        <View style={s.gap} />
        <ControlModule icon="apps" title="Applications" value="Ouvrir une appli" disabled={!online} onPress={() => router.push({ pathname: '/device/apps', params: { id: d.id } })} />
      </View>
      <View style={[s.modules, { marginTop: space.md }]}>
        <ControlModule icon="scan" title="Capture" value="Photo de l’écran" disabled={!online || feedback?.kind === 'busy'} onPress={() => run('screenshot')} />
        <View style={s.gap} />
        <ControlModule icon="folder-open" title="Fichiers" value="Parcourir, récupérer" disabled={!online} onPress={() => router.push({ pathname: '/device/files', params: { id: d.id } })} />
      </View>

      <SectionHeader>Naviguer sur le web</SectionHeader>
      <WebRemote deviceId={d.id} online={online} onDone={(text) => setFeedback({ kind: 'ok', text })} onError={(text) => setFeedback({ kind: 'error', text })} />

      <SectionHeader>Lecture et son</SectionHeader>
      <MediaRemote deviceId={d.id} online={online} onError={(text) => setFeedback({ kind: 'error', text })} />

      <SectionHeader>Échanger avec le PC</SectionHeader>
      <View style={s.controls}>
        <ControlButton icon="image" label="Photo → PC" disabled={!online} onPress={() => send('photos')} />
        <ControlButton icon="document-attach" label="Fichier → PC" disabled={!online} onPress={() => send('docs')} />
        <ControlButton icon="clipboard" label="Presse-papiers" disabled={!online} onPress={readClipboard} />
        <ControlButton icon="copy" label="Copier texte" disabled={!online} onPress={() => setPrompt('copy')} />
        <ControlButton icon="globe" label="Ouvrir lien" disabled={!online} onPress={() => setPrompt('url')} />
        <ControlButton icon="notifications" label="Faire signe" disabled={!online} onPress={() => run('notify', { title: 'ORION', body: 'Ton téléphone te fait signe 👋' })} />
        <ControlButton icon="chatbox-ellipses" label="Message" disabled={!online} onPress={() => setPrompt('message')} />
        <ControlButton icon="refresh" label="Actualiser" disabled={!online} onPress={() => run('status')} />
      </View>
      {clip !== null ? <ClipboardResult text={clip} onClose={() => setClip(null)} /> : null}

      <SectionHeader>Session et alimentation</SectionHeader>
      <View style={s.controls}>
        {locked ? (
          <ControlButton icon="lock-open" label="Déverrouiller" disabled={!online} onPress={unlock} />
        ) : (
          <ControlButton icon="lock-closed" label="Verrouiller" disabled={!online} onPress={() => run('lock')} />
        )}
        {standby ? (
          <ControlButton icon="sunny" label="Réveiller" disabled={!online} onPress={wake} />
        ) : (
          <ControlButton icon="moon" label="Veille" disabled={!online} onPress={() => run('standby', { op: 'enter' })} />
        )}
        <ControlButton icon="refresh-circle" label="Redémarrer" danger disabled={!online} onPress={() => confirm(`Redémarrer ${d.name} ?`, 'Les documents non enregistrés seront perdus.', () => run('power', { op: 'restart' }))} />
        <ControlButton icon="power" label="Éteindre" danger disabled={!online} onPress={() => confirm(`Éteindre ${d.name} ?`, 'Les documents non enregistrés seront perdus et le PC ne répondra plus.', () => run('power', { op: 'shutdown' }))} />
      </View>

      <PromptSheet
        visible={prompt !== null}
        title={prompt === 'url' ? `Ouvrir un lien sur ${d.name}` : prompt === 'message' ? `Afficher un message sur ${d.name}` : `Copier un texte sur ${d.name}`}
        placeholder={prompt === 'url' ? 'https://…' : prompt === 'message' ? 'J’arrive dans 5 minutes' : 'Texte à coller sur le PC'}
        action={prompt === 'url' ? 'Ouvrir' : prompt === 'message' ? 'Afficher' : 'Copier'}
        keyboardType={prompt === 'url' ? 'url' : 'default'}
        onClose={() => setPrompt(null)}
        onSubmit={(value) => {
          const kind = prompt;
          setPrompt(null);
          if (kind === 'url') run('open.url', { url: value });
          else if (kind === 'message') run('notify', { title: 'ORION', body: value });
          else run('clipboard.set', { text: value });
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  hero: { alignItems: 'center', marginTop: space.md, marginBottom: space.xl },
  metrics: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg },
  metricsRow: { flexDirection: 'row' },
  gap: { width: space.md },
  modules: { flexDirection: 'row' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.lg, marginHorizontal: -space.xs },
  feedback: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, padding: space.md, marginTop: space.lg },
  capture: { backgroundColor: c.surface, borderRadius: radius.xl, overflow: 'hidden', marginTop: space.lg },
  captureImg: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  captureMeta: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingVertical: space.xs, paddingRight: space.xs },
  lockedPill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, paddingHorizontal: space.md, height: 34, borderRadius: radius.pill, backgroundColor: c.warningSoft },
}));

