import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { runCommand, useDevice } from '@/api/live';
import { type IconName, InsetList, ListRow, PressableScale, tap } from '@/components/ui';
import { font, makeStyles, radius, space, useTheme } from '@/theme';

/** Applications installées sur le PC : chercher, puis ouvrir d'un toucher (et la voir en direct). */
interface App {
  id: string;
  name: string;
  comment: string;
  category: string;
}

const CATS: { key: string; label: string; icon: IconName; color: string }[] = [
  { key: 'all', label: 'Toutes', icon: 'apps', color: '#9810e6' },
  { key: 'web', label: 'Web', icon: 'globe', color: '#2f80ed' },
  { key: 'dev', label: 'Dev', icon: 'code-slash', color: '#7a5af8' },
  { key: 'office', label: 'Bureautique', icon: 'document-text', color: '#0f9e66' },
  { key: 'media', label: 'Médias', icon: 'play-circle', color: '#e5484d' },
  { key: 'graphics', label: 'Images', icon: 'color-palette', color: '#f5a524' },
  { key: 'chat', label: 'Messages', icon: 'chatbubbles', color: '#12a4c7' },
  { key: 'game', label: 'Jeux', icon: 'game-controller', color: '#d6409f' },
  { key: 'system', label: 'Système', icon: 'settings', color: '#6f6879' },
  { key: 'other', label: 'Autres', icon: 'cube', color: '#857f90' },
];
const META = Object.fromEntries(CATS.map((c) => [c.key, c]));

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function AppsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useDevice(id);
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      const cmd = await runCommand(id, 'apps.list');
      setApps(cmd.result?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Liste indisponible');
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const visible = useMemo(() => {
    const q = norm(query.trim());
    return (apps ?? []).filter((a) => (cat === 'all' || a.category === cat) && (!q || norm(a.name).includes(q) || norm(a.comment).includes(q)));
  }, [apps, query, cat]);
  const present = useMemo(() => new Set((apps ?? []).map((a) => a.category)), [apps]);

  const open = async (a: App) => {
    if (!id) return;
    setBusy(a.id);
    try {
      await runCommand(id, 'apps.open', { id: a.id });
      tap('success');
      setOpened(a.name);
      setTimeout(() => setOpened((o) => (o === a.name ? null : o)), 6000);
    } catch (e) {
      tap('warning');
      setError(e instanceof Error ? e.message : 'Ouverture impossible');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: 'Applications' }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={s.inner}>
          <View style={s.search}>
            <Ionicons name="search" size={17} color={c.textFaint} />
            <TextInput value={query} onChangeText={setQuery} placeholder={`Chercher une appli sur ${device?.name ?? 'le PC'}`} placeholderTextColor={c.textFaint} style={s.searchInput} autoCorrect={false} returnKeyType="search" accessibilityLabel="Chercher une application" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.md }}>
            {CATS.filter((k) => k.key === 'all' || present.has(k.key)).map((k) => {
              const on = k.key === cat;
              return (
                <PressableScale key={k.key} onPress={() => setCat(k.key)} scaleTo={0.95} style={[s.chip, on && { backgroundColor: c.violet }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Ionicons name={k.icon} size={14} color={on ? c.onViolet : c.textMuted} />
                  <Text style={[s.chipText, { color: on ? c.onViolet : c.text }]}>{k.label}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>

          {error ? <Text style={[t.footnote, { color: c.danger, marginBottom: space.md }]}>{error}</Text> : null}
          {!apps && !error ? <ActivityIndicator color={c.accentText} style={{ marginTop: space.xxl }} /> : null}
          {apps && !visible.length ? <Text style={[t.subhead, { textAlign: 'center', marginTop: space.xl }]}>Aucune application ne correspond.</Text> : null}

          {visible.length ? (
            <InsetList>
              {visible.map((a, i) => {
                const m = META[a.category] ?? META.other;
                return (
                  <ListRow
                    key={a.id}
                    last={i === visible.length - 1}
                    title={a.name}
                    subtitle={a.comment || m.label}
                    onPress={() => open(a)}
                    label={`Ouvrir ${a.name} sur le PC`}
                    leading={
                      <View style={[s.tile, { backgroundColor: m.color }]}>
                        <Text style={s.tileText}>{a.name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                    }
                    trailing={busy === a.id ? <ActivityIndicator color={c.accentText} /> : <Ionicons name="open-outline" size={18} color={c.textFaint} />}
                  />
                );
              })}
            </InsetList>
          ) : null}
        </View>
      </ScrollView>

      {opened ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={[s.toast, { bottom: insets.bottom + space.lg }]}>
          <Ionicons name="checkmark-circle" size={18} color={c.online} />
          <Text style={[t.callout, { flex: 1, marginLeft: space.sm }]} numberOfLines={1}>
            {opened} s’ouvre sur le PC
          </Text>
          <PressableScale onPress={() => router.push({ pathname: '/device/remote', params: { id } })} style={s.toastBtn} accessibilityRole="button">
            <Text style={{ color: c.onViolet, fontFamily: font.semibold, fontSize: 13 }}>Voir l’écran</Text>
          </PressableScale>
        </Animated.View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  inner: { paddingHorizontal: space.lg, paddingTop: space.sm, width: '100%', maxWidth: 640, alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.fill, borderRadius: radius.md, paddingHorizontal: space.md, height: 44 },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 16, color: c.text },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: c.surface },
  chipText: { fontFamily: font.medium, fontSize: 13 },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: '#fff', fontFamily: font.bold, fontSize: 16 },
  toast: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space.md, shadowColor: c.shadow, shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  toastBtn: { backgroundColor: c.violet, borderRadius: radius.pill, paddingHorizontal: space.md, height: 34, justifyContent: 'center' },
}));
