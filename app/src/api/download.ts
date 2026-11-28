import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { coreLink } from './client';

/**
 * Téléchargements sans quitter l'app : le fichier est rapatrié dans le cache du téléphone,
 * puis enregistré dans Photos (images) ou proposé via la feuille de partage (« Enregistrer dans Fichiers »).
 */
const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif)$/i;
export const isImage = (name: string) => IMAGE.test(name);
export const isText = (name: string) => /\.(txt|md|markdown|json|csv|log|py|ts|tsx|js|jsx|sh|yml|yaml|toml|ini|env|xml|html|css)$/i.test(name);
export const isPdf = (name: string) => /\.pdf$/i.test(name);
export const isVideo = (name: string) => /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(name);
export const isAudio = (name: string) => /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(name);
/** Fichier qu'on peut regarder ou écouter directement dans l'app. */
export const isViewable = (name: string) => isImage(name) || isVideo(name) || isAudio(name) || isText(name) || isPdf(name);

const safeName = (name: string) => name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'orion-fichier';

/** Télécharge le fichier du Core dans le cache local et renvoie son URI. */
export async function downloadLocal(url: string, name: string): Promise<string> {
  const dest = new File(Paths.cache, `${Date.now()}-${safeName(name)}`);
  const file = await File.downloadFileAsync(coreLink(url), dest);
  return file.uri;
}

/** Web : déclenche le téléchargement du navigateur sans changer de page. */
function webDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = coreLink(url);
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Enregistre une image dans la photothèque (autorisation « ajout seulement »). */
export async function saveImageToPhotos(url: string, name: string): Promise<'saved' | 'denied'> {
  if (Platform.OS === 'web') {
    webDownload(url, name);
    return 'saved';
  }
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) return 'denied';
  const uri = await downloadLocal(url, name);
  await MediaLibrary.saveToLibraryAsync(uri);
  return 'saved';
}

/** Ouvre la feuille de partage du système (AirDrop, Fichiers, messageries…) sans quitter l'app. */
export async function shareFile(url: string, name: string, mimeType?: string) {
  if (Platform.OS === 'web') return webDownload(url, name);
  const uri = await downloadLocal(url, name);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Le partage n’est pas disponible sur cet appareil.');
  await Sharing.shareAsync(uri, { dialogTitle: name, mimeType });
}

/** « Enregistrer » : Photos pour une image, feuille de partage (→ Fichiers) sinon. */
export async function saveToPhone(url: string, name: string): Promise<'saved' | 'denied' | 'shared'> {
  if (isImage(name)) return saveImageToPhotos(url, name);
  await shareFile(url, name);
  return 'shared';
}

/** Ouvre l'aperçu intégré (jamais le navigateur). */
export function openPreview(url: string, name: string, size?: string) {
  router.push({ pathname: '/apercu', params: { url, name, size: size ?? '' } });
}
