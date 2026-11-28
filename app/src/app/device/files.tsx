import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, type ScrollViewInstance, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isAudio, isImage, isVideo, isViewable, openPreview, saveToPhone } from '@/api/download';
import { formatSize } from '@/api/format';
import { runCommand, useDevice } from '@/api/live';
import type { FileItem } from '@/api/types';
import { IconName, InsetList, ListRow, tap, useModalPresence } from '@/components/ui';
import { font, makeStyles, radius, space, useTheme } from '@/theme';

const extIcon = (name: string): IconName => {
  if (isImage(name)) return 'image';
  if (isVideo(name)) return 'film';
  if (isAudio(name)) return 'musical-notes';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf', 'doc', 'docx', 'odt', 'txt', 'md'].includes(ext)) return 'document-text';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
  return 'document';
};

const parentOf = (path: string) => (path === '~' ? '~' : path.split('/').slice(0, -1).join('/') || '~');

/**
 * Explorateur du PC, navigation sur place et fluide :
 * fil d'Ariane cliquable, « Dossier parent », cache des dossiers déjà ouverts (retour instantané),
 * recherche dans le dossier courant, et pour chaque fichier : voir sur le téléphone,
 * lancer sur le PC, ou enregistrer. Un dossier se télécharge en .zip sur demande.
 */
export default function FilesScreen() {
  const params = useLocalSearchParams<{ id: string; path?: string }>();
  const id = params.id;
  const device = useDevice(id);
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [path, setPath] = useState(params.path || '~');
  const cache = useRef(new Map<string, FileItem[]>());
  const [items, setItems] = useState<FileItem[] | null>(cache.current.get(path) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<FileItem | null>(null);
  const sheetOpen = useModalPresence(!!selected);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);

  const load = useCallback(
    async (p: string, force = false) => {
      setError(null);
      const cached = cache.current.get(p);
      if (cached && !force) {
        setItems(cached);
        return;
      }
      if (!cached) setItems(null);
      try {
        const cmd = await runCommand(id, 'files.list', { path: p });
        const list: FileItem[] = cmd.result?.items ?? [];
        cache.current.set(p, list);
        setItems(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Lecture impossible');
      }
    },
    [id],
  );

  useEffect(() => {
    load(path);
  }, [load, path]);

  const go = (p: string) => {
    tap('select');
    setQuery('');
    setResults(null);
    setNotice(null);
    setPath(p);
    // Affiche aussitôt ce qui est en cache, puis rafraîchit en arrière-plan.
    setItems(cache.current.get(p) ?? null);
    scroller.current?.scrollTo({ y: 0, animated: false });
  };

  const search = async () => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const cmd = await runCommand(id, 'files.search', { query: query.trim(), root: path });
      setResults(cmd.result?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recherche impossible');
    } finally {
      setSearching(false);
    }
  };

  /** Action sur un fichier : voir, lancer sur le PC, enregistrer. */
  const act = async (f: FileItem, kind: 'view' | 'open' | 'save' | 'zip') => {
    setSelected(null);
    setBusy(f.path);
    setNotice(null);
    try {
      if (kind === 'open') {
        await runCommand(id, 'files.open', { path: f.path });
        setNotice({ ok: true, text: `« ${f.name} » ouvert sur ${device?.name ?? 'le PC'}` });
      } else {
        const cmd = await runCommand(id, kind === 'zip' ? 'files.zip' : 'files.get', { path: f.path });
        const r = cmd.result!;
        if (kind === 'save') {
          const saved = await saveToPhone(r.url, r.name);
          setNotice(saved === 'denied' ? { ok: false, text: 'Autorise ORION à ajouter des photos dans les Réglages.' } : { ok: true, text: `« ${r.name} » enregistré` });
        } else openPreview(r.url, r.name, formatSize(r.size));
      }
      tap('success');
    } catch (e) {
      tap('warning');
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Action impossible' });
    } finally {
      setBusy(null);
    }
  };

  const crumbs = path === '~' ? ['~'] : ['~', ...path.replace(/^~\//, '').split('/')];
  const list = results ?? items ?? [];
  const folders = list.filter((f) => f.kind === 'folder');
  const docs = list.filter((f) => f.kind === 'file');
  const here = path === '~' ? device?.name ?? 'Dossier personnel' : path.split('/').pop();

  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: here }} />
      <ScrollView
        ref={scroller}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + space.xxl }]}
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.accentText}
            onRefresh={async () => {
              setRefreshing(true);
              await load(path, true);
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={s.search}>
          <Ionicons name="search" size={17} color={c.textFaint} />
          <TextInput
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              if (!v) setResults(null);
            }}
            onSubmitEditing={search}
            placeholder={`Rechercher dans ${here}`}
            placeholderTextColor={c.textFaint}
            style={s.input}
            returnKeyType="search"
            accessibilityLabel="Rechercher dans ce dossier"
          />
          {searching ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
        </View>

        {/* Fil d'Ariane : chaque étape est cliquable */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.crumbs}>
          {crumbs.map((cr, i) => {
            const target = i === 0 ? '~' : `~/${crumbs.slice(1, i + 1).join('/')}`;
            const last = i === crumbs.length - 1;
            return (
              <View key={target} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {i > 0 ? <Ionicons name="chevron-forward" size={12} color={c.textFaint} style={{ marginHorizontal: 2 }} /> : null}
                <Pressable onPress={() => !last && go(target)} disabled={last} hitSlop={8} style={[s.crumb, last && s.crumbActive]} accessibilityRole="button" accessibilityLabel={`Aller à ${cr === '~' ? 'dossier personnel' : cr}`}>
                  {i === 0 ? <Ionicons name="home" size={13} color={last ? c.text : c.accentText} style={{ marginRight: 4 }} /> : null}
                  <Text style={[s.crumbText, { color: last ? c.text : c.accentText }]} numberOfLines={1}>
                    {cr === '~' ? device?.name ?? 'PC' : cr}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>

        {notice ? (
          <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOut} style={[s.notice, { backgroundColor: notice.ok ? c.onlineSoft : c.dangerSoft }]}>
            <Ionicons name={notice.ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={notice.ok ? c.online : c.danger} />
            <Text style={[t.footnote, { marginLeft: space.sm, flex: 1, color: notice.ok ? c.text : c.danger }]}>{notice.text}</Text>
          </Animated.View>
        ) : null}
        {error ? (
          <View style={[s.notice, { backgroundColor: c.dangerSoft }]}>
            <Ionicons name="alert-circle" size={16} color={c.danger} />
            <Text style={[t.footnote, { color: c.danger, marginLeft: space.sm, flex: 1 }]}>{error}</Text>
          </View>
        ) : null}

        {results ? (
          <Text style={[t.footnote, { marginBottom: space.sm, paddingHorizontal: space.xs }]}>
            {results.length} résultat(s) pour « {query} » dans {here}
          </Text>
        ) : null}

        <InsetList>
          {path !== '~' && !results ? (
            <ListRow
              onPress={() => go(parentOf(path))}
              leading={<Ionicons name="arrow-up-circle" size={26} color={c.accentText} />}
              title="Dossier parent"
              subtitle={parentOf(path) === '~' ? device?.name ?? 'Dossier personnel' : parentOf(path).split('/').pop()}
              last={!folders.length}
            />
          ) : null}
          {folders.map((f, i) => (
            <ListRow
              key={f.path}
              last={i === folders.length - 1}
              onPress={() => go(f.path)}
              leading={<Ionicons name="folder" size={26} color={c.accentText} />}
              title={f.name}
              subtitle={results ? f.path : `Modifié le ${new Date(f.modified).toLocaleDateString('fr-FR')}`}
              trailing={<Ionicons name="chevron-forward" size={16} color={c.textFaint} />}
            />
          ))}
        </InsetList>

        {items === null && !results && !error ? <ActivityIndicator color={c.accentText} style={{ marginTop: space.xl }} /> : null}
        {items && !list.length ? <Text style={[t.subhead, { textAlign: 'center', marginTop: space.xl }]}>{results ? 'Aucun résultat.' : 'Dossier vide.'}</Text> : null}

        {docs.length ? (
          <View style={{ marginTop: space.xl }}>
            <InsetList>
              {docs.map((f, i) => (
                <ListRow
                  key={f.path}
                  last={i === docs.length - 1}
                  onPress={() => {
                    tap('select');
                    setSelected(f);
                  }}
                  label={`${f.name}, ${formatSize(f.size)}`}
                  leading={<Ionicons name={extIcon(f.name)} size={24} color={isImage(f.name) || isVideo(f.name) || isAudio(f.name) ? c.accentText : c.textMuted} />}
                  title={f.name}
                  subtitle={`${formatSize(f.size)} · ${results ? f.path : new Date(f.modified).toLocaleDateString('fr-FR')}`}
                  trailing={busy === f.path ? <ActivityIndicator size="small" color={c.accentText} /> : <Ionicons name="ellipsis-horizontal-circle" size={22} color={c.textMuted} />}
                />
              ))}
            </InsetList>
          </View>
        ) : null}

        {path !== '~' && !results ? (
          <Pressable onPress={() => act({ name: here ?? 'dossier', path, kind: 'folder', size: null, modified: '' }, 'zip')} disabled={!!busy} style={({ pressed }) => [s.zip, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            {busy === path ? <ActivityIndicator size="small" color={c.accentText} /> : <Ionicons name="archive-outline" size={18} color={c.accentText} />}
            <Text style={s.zipText}>{busy === path ? 'Compression sur le PC…' : `Télécharger « ${here} » en .zip`}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Feuille d'actions d'un fichier */}
      <Modal visible={sheetOpen} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setSelected(null)}>
        {selected ? (
          <>
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={s.scrim}>
              <Pressable style={{ flex: 1 }} onPress={() => setSelected(null)} accessibilityLabel="Fermer" />
            </Animated.View>
            <Animated.View entering={SlideInDown.springify().damping(22)} exiting={SlideOutDown.duration(180)} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
              <View style={s.grabber} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg }}>
                <View style={s.sheetIcon}>
                  <Ionicons name={extIcon(selected.name)} size={22} color={c.accentText} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={t.headline} numberOfLines={2}>
                    {selected.name}
                  </Text>
                  <Text style={t.footnote}>{formatSize(selected.size)}</Text>
                </View>
              </View>
              {isViewable(selected.name) ? (
                <SheetButton icon={isVideo(selected.name) ? 'play-circle' : isAudio(selected.name) ? 'musical-notes' : 'eye'} label={isVideo(selected.name) || isAudio(selected.name) ? 'Lire sur le téléphone' : 'Voir sur le téléphone'} onPress={() => act(selected, 'view')} />
              ) : null}
              <SheetButton icon="desktop" label={`Lancer sur ${device?.name ?? 'le PC'}`} onPress={() => act(selected, 'open')} />
              <SheetButton icon="download" label={isImage(selected.name) ? 'Enregistrer dans Photos' : 'Enregistrer sur le téléphone'} onPress={() => act(selected, 'save')} />
            </Animated.View>
          </>
        ) : null}
      </Modal>
    </View>
  );
}

function SheetButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c, t } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.sm, borderRadius: radius.md }, pressed && { backgroundColor: c.fill }]} accessibilityRole="button">
      <Ionicons name={icon} size={22} color={c.accentText} />
      <Text style={t.callout}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, width: '100%', maxWidth: 680, alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: c.fill, gap: space.sm },
  input: { flex: 1, fontFamily: font.regular, fontSize: 16, color: c.text, height: '100%' },
  crumbs: { alignItems: 'center', paddingVertical: space.md, paddingRight: space.lg },
  crumb: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 30, borderRadius: 15 },
  crumbActive: { backgroundColor: c.fill },
  crumbText: { fontFamily: font.medium, fontSize: 13, maxWidth: 160 },
  notice: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  zip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 48, borderRadius: radius.md, backgroundColor: c.violetSoft, marginTop: space.xl },
  zipText: { fontFamily: font.semibold, fontSize: 14, color: c.accentText },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8, 5, 14, 0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, maxWidth: 560, alignSelf: 'center', width: '100%' },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.fillStrong, marginBottom: space.lg },
  sheetIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' },
}));
