import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet, Composer, ContextMenu } from '@/components/chat';
import { IconButton, InsetList, ListRow, OrionMark, tap } from '@/components/ui';
import type { Conversation } from '@/data/conversations';
import { store, useConversations } from '@/data/store';
import { dayOf, timeOf } from '@/api/format';
import { font, makeStyles, radius, space, useLayout, useTheme } from '@/theme';

/**
 * Accueil = historique des conversations, comme l'app Siri :
 * grille de cartes (ou liste), recherche, épinglées en tête, appui long pour
 * épingler / renommer / supprimer, et la barre « + | Demander à ORION | micro » en bas.
 */

export default function HistoryScreen() {
  const all = useConversations();
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { wide, gutter, narrow } = useLayout();
  const cols = wide ? 3 : 2;
  const [grid, setGrid] = useState(true);
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<Conversation | null>(null);
  const [appMenu, setAppMenu] = useState(false);
  const [attach, setAttach] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((x) => x.title.toLowerCase().includes(q) || x.preview.toLowerCase().includes(q)) : all;
  }, [all, query]);
  const pinned = filtered.filter((x) => x.pinned);
  const sections = useMemo(() => {
    const groups: { day: string; items: Conversation[] }[] = [];
    for (const conv of [...filtered].filter((x) => !x.pinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const day = dayOf(conv.updatedAt);
      const g = groups.find((x) => x.day === day);
      if (g) g.items.push(conv);
      else groups.push({ day, items: [conv] });
    }
    return groups;
  }, [filtered]);

  const open = (conv: Conversation) => router.push(`/conversation/${conv.id}`);
  const longPress = (conv: Conversation) => {
    tap('medium');
    setMenuFor(conv);
  };

  const renderGroup = (items: Conversation[]) =>
    grid ? (
      <View style={s.grid}>
        {Array.from({ length: cols }, (_, col) => col).map((col) => (
          <View key={col} style={s.column}>
            {items
              .filter((_, i) => i % cols === col)
              .map((conv) => (
                <Animated.View key={conv.id} layout={LinearTransition.springify().damping(22)} entering={FadeIn}>
                  <Pressable
                    onPress={() => open(conv)}
                    onLongPress={() => longPress(conv)}
                    delayLongPress={350}
                    style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${conv.title}. ${conv.preview}`}
                    accessibilityHint="Appui long pour épingler, renommer ou supprimer"
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[t.caption, { flex: 1 }]}>{timeOf(conv.updatedAt)}</Text>
                      {conv.pinned ? <Ionicons name="pin" size={12} color={c.accentText} /> : null}
                    </View>
                    <Text style={s.cardTitle}>{conv.title}</Text>
                    <Text style={s.cardPreview} numberOfLines={5}>
                      {conv.preview}
                    </Text>
                  </Pressable>
                </Animated.View>
              ))}
          </View>
        ))}
      </View>
    ) : (
      <InsetList>
        {items.map((conv, i) => (
          <Pressable key={conv.id} onLongPress={() => longPress(conv)} delayLongPress={350}>
            <ListRow
              last={i === items.length - 1}
              onPress={() => open(conv)}
              title={conv.title}
              subtitle={conv.preview}
              trailing={<Text style={[t.caption, { marginLeft: space.sm }]}>{timeOf(conv.updatedAt)}</Text>}
            />
          </Pressable>
        ))}
      </InsetList>
    );

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + space.sm, paddingBottom: 96 + Math.max(insets.bottom, space.md), paddingHorizontal: gutter + Math.max(insets.left, insets.right) }]} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag">
        <View style={s.topBar}>
          <IconButton icon="apps-outline" label="Menu ORION" onPress={() => setAppMenu(true)} />
          <View style={{ flexDirection: 'row' }}>
            <IconButton icon="mic-outline" label="Mode vocal" onPress={() => router.push('/voix')} />
            <IconButton
              icon={grid ? 'list-outline' : 'grid-outline'}
              label={grid ? 'Afficher en liste' : 'Afficher en grille'}
              onPress={() => {
                tap('select');
                setGrid((g) => !g);
              }}
            />
          </View>
        </View>

        <View style={s.titleRow}>
          <OrionMark size={30} />
          <Text style={[t.largeTitle, { marginLeft: space.md }, narrow && { fontSize: 30, lineHeight: 36 }]} accessibilityRole="header">
            ORION
          </Text>
        </View>

        <View style={s.search}>
          <Ionicons name="search" size={17} color={c.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={narrow ? 'Rechercher' : 'Rechercher dans les conversations'}
            placeholderTextColor={c.textFaint}
            style={s.searchInput}
            accessibilityLabel="Rechercher dans les conversations"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="Effacer la recherche" hitSlop={10}>
              <Ionicons name="close-circle" size={17} color={c.textFaint} />
            </Pressable>
          ) : null}
        </View>

        {pinned.length ? (
          <>
            <Text style={s.section}>Épinglées</Text>
            {renderGroup(pinned)}
          </>
        ) : null}
        {sections.map((sec) => (
          <View key={sec.day}>
            <Text style={s.section}>{sec.day}</Text>
            {renderGroup(sec.items)}
          </View>
        ))}
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="chatbubbles-outline" size={36} color={c.textFaint} />
            <Text style={[t.subhead, { marginTop: space.md, textAlign: 'center' }]}>
              {query ? `Aucune conversation ne contient « ${query} ».` : 'Pas encore de conversation. Demande quelque chose à ORION.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <Composer entry onEntry={() => router.push('/conversation/nouvelle')} onMic={() => router.push('/voix')} onPlus={() => setAttach(true)} />

      <ContextMenu
        visible={!!menuFor}
        title={menuFor?.title ?? ''}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                { icon: menuFor.pinned ? 'pin-outline' : 'pin', label: menuFor.pinned ? 'Désépingler' : 'Épingler', onPress: () => store.togglePin(menuFor.id) },
                { icon: 'pencil', label: 'Renommer', onPress: () => setRenaming({ id: menuFor.id, title: menuFor.title }) },
                { icon: 'trash', label: 'Supprimer', danger: true, onPress: () => store.remove(menuFor.id) },
              ]
            : []
        }
      />

      <ContextMenu
        visible={appMenu}
        title="ORION"
        onClose={() => setAppMenu(false)}
        actions={[
          { icon: 'desktop-outline', label: 'Appareils', onPress: () => router.push('/appareils') },
          { icon: 'time-outline', label: 'Activité des PC', onPress: () => router.push('/activite') },
          { icon: 'color-palette-outline', label: 'Personnaliser ORION', onPress: () => router.push('/personnaliser') },
        ]}
      />

      <AttachSheet
        visible={attach}
        onClose={() => setAttach(false)}
        onPick={() => {
          setAttach(false);
          router.push('/conversation/nouvelle');
        }}
      />

      {renaming ? (
        <RenameBar
          title={renaming.title}
          onCancel={() => setRenaming(null)}
          onSave={(title) => {
            store.rename(renaming.id, title);
            setRenaming(null);
          }}
        />
      ) : null}
    </View>
  );
}

/** Barre de renommage en haut de l'écran. */
function RenameBar({ title, onSave, onCancel }: { title: string; onSave: (t: string) => void; onCancel: () => void }) {
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(title);
  return (
    <View style={[s.renameWrap, { paddingTop: insets.top + space.sm }]}>
      <Text style={[t.footnote, { marginBottom: space.sm }]}>Renommer la conversation</Text>
      <TextInput value={value} onChangeText={setValue} autoFocus style={s.renameInput} onSubmitEditing={() => onSave(value.trim() || title)} accessibilityLabel="Nouveau titre" />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.lg, marginTop: space.md }}>
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text style={[t.callout, { color: c.textMuted }]}>Annuler</Text>
        </Pressable>
        <Pressable onPress={() => onSave(value.trim() || title)} hitSlop={8}>
          <Text style={[t.callout, { color: c.accentText, fontFamily: font.semibold }]}>Enregistrer</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c, t) => ({
  root: { flex: 1, backgroundColor: c.bg },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginLeft: -space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg, marginBottom: space.lg },
  search: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: c.fill, gap: space.sm },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 16, color: c.text, height: '100%' },
  section: { ...t.headline, fontSize: 15, color: c.textMuted, marginTop: space.xl, marginBottom: space.md, paddingHorizontal: space.xs },
  grid: { flexDirection: 'row', gap: space.md },
  column: { flex: 1, gap: space.md },
  card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg, minHeight: 140, shadowColor: c.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  cardTitle: { fontFamily: font.bold, fontSize: 18, lineHeight: 22, letterSpacing: -0.4, color: c.text, marginTop: space.sm },
  cardPreview: { ...t.footnote, marginTop: space.sm, lineHeight: 18 },
  empty: { alignItems: 'center', paddingTop: space.xxxl, paddingHorizontal: space.xl },
  renameWrap: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: c.surfaceRaised, padding: space.lg, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, shadowColor: c.shadow, shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  renameInput: { fontFamily: font.semibold, fontSize: 18, color: c.text, backgroundColor: c.fill, borderRadius: radius.md, paddingHorizontal: space.md, height: 46 },
}));
