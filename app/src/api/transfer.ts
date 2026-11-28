import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { getCoreUrl, getToken } from './client';
import { runCommand } from './live';

/**
 * Téléphone → PC : le fichier est déposé sur le Core pour ce PC précis, puis l'agent le récupère
 * et le range dans Téléchargements/ORION (option : l'ouvrir aussitôt sur le PC).
 */
export interface Picked {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export async function pickPhotos(): Promise<Picked[]> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 10, quality: 1 });
  if (res.canceled) return [];
  return res.assets.map((a, i) => ({
    uri: a.uri,
    name: a.fileName ?? `photo-${Date.now()}-${i}.${a.type === 'video' ? 'mp4' : 'jpg'}`,
    mimeType: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    size: a.fileSize,
  }));
}

export async function pickDocuments(): Promise<Picked[]> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return [];
  return res.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined, size: a.size ?? undefined }));
}

async function upload(deviceId: string, file: Picked): Promise<{ id: string; name: string; size: number }> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append('file', blob, file.name);
  } else {
    // React Native : le fichier est décrit par son URI locale.
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  }
  const res = await fetch(`${getCoreUrl()}/devices/${deviceId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `Envoi refusé (${res.status})`);
  return data;
}

/** Envoie un fichier au PC ; renvoie l'emplacement où l'agent l'a rangé. */
export async function sendToPc(deviceId: string, file: Picked, open = false): Promise<{ path: string; name: string }> {
  const blob = await upload(deviceId, file);
  const cmd = await runCommand(deviceId, 'files.receive', { fileId: blob.id, name: file.name, open });
  return { path: cmd.result?.path, name: cmd.result?.name };
}
