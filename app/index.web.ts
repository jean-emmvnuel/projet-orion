// Point d'entrée web : charge CanvasKit (moteur Skia en WebAssembly) avant de rendre l'app.
// Les écrans sont chargés au rendu par Expo Router, donc après CanvasKit.
import '@expo/metro-runtime';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';

LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
  renderRootComponent(App);
});
