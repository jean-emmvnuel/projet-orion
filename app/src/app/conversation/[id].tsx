import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, type ScrollViewInstance, Text, View } from 'react-native';
import { KeyboardChatScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet, Composer, MessageView, Typing } from '@/components/chat';
import { IconButton, OrionMark, PressableScale } from '@/components/ui';
import type { Message } from '@/data/conversations';
import { fetchFile, launchOnPc, respond, runConfirmed } from '@/api/orion';
import { Picked, pickDocuments, pickPhotos, sendToPc } from '@/api/transfer';
import { useDevices, useTargetDevice } from '@/api/live';
import { store, useConversations } from '@/data/store';
import { makeStyles, radius, space, useTheme } from '@/theme';

/**
 * Discussion textuelle, sur le modèle de l'app Siri : ta bulle à droite, la réponse
 * d'ORION en texte libre avec des cartes d'action (capture, fichier, état, confirmation).
 * `id = "nouvelle"` ouvre une conversation vide.
 */
const STARTERS = ['/aide', '/capture', '/etat', '/fichiers'];

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const [id, setId] = useState(params.id);
  const all = useConversations();
  const conv = all.find((x) => x.id === id);
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollViewInstance>(null);
  const [typing, setTyping] = useState(false);
  const [attach, setAttach] = useState(false);
  const messages = conv?.messages ?? [];
  const target = useTargetDevice();
  const devices = useDevices();
  // Marge sous la barre de saisie (home bar) : absorbée quand le clavier est ouvert.
  const homeGap = Math.max(insets.bottom, space.md) - space.sm;

  useEffect(() => {
    const tm = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(tm);
  }, [messages.length, typing]);

  const answer = async (convId: string, work: () => Promise<Message>) => {
    setTyping(true);
    try {
      store.append(convId, await work());
    } finally {
      setTyping(false);
    }
  };

  const send = (text: string) => {
    const m: Message = { id: `u${Date.now()}`, from: 'user', text };
    let convId = id;
    if (!conv) {
      convId = store.create(m);
      setId(convId);
      router.setParams({ id: convId });
    } else {
      store.append(convId, m);
    }
    answer(convId, () => respond(text, target));
  };

  const onCard = (m: Message, action: 'run' | 'cancel') => {
    store.updateCard(id, m.id, { status: action === 'run' ? 'done' : 'cancelled' });
    if (action === 'run' && m.card?.kind === 'confirm' && m.card.run) {
      const run = m.card.run;
      answer(id, () => runConfirmed(run, devices.find((d) => d.id === run.deviceId)));
    }
  };

  /** Dossier → l'ouvrir ; fichier → le récupérer ; `zip` → télécharger le dossier en archive. */
  const onFile = async (m: Message, item: { path: string; kind: 'file' | 'folder' }, zip = false) => {
    if (m.card?.kind !== 'list') return;
    const deviceId = m.card.deviceId;
    const dev = devices.find((d) => d.id === deviceId);
    if (m.card.mode === 'open' && item.kind === 'file') return answer(id, () => launchOnPc(deviceId, item.path, dev));
    await answer(id, () => fetchFile(deviceId, item, dev, zip));
  };

  /** Envoi de photos / fichiers du téléphone vers le PC ciblé, raconté dans la conversation. */
  const sendFiles = async (files: Picked[]) => {
    if (!target) return;
    const note: Message = { id: `u${Date.now()}`, from: 'user', text: `📎 ${files.length > 1 ? `${files.length} fichiers` : files[0].name} → ${target.name}` };
    let convId = id;
    if (!conv) {
      convId = store.create(note);
      setId(convId);
      router.setParams({ id: convId });
    } else store.append(convId, note);
    answer(convId, async () => {
      const done: string[] = [];
      for (const f of files) {
        try {
          const r = await sendToPc(target.id, f);
          done.push(r.path);
        } catch (e) {
          return { id: `o${Date.now()}`, from: 'orion', text: `L’envoi de « ${f.name} » a échoué : ${e instanceof Error ? e.message : 'erreur'}` } as Message;
        }
      }
      return { id: `o${Date.now()}`, from: 'orion', text: `C’est sur ${target.name} :\n${done.map((p) => `• ${p}`).join('\n')}` } as Message;
    });
  };

  return (
    <View style={s.root}>
      {/* En-tête : retour à l'historique, titre, nouvelle conversation */}
      <View style={[s.header, { paddingTop: insets.top + space.xs, paddingLeft: Math.max(insets.left, space.sm), paddingRight: Math.max(insets.right, space.sm) }]}>
        <IconButton icon="chevron-back" label="Historique" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Text style={s.title} numberOfLines={1}>
          {conv?.title ?? 'Nouvelle conversation'}
        </Text>
        <IconButton icon="create-outline" label="Nouvelle conversation" onPress={() => router.replace('/conversation/nouvelle')} />
      </View>

      <View style={{ flex: 1 }}>
        {/* Messages et barre de saisie suivent le clavier image par image (iOS et Android). */}
        <KeyboardChatScrollView
          ref={scroller}
          style={{ flex: 1 }}
          offset={homeGap}
          keyboardLiftBehavior="always"
          contentContainerStyle={[s.list, { paddingBottom: space.xl }]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <View style={s.empty}>
              <OrionMark size={44} />
              <Text style={[t.title, { marginTop: space.lg, textAlign: 'center' }]}>Que fait-on sur tes PC ?</Text>
              <Text style={[t.subhead, { marginTop: space.xs, textAlign: 'center' }]}>
                {target ? `PC ciblé : ${target.name}${target.online ? '' : ' (hors ligne)'}` : 'Aucun PC associé pour l’instant'}
              </Text>
              <View style={s.starters}>
                {STARTERS.map((q) => (
                  <PressableScale key={q} onPress={() => send(q)} style={s.starter} scaleTo={0.97} accessibilityRole="button">
                    <Text style={[t.callout, { flex: 1 }]}>{q}</Text>
                    <Ionicons name="arrow-up-circle" size={20} color={c.accentText} />
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : (
            // Les messages déjà là s'affichent sans rejouer leur animation ; seuls les nouveaux glissent.
            <LayoutAnimationConfig skipEntering>
              {messages.map((m) => (
                <MessageView key={m.id} m={m} onCard={(a) => onCard(m, a)} onFile={(it) => onFile(m, it)} onZip={(it) => onFile(m, it, true)} onAsk={send} />
              ))}
            </LayoutAnimationConfig>
          )}
          {typing ? <Typing /> : null}
        </KeyboardChatScrollView>

        <KeyboardStickyView offset={{ closed: 0, opened: homeGap }}>
          <Composer inline onSend={send} onMic={() => router.push('/voix')} onPlus={() => setAttach(true)} autoFocus={messages.length === 0 && Platform.OS !== 'web'} />
        </KeyboardStickyView>
      </View>

      <AttachSheet
        visible={attach}
        onClose={() => setAttach(false)}
        onPick={async (label) => {
          setAttach(false);
          if (label === 'Écran du PC') return send('/capture');
          if (label === 'Presse-papiers du PC') return send('/presse');
          if (label === 'Parcourir le PC') return send('/fichiers');
          if (!target) return send('/aide');
          const files = label.startsWith('Photo') ? await pickPhotos() : await pickDocuments();
          if (!files.length) return;
          sendFiles(files);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((c, t) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingBottom: space.sm, gap: space.xs },
  title: { ...t.headline, flex: 1, textAlign: 'center' },
  list: { paddingHorizontal: space.lg, paddingTop: space.lg, width: '100%', maxWidth: 680, alignSelf: 'center' },
  empty: { alignItems: 'center', paddingTop: space.xxxl },
  starters: { width: '100%', marginTop: space.xxl, gap: space.sm },
  starter: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: radius.lg, paddingHorizontal: space.lg, minHeight: 52 },
}));

