import { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

/**
 * Outil de développement (web uniquement) : simule les zones de sécurité d'un iPhone
 * pour vérifier la mise en page dans le navigateur.
 *   ?iphone=1           → iPhone 16 Pro (Dynamic Island, home bar)
 *   ?iphone=se          → iPhone SE (barre d'état fine, bouton d'accueil)
 *   &theme=light|dark   → force le thème sans toucher aux réglages enregistrés
 *   &splash=lent        → animation d'ouverture 4× plus lente
 * Sans paramètre, ne fait rien. N'a aucun effet sur iOS / Android.
 */
const params = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const device = params?.get('iphone') ?? null;

/** ?splash=lent → ouverture 4× plus lente, pour vérifier chaque étape. */
export const previewSplashSlow = params?.get('splash') === 'lent' ? 4 : 1;

export const previewTheme = (params?.get('theme') as 'light' | 'dark' | null) ?? null;

const PROFILES = {
  '1': { insets: { top: 62, bottom: 34, left: 0, right: 0 }, island: true },
  se: { insets: { top: 20, bottom: 0, left: 0, right: 0 }, island: false },
} as const;

export function DevicePreview({ children, dark }: { children: ReactNode; dark: boolean }) {
  const profile = device ? PROFILES[device as keyof typeof PROFILES] : undefined;
  if (!profile) return <>{children}</>;
  const ink = dark ? '#ffffff' : '#000000';
  return (
    <SafeAreaInsetsContext.Provider value={profile.insets}>
      <View style={{ flex: 1 }}>
        {children}
        {/* Repères visuels : zone de la barre d'état, Dynamic Island, home bar */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: profile.insets.top, backgroundColor: 'rgba(255, 0, 80, 0.12)', zIndex: 999 }}>
          <View style={{ position: 'absolute', left: 22, top: profile.island ? 20 : 2, flexDirection: 'row' }}>
            <View style={{ width: 34, height: 12, borderRadius: 3, backgroundColor: ink, opacity: 0.85 }} />
          </View>
          <View style={{ position: 'absolute', right: 22, top: profile.island ? 20 : 2, width: 46, height: 12, borderRadius: 3, backgroundColor: ink, opacity: 0.85 }} />
          {profile.island ? (
            <View style={{ position: 'absolute', top: 11, alignSelf: 'center', width: 124, height: 36, borderRadius: 18, backgroundColor: '#000' }} />
          ) : null}
        </View>
        {profile.insets.bottom ? (
          <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: profile.insets.bottom, backgroundColor: 'rgba(255, 0, 80, 0.12)', zIndex: 999, alignItems: 'center', justifyContent: 'flex-end' }}>
            <View style={{ width: 134, height: 5, borderRadius: 3, backgroundColor: ink, marginBottom: 8 }} />
          </View>
        ) : null}
      </View>
    </SafeAreaInsetsContext.Provider>
  );
}
