import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { lastSeen } from '@/api/format';
import { refreshDevices, useDevices, useLive } from '@/api/live';
import { IconButton, InsetList, LargeHeader, ListRow, OsGlyph, Screen, SectionHeader } from '@/components/ui';
import { space, useTheme } from '@/theme';

export default function DevicesScreen() {
  const { c, t } = useTheme();
  const devices = useDevices();
  const loaded = useLive((s) => s.loaded);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    try {
      await refreshDevices();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible');
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const online = devices.filter((d) => d.online).length;
  return (
    <Screen inStack>
      <LargeHeader
        title="Appareils"
        subtitle={devices.length ? `${online} sur ${devices.length} prêt${online > 1 ? 's' : ''} à recevoir tes ordres` : 'Associe un premier PC pour commencer'}
        right={<IconButton icon="add" label="Associer un PC" onPress={() => router.push('/associer')} />}
      />

      {!loaded && !error ? <ActivityIndicator color={c.accentText} style={{ marginTop: space.xl }} /> : null}
      {error ? (
        <View style={{ flexDirection: 'row', backgroundColor: c.dangerSoft, borderRadius: 14, padding: space.md, marginBottom: space.lg }}>
          <Ionicons name="cloud-offline" size={16} color={c.danger} />
          <Text style={[t.footnote, { color: c.danger, marginLeft: space.sm, flex: 1 }]}>{error}</Text>
        </View>
      ) : null}

      {devices.length ? (
        <InsetList>
          {devices.map((d, i) => {
            const color = d.online ? c.online : c.textMuted;
            return (
              <ListRow
                key={d.id}
                last={i === devices.length - 1}
                onPress={() => router.push(`/device/${d.id}`)}
                label={`${d.name}, ${d.osVersion}, ${lastSeen(d)}`}
                leading={<OsGlyph os={d.os} size={44} />}
                title={d.name}
                subtitle={d.osVersion}
                trailing={
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, marginRight: 6 }} />
                    <Text style={[t.footnote, { color, marginRight: space.sm }]}>{d.online ? 'En ligne' : 'Hors ligne'}</Text>
                    <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                  </View>
                }
              />
            );
          })}
        </InsetList>
      ) : null}

      <SectionHeader>Ajouter</SectionHeader>
      <InsetList>
        <ListRow
          onPress={() => router.push('/associer')}
          leading={
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="keypad" size={20} color={c.accentText} />
            </View>
          }
          title="Associer un PC"
          subtitle="Un code à saisir dans l’agent ORION du PC"
          last
          trailing={<Ionicons name="chevron-forward" size={16} color={c.textFaint} />}
        />
      </InsetList>
      <Text style={[t.footnote, { marginTop: space.md, paddingHorizontal: space.xs, color: c.textFaint }]}>
        Fonctionne avec macOS, Windows et Ubuntu. Le téléphone pilote, le PC exécute.
      </Text>
    </Screen>
  );
}
