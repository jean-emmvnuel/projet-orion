import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { coreLink } from '@/api/client';
import { openPreview, saveToPhone } from '@/api/download';
import { COMMANDS, matchCommands } from '@/api/intents';
import type { Card, Message } from '@/data/conversations';
import { font, makeStyles, radius, space, useTheme } from '@/theme';

import { IconName, Material, Meter, OrionMark, PressableScale, tap, useModalPresence } from './ui';

/* ───────────────────────── Barre de saisie (façon « Ask Siri ») ───────────────────────── */

/**
 * « + | Demander à ORION | micro ». Quand on tape du texte, le micro devient « Envoyer ».
 * En mode `entry`, le champ n'est pas éditable : il ouvre une nouvelle conversation.
 */
export function Composer({
  onSend,
  onMic,
  onPlus,
  onEntry,
  entry,
  autoFocus,
  inline,
}: {
  onSend?: (text: string) => void;
  onMic: () => void;
  onPlus: () => void;
  onEntry?: () => void;
  entry?: boolean;
  autoFocus?: boolean;
  /** Dans le flux (au-dessus du clavier) au lieu de flotter en bas de l'écran. */
  inline?: boolean;
}) {
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  // Marge fixe au-dessus de la home bar : quand le clavier s'ouvre, l'écran la compense
  // (KeyboardStickyView), ce qui évite tout saut de mise en page.
  const bottom = Math.max(insets.bottom, space.md);
  // Place laissée au menu « / » : entre l'en-tête de l'écran et la barre de saisie, au-dessus du clavier.
  const { height: winH } = useWindowDimensions();
  const kbH = useKeyboardState((st) => (st.isVisible ? st.height : 0));
  const menuMax = Math.max(132, winH - kbH - insets.top - 60 - 64 - space.lg - (kbH ? 0 : bottom));
  const canSend = text.trim().length > 0;
  // Menu des commandes façon Telegram : visible dès qu'on tape « / » (et tant qu'il n'y a pas d'espace).
  const slash = !entry && /^\/\S*$/.test(text);
  const typed = slash ? text.slice(1).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
  const suggestions = slash ? matchCommands(typed) : [];
  const pick = (cmd: (typeof COMMANDS)[number]) => {
    tap('select');
    if (cmd.arg && cmd.cmd !== 'fichiers') setText(`/${cmd.cmd} `);
    else {
      onSend?.(`/${cmd.cmd}`);
      setText('');
    }
  };
  const send = () => {
    if (!canSend) return;
    tap('light');
    onSend?.(text.trim());
    setText('');
  };
  return (
    <View style={[inline ? s.composerInline : s.composerWrap, { paddingBottom: bottom, paddingLeft: Math.max(insets.left, space.md), paddingRight: Math.max(insets.right, space.md) }]} pointerEvents="box-none">
      {inline ? null : <EdgeFade color={c.bg} />}
      {suggestions.length ? (
        <Material style={[s.slashMenu, { maxHeight: menuMax }]} intensity={70}>
          {/* Défilable : avec le clavier ouvert, la liste complète ne tient pas à l'écran. */}
          <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator bounces={false} nestedScrollEnabled>
          {suggestions.map((cmd, i) => [
            i === 0 || suggestions[i - 1].group !== cmd.group ? (
              <Text key={`g-${cmd.group}`} style={[s.slashGroup, i > 0 && { borderTopWidth: 0.5, borderTopColor: c.separator }]} accessibilityRole="header">
                {cmd.group}
              </Text>
            ) : null,
            <Pressable
              key={cmd.cmd}
              onPress={() => pick(cmd)}
              style={({ pressed }) => [s.slashRow, i > 0 && suggestions[i - 1].group === cmd.group && { borderTopWidth: 0.5, borderTopColor: c.separator }, pressed && { backgroundColor: c.fill }]}
              accessibilityRole="button"
              accessibilityLabel={`/${cmd.cmd} : ${cmd.label}`}
            >
              <Text style={s.slashCmd}>
                /{cmd.cmd}
                {cmd.arg ? <Text style={{ color: c.textFaint, fontFamily: font.regular }}> {cmd.arg}</Text> : null}
              </Text>
              <Text style={[t.footnote, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>
                {cmd.label}
              </Text>
            </Pressable>,
          ])}
          </ScrollView>
        </Material>
      ) : null}
      <View style={s.composerRow} pointerEvents="box-none">
      <PressableScale accessibilityRole="button" accessibilityLabel="Joindre un élément" onPress={onPlus} style={s.round} scaleTo={0.9}>
        <Material style={s.roundInner} intensity={60} interactive>
          <Ionicons name="add" size={22} color={c.text} />
        </Material>
      </PressableScale>

      <Material style={s.field} intensity={60} interactive>
        {entry ? (
          <Pressable style={s.fieldPress} onPress={onEntry} accessibilityRole="button" accessibilityLabel="Écrire à ORION">
            <Text style={s.placeholder}>Demander à ORION</Text>
          </Pressable>
        ) : (
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Demander à ORION ou taper /"
            placeholderTextColor={c.textFaint}
            style={s.input}
            onSubmitEditing={send}
            submitBehavior="submit"
            // Web : Entrée envoie, Maj+Entrée va à la ligne (react-native-web ignore submitBehavior).
            onKeyPress={
              Platform.OS === 'web'
                ? (e) => {
                    const ev = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                    if (ev.key === 'Enter' && !ev.shiftKey) {
                      (e as unknown as { preventDefault: () => void }).preventDefault();
                      send();
                    }
                  }
                : undefined
            }
            returnKeyType="send"
            autoFocus={autoFocus}
            multiline
            numberOfLines={1}
            textAlignVertical="center"
            accessibilityLabel="Message pour ORION"
          />
        )}
      </Material>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={canSend ? 'Envoyer' : 'Parler à ORION'}
        onPress={canSend ? send : onMic}
        style={s.round}
        scaleTo={0.9}
        haptic={false}
      >
        {canSend ? (
          <View style={[s.roundInner, { backgroundColor: c.violet }]}>
            <Ionicons name="arrow-up" size={20} color={c.onViolet} />
          </View>
        ) : (
          <Material style={s.roundInner} intensity={60} interactive>
            <Ionicons name="mic" size={20} color={c.text} />
          </Material>
        )}
      </PressableScale>
      </View>
    </View>
  );
}

/** Fondu vers le fond sous la barre flottante (effet de bord de défilement, façon iOS). */
function EdgeFade({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: -32, bottom: 0 }}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.85} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

/* ───────────────────────── Feuille du bouton + ───────────────────────── */

const ATTACH: { icon: IconName; label: string; hint: string }[] = [
  { icon: 'image', label: 'Photo ou vidéo → PC', hint: 'Rangée dans Téléchargements/ORION' },
  { icon: 'document', label: 'Fichier → PC', hint: 'PDF, document, archive…' },
  { icon: 'folder-open', label: 'Parcourir le PC', hint: 'Dossiers et fichiers' },
  { icon: 'scan', label: 'Écran du PC', hint: 'Capture en direct' },
  { icon: 'clipboard', label: 'Presse-papiers du PC', hint: 'Récupérer ce qui est copié' },
];

export function AttachSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (label: string) => void }) {
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={useModalPresence(visible)} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {visible ? (
        <>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={s.scrim}>
            <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Fermer" />
          </Animated.View>
          <Animated.View entering={SlideInDown.springify().damping(22)} exiting={SlideOutDown.duration(200)} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
            <View style={s.grabber} />
            <Text style={[t.headline, { marginBottom: space.md, paddingHorizontal: space.xs }]}>Ajouter à la conversation</Text>
            {ATTACH.map((a) => (
              <Pressable
                key={a.label}
                onPress={() => {
                  tap('select');
                  onPick(a.label);
                }}
                style={({ pressed }) => [s.attachRow, pressed && { backgroundColor: c.fill }]}
                accessibilityRole="button"
              >
                <View style={s.attachIcon}>
                  <Ionicons name={a.icon} size={20} color={c.accentText} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={t.callout}>{a.label}</Text>
                  <Text style={t.footnote}>{a.hint}</Text>
                </View>
              </Pressable>
            ))}
          </Animated.View>
        </>
      ) : null}
    </Modal>
  );
}

/* ───────────────────────── Menu contextuel (appui long) ───────────────────────── */

export function ContextMenu({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: { icon: IconName; label: string; danger?: boolean; onPress: () => void }[];
  onClose: () => void;
}) {
  const { c, t } = useTheme();
  const s = useStyles();
  return (
    <Modal visible={useModalPresence(visible)} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {visible ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[s.scrim, { justifyContent: 'center', padding: space.xl }]}>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} accessibilityLabel="Fermer" />
          <Animated.View entering={FadeInDown.springify().damping(20)} style={s.menu}>
            <Text style={[t.footnote, { padding: space.lg, paddingBottom: space.sm }]} numberOfLines={1}>
              {title}
            </Text>
            {actions.map((a, i) => (
              <Pressable
                key={a.label}
                onPress={() => {
                  tap(a.danger ? 'warning' : 'select');
                  a.onPress();
                  onClose();
                }}
                style={({ pressed }) => [s.menuRow, i > 0 && s.menuDivider, pressed && { backgroundColor: c.fill }]}
                accessibilityRole="button"
              >
                <Text style={[t.body, a.danger && { color: c.danger }]}>{a.label}</Text>
                <Ionicons name={a.icon} size={18} color={a.danger ? c.danger : c.text} />
              </Pressable>
            ))}
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

/* ───────────────────────── Messages ───────────────────────── */

type ListItem = Extract<Card, { kind: 'list' }>['items'][number];

type CardHandlers = {
  onCard?: (action: 'run' | 'cancel') => void;
  /** Toucher une ligne : dossier → l'ouvrir, fichier → le récupérer. */
  onFile?: (item: ListItem) => Promise<void>;
  /** Bouton « .zip » d'un dossier. */
  onZip?: (item: ListItem) => Promise<void>;
  /** Toucher un exemple de la carte d'aide : l'envoyer comme demande. */
  onAsk?: (text: string) => void;
};

/** Texte copiable d'un message : le texte lui-même, ou un résumé de sa carte. */
function copyText(m: Message): string {
  const parts = m.text ? [m.text] : [];
  const k = m.card;
  if (k?.kind === 'file') parts.push(k.name);
  if (k?.kind === 'list') parts.push(k.items.map((i) => i.path).join('\n'));
  if (k?.kind === 'status') parts.push(`Processeur ${k.cpu} % · Mémoire ${k.ram} % · Disque ${k.disk} %${k.battery != null ? ` · Batterie ${k.battery} %` : ''}`);
  return parts.join('\n\n').trim();
}

/** Appui long sur un message : copié dans le presse-papiers du téléphone, avec une confirmation discrète. */
function useCopy(m: Message) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = copyText(m);
    if (!text) return;
    await Clipboard.setStringAsync(text);
    tap('success');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return { copied, copy };
}

function CopiedTag({ align }: { align: 'flex-start' | 'flex-end' }) {
  const { c, t } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(200)} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: align, marginTop: 4, gap: 4 }}>
      <Ionicons name="checkmark-circle" size={13} color={c.online} />
      <Text style={[t.caption, { color: c.online }]}>Copié</Text>
    </Animated.View>
  );
}

export function MessageView({ m, onCard, onFile, onZip, onAsk }: { m: Message } & CardHandlers) {
  const { c, t } = useTheme();
  const s = useStyles();
  const { copied, copy } = useCopy(m);
  if (m.from === 'user') {
    return (
      <Animated.View entering={FadeInDown.duration(220)} style={s.userRow}>
        <Pressable onLongPress={copy} delayLongPress={350} style={({ pressed }) => [s.userBubble, pressed && { opacity: 0.75 }]} accessibilityHint="Appui long pour copier">
          <Text style={[t.body, { color: c.text }]} selectable={Platform.OS === 'web'}>
            {m.text}
          </Text>
        </Pressable>
        {m.voice ? (
          <View style={s.voiceTag}>
            <Ionicons name="mic" size={11} color={c.textFaint} />
            <Text style={[t.caption, { marginLeft: 3 }]}>Dicté</Text>
          </View>
        ) : null}
        {copied ? <CopiedTag align="flex-end" /> : null}
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={FadeInDown.duration(260)} style={s.orionRow}>
      {m.text ? (
        <Pressable onLongPress={copy} delayLongPress={350} style={({ pressed }) => pressed && { opacity: 0.7 }} accessibilityHint="Appui long pour copier">
          <Text style={[t.body, { fontSize: 17, lineHeight: 25 }]} selectable={Platform.OS === 'web'}>
            {m.text}
          </Text>
        </Pressable>
      ) : null}
      {m.card ? <CardView card={m.card} onAction={onCard} onFile={onFile} onZip={onZip} onAsk={onAsk} /> : null}
      {copied ? <CopiedTag align="flex-start" /> : null}
    </Animated.View>
  );
}

/** Points « ORION écrit… ». */
export function Typing() {
  const { c } = useTheme();
  return (
    <Animated.View entering={FadeIn} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm }}>
      <OrionMark size={18} />
      <Text style={{ marginLeft: space.sm, color: c.textMuted, fontFamily: font.medium, fontSize: 14 }}>ORION s’en occupe…</Text>
    </Animated.View>
  );
}

function CardShell({ device, icon, children }: { device: string; icon: IconName; children: ReactNode }) {
  const { c, t } = useTheme();
  const s = useStyles();
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={s.cardApp}>
          <Ionicons name={icon} size={14} color={c.onViolet} />
        </View>
        <Text style={[t.caption, { color: c.textMuted, fontFamily: font.semibold, marginLeft: space.sm }]}>{device}</Text>
      </View>
      {children}
    </View>
  );
}

export function CardView({ card, onAction, onFile, onZip, onAsk }: { card: Card; onAction?: (a: 'run' | 'cancel') => void } & Omit<CardHandlers, 'onCard'>) {
  const { c, t } = useTheme();
  const s = useStyles();
  switch (card.kind) {
    case 'capture':
      return (
        <CardShell device={`Capture · ${card.device}`} icon="scan">
          {card.url ? (
            <Pressable onPress={() => openPreview(card.url!, `capture-${card.time.replace(':', 'h')}.png`, card.size)} accessibilityRole="imagebutton" accessibilityLabel="Ouvrir la capture en grand">
              <Image source={{ uri: coreLink(card.url) }} style={[s.preview, { backgroundColor: '#000' }]} resizeMode="contain" />
            </Pressable>
          ) : (
            <View style={[s.preview, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={[t.footnote, { color: 'rgba(255,255,255,0.6)' }]}>Capture expirée</Text>
            </View>
          )}
          <View style={s.cardFoot}>
            <Text style={[t.footnote, { flex: 1 }]}>{card.size}</Text>
            <SaveButton url={card.url} name={`capture-${card.time.replace(':', 'h')}.png`} />
          </View>
        </CardShell>
      );
    case 'live':
      return (
        <CardShell device={`Écran en direct · ${card.device}`} icon="tv">
          <Text style={[t.subhead, { marginBottom: space.md }]}>{card.note ?? 'Vois l’écran du PC en direct et contrôle-le : toucher pour cliquer, pavé tactile, clavier et raccourcis.'}</Text>
          <PressableScale
            onPress={() => router.push({ pathname: '/device/remote', params: { id: card.deviceId } })}
            style={{ height: 46, borderRadius: radius.pill, backgroundColor: c.violet, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm }}
            accessibilityRole="button"
          >
            <Ionicons name="tv" size={18} color={c.onViolet} />
            <Text style={{ color: c.onViolet, fontFamily: font.semibold, fontSize: 15 }}>Ouvrir l’écran en direct</Text>
          </PressableScale>
        </CardShell>
      );
    case 'file':
      return (
        <CardShell device={card.device} icon="folder-open">
          <View style={s.fileRow}>
            <View style={s.fileIcon}>
              <Ionicons name={card.ext === 'pdf' ? 'document-text' : card.ext === 'zip' ? 'archive' : 'document'} size={22} color={c.accentText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={t.callout} numberOfLines={1}>
                {card.name}
              </Text>
              <Text style={t.footnote}>{card.size}</Text>
            </View>
          </View>
          <View style={s.actions}>
            {card.url ? (
              <>
                <ActionButton label="Aperçu" onPress={() => openPreview(card.url!, card.name, card.size)} />
                <SaveButton url={card.url} name={card.name} wide />
              </>
            ) : (
              <ActionButton label="Lien expiré" />
            )}
          </View>
        </CardShell>
      );
    case 'list':
      return (
        <CardShell device={`${card.device} · ${card.title}`} icon="folder-open">
          {card.path && card.path !== '~' ? (
            <FileRow
              item={{ name: 'Dossier parent', path: card.path.split('/').slice(0, -1).join('/') || '~', kind: 'folder', size: '' }}
              first
              parent
              onPick={onFile}
            />
          ) : null}
          <ListItems items={card.items} onPick={onFile} onZip={onZip} offset={card.path && card.path !== '~' ? 1 : 0} />
          {card.path ? (
            <Pressable
              onPress={() => {
                tap('select');
                router.push({ pathname: '/device/files', params: { id: card.deviceId, path: card.path } });
              }}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderTopWidth: 0.5, borderTopColor: c.separator }, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <Ionicons name="folder-open-outline" size={16} color={c.accentText} />
              <Text style={{ fontFamily: font.semibold, fontSize: 14, color: c.accentText }}>Continuer dans l’explorateur</Text>
            </Pressable>
          ) : null}
        </CardShell>
      );
    case 'help':
      return (
        <CardShell device={`${card.device} · Ce que je sais faire`} icon="help-circle">
          {card.items.map((it, i) => [
            it.group && (i === 0 || card.items[i - 1].group !== it.group) ? (
              <Text key={`g-${it.group}`} style={[t.caption, { color: c.textFaint, fontFamily: font.semibold, marginTop: i ? space.md : 0, marginBottom: 2 }]} accessibilityRole="header">
                {it.group}
              </Text>
            ) : null,
            <Pressable
              key={it.label}
              disabled={it.enabled === false || !onAsk}
              onPress={() => {
                tap('select');
                onAsk?.(it.example);
              }}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderTopWidth: i && card.items[i - 1].group === it.group ? 0.5 : 0, borderTopColor: c.separator },
                it.enabled === false && { opacity: 0.45 },
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${it.label}${it.enabled === false ? ', désactivé sur ce PC' : `. Exemple : ${it.example}`}`}
            >
              <Ionicons name={it.enabled === false ? 'close-circle' : 'checkmark-circle'} size={18} color={it.enabled === false ? c.textFaint : c.online} />
              <View style={{ flex: 1 }}>
                <Text style={t.callout}>{it.label}</Text>
                <Text style={[t.caption, { color: it.enabled === false ? c.textFaint : c.accentText }]} numberOfLines={1}>
                  {it.enabled === false ? 'Désactivé dans les réglages de l’agent' : `« ${it.example} »`}
                </Text>
              </View>
              {it.enabled === false ? null : <Ionicons name="arrow-up-circle" size={20} color={c.accentText} />}
            </Pressable>,
          ])}
        </CardShell>
      );
    case 'status':
      return (
        <CardShell device={card.device} icon="pulse">
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Meter label="Processeur" value={card.cpu} />
            <Meter label="Mémoire" value={card.ram} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
            <Meter label="Disque" value={card.disk} />
            <Meter label="Batterie" value={card.battery ?? null} higherIsBetter />
          </View>
        </CardShell>
      );
    case 'confirm': {
      const done = card.status === 'done';
      const cancelled = card.status === 'cancelled';
      return (
        <CardShell device={card.device} icon={card.icon as IconName}>
          <Text style={[t.headline, { marginBottom: 2 }]}>{card.action}</Text>
          <Text style={t.footnote}>{card.detail}</Text>
          {card.status === 'pending' || !card.status ? (
            <View style={s.actions}>
              <ActionButton label="Annuler" onPress={() => onAction?.('cancel')} />
              <ActionButton label={card.danger ? card.action : 'Exécuter'} icon="arrow-up-circle" primary danger={card.danger} onPress={() => onAction?.('run')} />
            </View>
          ) : (
            <View style={[s.doneRow, { backgroundColor: done ? c.onlineSoft : c.fill }]}>
              <Ionicons name={done ? 'checkmark-circle' : 'close-circle'} size={16} color={done ? c.online : c.textMuted} />
              <Text style={[t.footnote, { marginLeft: 6, color: done ? c.online : c.textMuted, fontFamily: font.semibold }]}>
                {done ? 'Exécuté' : cancelled ? 'Annulé' : ''}
              </Text>
            </View>
          )}
        </CardShell>
      );
    }
  }
}

/** Enregistre directement sur le téléphone (Photos pour une image, Fichiers sinon). */
function SaveButton({ url, name, wide }: { url?: string; name: string; wide?: boolean }) {
  const { c } = useTheme();
  const s = useStyles();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const save = async () => {
    if (!url) return;
    setState('busy');
    try {
      const r = await saveToPhone(url, name);
      setState(r === 'denied' ? 'error' : 'done');
      tap(r === 'denied' ? 'warning' : 'success');
    } catch {
      setState('error');
      tap('warning');
    }
    setTimeout(() => setState('idle'), 2500);
  };
  const icon: IconName = state === 'done' ? 'checkmark' : state === 'error' ? 'alert' : 'arrow-down';
  const color = state === 'done' ? c.online : state === 'error' ? c.danger : wide ? c.accentText : c.text;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel="Enregistrer sur le téléphone" onPress={save} disabled={!url || state === 'busy'} style={wide ? s.action : s.small} scaleTo={0.92} haptic={false}>
      {state === 'busy' ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={icon} size={wide ? 16 : 17} color={color} style={wide ? { marginRight: 6 } : undefined} />}
      {wide ? <Text style={{ fontFamily: font.semibold, fontSize: 15, color }}>{state === 'done' ? 'Enregistré' : 'Enregistrer'}</Text> : null}
    </PressableScale>
  );
}

function SmallButton({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} style={s.small} scaleTo={0.88} onPress={onPress} disabled={!onPress}>
      <Ionicons name={icon} size={17} color={c.text} />
    </PressableScale>
  );
}

/** Tous les résultats : les 8 premiers, puis « Afficher les N résultats » pour dérouler le reste. */
function ListItems({ items, onPick, onZip, offset = 0 }: { items: ListItem[]; onPick?: (item: ListItem) => Promise<void>; onZip?: (item: ListItem) => Promise<void>; offset?: number }) {
  const { c } = useTheme();
  const [all, setAll] = useState(items.length <= 10);
  const shown = all ? items : items.slice(0, 8);
  return (
    <>
      {shown.map((it, i) => (
        <FileRow key={it.path} item={it} first={i + offset === 0} onPick={onPick} onZip={onZip} />
      ))}
      {items.length > shown.length ? (
        <Pressable
          onPress={() => {
            tap('select');
            setAll(true);
          }}
          style={({ pressed }) => [{ minHeight: 44, alignItems: 'center', justifyContent: 'center', borderTopWidth: 0.5, borderTopColor: c.separator }, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: c.accentText }}>Afficher les {items.length} résultats</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function FileRow({ item, first, onPick, onZip, parent }: { item: ListItem; first: boolean; onPick?: (item: ListItem) => Promise<void>; onZip?: (item: ListItem) => Promise<void>; parent?: boolean }) {
  const { c, t } = useTheme();
  const [busy, setBusy] = useState<'open' | 'zip' | null>(null);
  const folder = item.kind === 'folder';
  const run = async (kind: 'open' | 'zip') => {
    setBusy(kind);
    await (kind === 'zip' ? onZip : onPick)?.(item);
    setBusy(null);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: first ? 0 : 0.5, borderTopColor: c.separator }}>
      <Pressable
        disabled={!onPick || !!busy}
        onPress={() => run('open')}
        style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm }, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={parent ? 'Remonter au dossier parent' : folder ? `Ouvrir le dossier ${item.name}` : `Récupérer ${item.name}`}
      >
        <Ionicons name={parent ? 'arrow-up-circle' : folder ? 'folder' : 'document'} size={20} color={folder ? c.accentText : c.textMuted} />
        <View style={{ flex: 1 }}>
          <Text style={t.callout} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={t.caption} numberOfLines={1}>
            {folder ? item.path : `${item.size} · ${item.path}`}
          </Text>
        </View>
        {busy === 'open' ? (
          <ActivityIndicator size="small" color={c.accentText} />
        ) : (
          <Ionicons name={folder ? 'chevron-forward' : 'arrow-down-circle-outline'} size={folder ? 16 : 20} color={folder ? c.textFaint : c.accentText} />
        )}
      </Pressable>
      {folder && onZip && !parent ? (
        <Pressable
          disabled={!!busy}
          onPress={() => run('zip')}
          hitSlop={6}
          style={({ pressed }) => [{ marginLeft: space.sm, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: c.fill, justifyContent: 'center' }, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`Télécharger le dossier ${item.name} en zip`}
        >
          {busy === 'zip' ? <ActivityIndicator size="small" color={c.accentText} /> : <Text style={{ fontFamily: font.semibold, fontSize: 12, color: c.accentText }}>.zip</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

/** Boutons pleine largeur des cartes, comme « Cancel / Send » dans Siri. */
function ActionButton({ label, icon, primary, danger, onPress }: { label: string; icon?: IconName; primary?: boolean; danger?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  const s = useStyles();
  const color = primary ? (danger ? c.danger : c.accentText) : c.text;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.action} scaleTo={0.96} haptic={primary ? 'medium' : 'select'}>
      {icon ? <Ionicons name={icon} size={16} color={color} style={{ marginRight: 6 }} /> : null}
      <Text style={{ fontFamily: font.semibold, fontSize: 15, color }}>{label}</Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((c, t) => ({
  composerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.sm },
  composerInline: { paddingTop: space.sm },
  slashMenu: { width: '100%', maxWidth: 680, alignSelf: 'center', borderRadius: radius.lg, overflow: 'hidden', marginBottom: space.sm, borderWidth: 0.5, borderColor: c.borderStrong },
  slashGroup: { fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.4, color: c.textFaint, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 2, backgroundColor: c.fill },
  slashRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 44 },
  slashCmd: { fontFamily: font.semibold, fontSize: 15, color: c.accentText },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, width: '100%', maxWidth: 680, alignSelf: 'center' },
  round: { width: 48, height: 48 },
  roundInner: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 0.5, borderColor: c.borderStrong },
  field: { flex: 1, minHeight: 48, borderRadius: 24, overflow: 'hidden', borderWidth: 0.5, borderColor: c.borderStrong, justifyContent: 'center' },
  fieldPress: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg },
  placeholder: { fontFamily: font.regular, fontSize: 16, color: c.textFaint },
  input: { fontFamily: font.regular, fontSize: 16, lineHeight: 22, color: c.text, paddingHorizontal: space.lg, paddingTop: 13, paddingBottom: 13, minHeight: 48, maxHeight: 120 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8, 5, 14, 0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxWidth: 560, alignSelf: 'center', width: '100%', backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.fillStrong, marginBottom: space.lg },
  attachRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: radius.md, gap: space.md },
  attachIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' },
  menu: { backgroundColor: c.surfaceRaised, borderRadius: radius.lg, overflow: 'hidden', width: '100%', maxWidth: 320, alignSelf: 'center' },
  menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, minHeight: 48 },
  menuDivider: { borderTopWidth: 0.5, borderTopColor: c.separator },
  userRow: { alignItems: 'flex-end', marginBottom: space.xl },
  userBubble: { maxWidth: '82%', backgroundColor: c.fillStrong, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: space.lg, paddingVertical: space.md },
  voiceTag: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginRight: 4 },
  orionRow: { marginBottom: space.xl, gap: space.md },
  card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg, borderWidth: 0.5, borderColor: c.separator, shadowColor: c.shadow, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  cardApp: { width: 22, height: 22, borderRadius: 7, backgroundColor: c.violet, alignItems: 'center', justifyContent: 'center' },
  preview: { height: 160, backgroundColor: '#1b1030', borderRadius: radius.md, overflow: 'hidden' },
  previewBar: { height: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.35)' },
  previewDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginRight: 4 },
  previewWindow: { position: 'absolute', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.10)' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: space.sm },
  small: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  fileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  action: { flex: 1, minHeight: 44, borderRadius: radius.pill, backgroundColor: c.fill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  doneRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: space.md, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
}));
