import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { font, useTheme } from '@/theme';
import { SplashOverlay } from '@/components/SplashOverlay';
import { DevicePreview } from '@/dev/DevicePreview';
import { AppearanceProvider } from '@/theme/appearance';
import { SessionProvider, useSession } from '@/api/session';

// Le splash natif reste affiché jusqu'à ce que l'animation d'ouverture prenne le relais.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Clavier suivi image par image, identique sur iOS et Android (edge-to-edge). */}
      <KeyboardProvider>
        <AppearanceProvider>
          <SessionProvider>
            <Root loaded={loaded} />
          </SessionProvider>
        </AppearanceProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function Root({ loaded }: { loaded: boolean }) {
  const { c, isDark } = useTheme();
  const { status } = useSession();
  const signedIn = status === 'signedIn';
  const [intro, setIntro] = useState(true);
  const hideNative = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  const endIntro = useCallback(() => setIntro(false), []);
  // L'animation d'ouverture couvre aussi la vérification de la session.
  if (!loaded || status === 'loading') return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <DevicePreview dark={isDark}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.accentText,
          headerTitleStyle: { fontFamily: font.semibold, color: c.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="conversation/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="voix" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="appareils" options={{ title: '' }} />
          <Stack.Screen name="activite" options={{ title: '' }} />
          <Stack.Screen name="device/[id]" options={{ title: '' }} />
          <Stack.Screen name="device/files" options={{ title: 'Fichiers' }} />
          <Stack.Screen name="device/apps" options={{ title: 'Applications' }} />
          <Stack.Screen name="device/remote" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="personnaliser" options={{ title: 'Personnaliser ORION', presentation: 'modal' }} />
          <Stack.Screen name="associer" options={{ title: 'Associer un PC', presentation: 'modal' }} />
          <Stack.Screen name="apercu" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="connexion" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {intro ? <SplashOverlay onReady={hideNative} onDone={endIntro} /> : null}
    </DevicePreview>
  );
}
