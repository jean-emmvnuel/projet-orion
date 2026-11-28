import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Accès HTTP au Core relais : adresse, jeton de session et requêtes.
 *
 * Adresse par défaut :
 *  1. EXPO_PUBLIC_CORE_URL si défini (production : https://…) ;
 *  2. en développement, la machine qui sert l'app (même IP que Metro) sur le port 3001 ;
 *  3. sinon http://localhost:3001.
 * L'utilisateur peut la changer sur l'écran de connexion.
 */
const URL_KEY = 'orion.core.url';
const TOKEN_KEY = 'orion.session.token';

export function defaultCoreUrl() {
  const env = process.env.EXPO_PUBLIC_CORE_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:3001`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3001` : 'http://localhost:3001';
}

let coreUrl = defaultCoreUrl();
let token: string | null = null;

export const getCoreUrl = () => coreUrl;
export const getToken = () => token;

export async function loadCoreUrl() {
  const saved = await AsyncStorage.getItem(URL_KEY).catch(() => null);
  if (saved) coreUrl = saved;
  return coreUrl;
}

export async function saveCoreUrl(url: string) {
  coreUrl = url.trim().replace(/\/$/, '');
  await AsyncStorage.setItem(URL_KEY, coreUrl).catch(() => {});
}

/** Le jeton est rangé dans le trousseau (iOS) / Keystore (Android) ; sur le web, dans le stockage local. */
export async function loadToken() {
  token = Platform.OS === 'web' ? await AsyncStorage.getItem(TOKEN_KEY).catch(() => null) : await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  return token;
}

export async function saveToken(value: string | null) {
  token = value;
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(TOKEN_KEY, value);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } else if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Lien absolu vers un chemin du Core (ex. lien signé d'un fichier). */
export const coreLink = (path: string) => (path.startsWith('http') ? path : `${coreUrl}${path}`);

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${coreUrl}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(`Impossible de joindre ORION Core (${coreUrl}). Vérifie que le serveur tourne et que le téléphone est sur le même réseau.`, 0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new ApiError(msg || `Erreur ${res.status}`, res.status);
  }
  return data as T;
}
