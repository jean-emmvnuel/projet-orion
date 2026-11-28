import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { ACTION_META, commandDetail, dayOf, timeOf } from '@/api/format';
import { listCommands, useLive } from '@/api/live';
import type { Command } from '@/api/types';
import { InsetList, LargeHeader, ListRow, Screen, SectionHeader, StatusIcon } from '@/components/ui';
import { space, useTheme } from '@/theme';

/** Historique réel des commandes envoyées aux PC, mis à jour en direct. */
export default function ActivityScreen() {
  const { c, t } = useTheme();
  const [history, setHistory] = useState<Command[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useLive((s) => s.commands);

  useEffect(() => {
    listCommands(100)
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : 'Chargement impossible'));
  }, []);

  // Fusionne l'historique chargé et les mises à jour reçues en direct.
  const items = useMemo(() => {
    const map = new Map((history ?? []).map((x) => [x.id, x]));
    for (const cmd of Object.values(live)) map.set(cmd.id, { ...map.get(cmd.id), ...cmd });
    return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [history, live]);

  const days = useMemo(() => {
    const groups: { day: string; items: Command[] }[] = [];
    for (const cmd of items) {
      const day = dayOf(cmd.createdAt);
      const g = groups.find((x) => x.day === day);
      if (g) g.items.push(cmd);
      else groups.push({ day, items: [cmd] });
    }
    return groups;
  }, [items]);

  return (
    <Screen inStack>
      <LargeHeader title="Activité" subtitle="Ce que tu as demandé à tes PC" />
      {!history && !error ? <ActivityIndicator color={c.accentText} /> : null}
      {error ? <Text style={[t.footnote, { color: c.danger }]}>{error}</Text> : null}
      {history && !items.length ? (
        <View style={{ alignItems: 'center', marginTop: space.xxl }}>
          <Ionicons name="time-outline" size={36} color={c.textFaint} />
          <Text style={[t.subhead, { marginTop: space.md }]}>Aucune action pour l’instant.</Text>
        </View>
      ) : null}
      {days.map((g, i) => (
        <View key={g.day}>
          {i > 0 ? <SectionHeader>{g.day}</SectionHeader> : <Text style={[t.headline, { fontSize: 15, marginBottom: space.md, paddingHorizontal: space.xs }]}>{g.day}</Text>}
          <InsetList>
            {g.items.map((cmd, k) => {
              const failed = cmd.status === 'failed' || cmd.status === 'timeout';
              const meta = ACTION_META[cmd.action] ?? { label: cmd.action, icon: 'flash' };
              return (
                <ListRow
                  key={cmd.id}
                  last={k === g.items.length - 1}
                  leading={
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: failed ? c.dangerSoft : c.violetSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={meta.icon} size={17} color={failed ? c.danger : c.accentText} />
                    </View>
                  }
                  title={meta.label}
                  subtitle={`${cmd.device?.name ?? ''}${cmd.device ? ' · ' : ''}${commandDetail(cmd)}`}
                  trailing={
                    <View style={{ alignItems: 'flex-end', marginLeft: space.sm }}>
                      <Text style={[t.caption, { fontVariant: ['tabular-nums'] }]}>{timeOf(cmd.createdAt)}</Text>
                      <View style={{ marginTop: 4 }}>
                        <StatusIcon status={cmd.status} />
                      </View>
                    </View>
                  }
                />
              );
            })}
          </InsetList>
        </View>
      ))}
    </Screen>
  );
}
