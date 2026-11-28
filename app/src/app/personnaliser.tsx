import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OrionOrb, speechEnvelope } from '@/components/orb/OrionOrb';
import { orbPalettes } from '@/components/orb/palettes';
import { InsetList, ListRow, PressableScale, Segmented, SectionHeader, SwitchRow, tap, useReducedMotion } from '@/components/ui';
import { useSession } from '@/api/session';
import { font, makeStyles, radius, space, useTheme } from '@/theme';
import { AppearanceMode, KeepHistory, OrbDensity, OrbPalette, OrbReactivity, OrbStyle, useAppearance } from '@/theme/appearance';

/**
 * Personnalisation de l'animation d'ORION, avec aperçu en direct :
 * l'orbe « parle » en boucle pour juger immédiatement chaque réglage.
 * Les choix sont enregistrés sur l'appareil.
 */
export default function Personnaliser() {
  const { c, t } = useTheme();
  const s = useStyles();
  const reduced = useReducedMotion();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const { orb, setOrb, resetOrb, mode, setMode, scheme, keep, setKeep } = useAppearance();

  // Voix simulée en boucle : 2,6 s de parole, 1,2 s de silence.
  const amp = useSharedValue(0);
  const clock = useSharedValue(0);
  useFrameCallback((f) => {
    'worklet';
    clock.value += (f.timeSincePreviousFrame ?? 16) / 1000;
    const cycle = clock.value % 3.8;
    amp.value = cycle < 2.6 ? speechEnvelope(clock.value, 1) : 0;
  });

  return (
    <ScrollView style={s.root} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + space.xxxl }]} showsVerticalScrollIndicator={false}>
      <View style={s.preview}>
        <OrionOrb size={240} amplitude={amp} mode="speaking" settings={orb} scheme={scheme} reducedMotion={reduced} />
        <Text style={[t.footnote, { marginTop: space.xs }]}>Aperçu : ORION parle · fais-la tourner du doigt</Text>
      </View>

      <SectionHeader>Style</SectionHeader>
      <Segmented<OrbStyle>
        label="Style de l’orbe"
        value={orb.style}
        onChange={(style) => setOrb({ style })}
        options={[
          { value: 'constellation', label: 'Constellation' },
          { value: 'energie', label: 'Énergie' },
        ]}
      />
      <Text style={[t.footnote, { marginTop: space.sm, paddingHorizontal: space.xs }]}>
        {orb.style === 'constellation'
          ? 'Une sphère de points reliés par des fils lumineux, qui tourne et se hérisse quand ORION parle.'
          : 'Des particules en orbite autour d’un noyau, avec des rayons qui jaillissent.'}
      </Text>

      <SectionHeader>Couleurs</SectionHeader>
      <View style={s.swatches} accessibilityRole="radiogroup" accessibilityLabel="Palette de l’orbe">
        {(Object.keys(orbPalettes) as OrbPalette[]).map((key) => {
          const p = orbPalettes[key];
          const on = orb.palette === key;
          return (
            <PressableScale
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.label}
              onPress={() => setOrb({ palette: key })}
              style={s.swatch}
              scaleTo={0.92}
            >
              <View style={[s.swatchRing, on && { borderColor: c.text }]}>
                <View style={[s.swatchDisc, { backgroundColor: p.glow }]}>
                  <View style={[s.swatchCore, { backgroundColor: p.core }]} />
                  <View style={[s.swatchSpark, { backgroundColor: p.particles[1], top: 8, left: 10 }]} />
                  <View style={[s.swatchSpark, { backgroundColor: p.particles[2], bottom: 9, right: 9 }]} />
                </View>
              </View>
              <Text style={[t.caption, { color: on ? c.text : c.textMuted, marginTop: space.sm, fontFamily: on ? font.semibold : font.medium }]}>{p.label}</Text>
            </PressableScale>
          );
        })}
      </View>

      <SectionHeader>Mouvement</SectionHeader>
      <View style={s.group}>
        <Text style={s.label}>Densité des particules</Text>
        <Segmented<OrbDensity>
          label="Densité des particules"
          value={orb.density}
          onChange={(density) => setOrb({ density })}
          options={[
            { value: 'legere', label: 'Légère' },
            { value: 'normale', label: 'Normale' },
            { value: 'dense', label: 'Dense' },
          ]}
        />
        <Text style={[s.label, { marginTop: space.lg }]}>Vitesse</Text>
        <Segmented<number>
          label="Vitesse de rotation"
          value={orb.speed}
          onChange={(speed) => setOrb({ speed })}
          options={[
            { value: 0.5, label: 'Calme' },
            { value: 1, label: 'Normale' },
            { value: 1.6, label: 'Vive' },
          ]}
        />
        <Text style={[s.label, { marginTop: space.lg }]}>Réaction à la voix</Text>
        <Segmented<OrbReactivity>
          label="Réaction à la voix"
          value={orb.reactivity}
          onChange={(reactivity) => setOrb({ reactivity })}
          options={[
            { value: 'douce', label: 'Douce' },
            { value: 'normale', label: 'Normale' },
            { value: 'intense', label: 'Intense' },
          ]}
        />
      </View>

      <SectionHeader>Effets</SectionHeader>
      <InsetList>
        <SwitchRow
          title={orb.style === 'constellation' ? 'Pointes' : 'Rayons'}
          subtitle={orb.style === 'constellation' ? 'Les points jaillissent quand ORION parle' : 'Jaillissent du noyau quand ORION parle'}
          value={orb.rays}
          onChange={(rays) => setOrb({ rays })}
        />
        {orb.style === 'energie' ? (
          <SwitchRow title="Orbites lumineuses" subtitle="Les deux anneaux du « O réciproque »" value={orb.orbits} onChange={(orbits) => setOrb({ orbits })} />
        ) : null}
        <SwitchRow title="Halo des bords" subtitle="Lumière irisée autour de l’écran" value={orb.edgeGlow} onChange={(edgeGlow) => setOrb({ edgeGlow })} last />
      </InsetList>
      {reduced ? (
        <Text style={[t.footnote, { marginTop: space.sm, paddingHorizontal: space.xs }]}>
          « Réduire les animations » est activé sur ton téléphone : l’orbe reste calme et les rayons sont masqués.
        </Text>
      ) : null}

      <SectionHeader>Apparence</SectionHeader>
      <View style={s.group}>
        <Segmented<AppearanceMode>
          label="Apparence de l’app"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'system', label: 'Système' },
            { value: 'light', label: 'Clair' },
            { value: 'dark', label: 'Sombre' },
          ]}
        />
      </View>

      <SectionHeader>Compte</SectionHeader>
      <InsetList>
        <ListRow title={session.user?.username ?? 'Mon compte'} subtitle={session.user?.email} />
        <ListRow title="Serveur ORION Core" subtitle={session.coreUrl.replace(/^https?:\/\//, '')} />
        <ListRow
          title="Se déconnecter"
          last
          onPress={() => {
            session.logout();
          }}
          trailing={<Ionicons name="log-out-outline" size={18} color={c.danger} />}
        />
      </InsetList>

      <SectionHeader>Historique</SectionHeader>
      <View style={s.group}>
        <Text style={s.label}>Conserver les conversations</Text>
        <Segmented<KeepHistory>
          label="Durée de conservation des conversations"
          value={keep}
          onChange={setKeep}
          options={[
            { value: '30j', label: '30 jours' },
            { value: '1an', label: '1 an' },
            { value: 'toujours', label: 'Toujours' },
          ]}
        />
        <Text style={[t.footnote, { marginTop: space.sm }]}>Les ordres courts (« verrouille », « capture ») ne sont pas gardés au-delà de 24 h.</Text>
      </View>

      <Pressable
        onPress={() => {
          tap('light');
          resetOrb();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [s.reset, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="refresh" size={16} color={c.accentText} />
        <Text style={[t.callout, { color: c.accentText, marginLeft: space.sm, fontFamily: font.semibold }]}>Rétablir l’animation par défaut</Text>
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((c, t) => ({
  root: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: space.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
  preview: { alignItems: 'center', paddingTop: space.md },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  swatch: { alignItems: 'center', width: '33.33%' },
  swatchRing: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchDisc: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  swatchCore: { width: 14, height: 14, borderRadius: 7, shadowColor: '#fff', shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  swatchSpark: { position: 'absolute', width: 4, height: 4, borderRadius: 2 },
  group: { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg },
  label: { ...t.footnote, color: c.textMuted, marginBottom: space.sm, fontFamily: font.medium },
  reset: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: space.xxl },
}));

