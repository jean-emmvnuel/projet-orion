import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getCoreUrl } from '@/api/client';
import { createPairingCode, useDevices } from '@/api/live';
import { OsGlyph, PressableScale, tap } from '@/components/ui';
import { font, makeStyles, radius, space, useTheme } from '@/theme';

/**
 * Associer un PC : le Core délivre un code à 6 chiffres (10 min) ; on le saisit dans l'agent.
 * L'écran guette l'arrivée du nouveau PC en temps réel et confirme l'association.
 */
export default function AssocierScreen() {
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const devices = useDevices();
  const initialIds = useRef(new Set(devices.map((d) => d.id)));
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const fresh = async () => {
    setError(null);
    setCode(null);
    try {
      setCode(await createPairingCode());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’obtenir un code');
    }
  };
  useEffect(() => {
    fresh();
    const tm = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tm);
  }, []);

  const paired = devices.find((d) => !initialIds.current.has(d.id));
  useEffect(() => {
    if (paired) tap('success');
  }, [paired]);

  const left = code ? Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
  const command = code ? `orion-agent pair ${code.code} --server ${getCoreUrl()}` : '';

  if (paired) {
    return (
      <View style={[s.root, s.center, { paddingBottom: insets.bottom }]}>
        <Animated.View entering={ZoomIn.springify().damping(14)}>
          <OsGlyph os={paired.os} size={84} tint={c.onlineSoft} />
        </Animated.View>
        <Animated.Text entering={FadeIn.delay(150)} style={[t.title, { marginTop: space.xl, textAlign: 'center' }]}>
          {paired.name} est associé
        </Animated.Text>
        <Text style={[t.subhead, { marginTop: space.xs, textAlign: 'center' }]}>{paired.osVersion} · prêt à recevoir tes ordres</Text>
        <PressableScale style={[s.primary, { marginTop: space.xxl }]} onPress={() => router.replace(`/device/${paired.id}`)} accessibilityRole="button">
          <Text style={s.primaryText}>Ouvrir {paired.name}</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + space.xxl }]}>
      <Text style={[t.subhead, { textAlign: 'center' }]}>Saisis ce code dans l’agent ORION de ton PC.</Text>

      <View style={s.codeBox} accessible accessibilityLabel={code ? `Code ${code.code.split('').join(' ')}` : 'Code en préparation'}>
        {code ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {code.code.split('').map((d, i) => (
              <Animated.View key={i} entering={FadeIn.delay(i * 60)} style={s.digit}>
                <Text style={s.digitText}>{d}</Text>
              </Animated.View>
            ))}
          </View>
        ) : error ? (
          <Text style={[t.footnote, { color: c.danger, textAlign: 'center' }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={c.accentText} />
        )}
        {code ? (
          <Text style={[t.footnote, { marginTop: space.md, fontVariant: ['tabular-nums'] }]}>
            {left > 0 ? `Valable encore ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expiré'}
          </Text>
        ) : null}
      </View>

      {code && left === 0 ? (
        <PressableScale style={s.primary} onPress={fresh} accessibilityRole="button">
          <Text style={s.primaryText}>Nouveau code</Text>
        </PressableScale>
      ) : null}

      <Text style={[t.headline, { fontSize: 15, marginTop: space.xl }]}>Sur le PC</Text>
      <View style={s.step}>
        <Text style={s.stepNum}>1</Text>
        <Text style={[t.callout, { flex: 1 }]}>Installe l’agent : dossier « agent » du projet ORION.</Text>
      </View>
      <View style={s.step}>
        <Text style={s.stepNum}>2</Text>
        <View style={{ flex: 1 }}>
          <Text style={t.callout}>Lance dans un terminal :</Text>
          <PressableScale
            style={s.cmd}
            scaleTo={0.98}
            onPress={async () => {
              await Clipboard.setStringAsync(command).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
            accessibilityRole="button"
            accessibilityLabel="Copier la commande"
          >
            <Text style={s.cmdText} selectable>
              {command || '…'}
            </Text>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? c.online : c.textMuted} />
          </PressableScale>
        </View>
      </View>
      <View style={s.step}>
        <Text style={s.stepNum}>3</Text>
        <Text style={[t.callout, { flex: 1 }]}>Puis « orion-agent run ». Cet écran se met à jour tout seul.</Text>
      </View>

      <View style={s.waiting}>
        <ActivityIndicator size="small" color={c.textMuted} />
        <Text style={[t.footnote, { marginLeft: space.sm }]}>En attente du PC…</Text>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  content: { padding: space.xl, width: '100%', maxWidth: 520, alignSelf: 'center' },
  codeBox: { alignItems: 'center', justifyContent: 'center', minHeight: 140, marginTop: space.xl, backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xl },
  digit: { width: 44, height: 58, borderRadius: 12, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  digitText: { fontFamily: font.bold, fontSize: 30, color: c.text, fontVariant: ['tabular-nums'] },
  primary: { height: 52, paddingHorizontal: space.xl, borderRadius: radius.pill, backgroundColor: c.violet, alignItems: 'center', justifyContent: 'center', marginTop: space.lg },
  primaryText: { fontFamily: font.semibold, fontSize: 16, color: c.onViolet },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginTop: space.lg },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.violetSoft, color: c.accentText, textAlign: 'center', lineHeight: 24, fontFamily: font.semibold, fontSize: 13, overflow: 'hidden' },
  cmd: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, backgroundColor: c.surface, borderRadius: radius.md, padding: space.md },
  cmdText: { flex: 1, fontFamily: 'monospace', fontSize: 12, color: c.text },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: space.xxl },
}));
