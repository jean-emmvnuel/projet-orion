import { useSyncExternalStore } from 'react';
import { io, Socket } from 'socket.io-client';

import { api, getCoreUrl, getToken } from './client';
import { Action, Command, Device, FINAL_STATUSES, Telemetry } from './types';

/**
 * État en direct partagé par tous les écrans : PC du compte (présence, télémétrie)
 * et commandes récentes. Alimenté par l'API REST puis par le canal temps réel /app.
 */
interface LiveState {
  devices: Device[];
  loaded: boolean;
  connected: boolean;
  commands: Record<string, Command>;
}

let state: LiveState = { devices: [], loaded: false, connected: false, commands: {} };
const listeners = new Set<() => void>();
const set = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useLive<T>(select: (s: LiveState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

export const useDevices = () => useLive((s) => s.devices);
export const useDevice = (id?: string) => useLive((s) => s.devices.find((d) => d.id === id));
/** PC ciblé par défaut : le premier en ligne, sinon le premier. */
export const useTargetDevice = () => useLive((s) => s.devices.find((d) => d.online) ?? s.devices[0]);

const patchDevice = (id: string, patch: Partial<Device>) =>
  set({ devices: state.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

export async function refreshDevices() {
  const devices = await api<Device[]>('/devices');
  set({ devices, loaded: true });
  return devices;
}

/* ───────────── Temps réel ───────────── */

let socket: Socket | null = null;
const waiters = new Map<string, (c: Command) => void>();

function onCommand(c: Command) {
  set({ commands: { ...state.commands, [c.id]: c } });
  if (FINAL_STATUSES.includes(c.status)) {
    waiters.get(c.id)?.(c);
    waiters.delete(c.id);
  }
}

export function connectLive() {
  disconnectLive();
  const token = getToken();
  if (!token) return;
  socket = io(`${getCoreUrl()}/app`, { auth: { token }, transports: ['websocket'], reconnectionDelayMax: 10_000 });
  socket.on('connect', () => {
    set({ connected: true });
    refreshDevices().catch(() => {});
  });
  socket.on('disconnect', () => set({ connected: false }));
  socket.on('device:presence', (p: { id: string; online: boolean; lastSeenAt: string }) => patchDevice(p.id, { online: p.online, lastSeenAt: p.lastSeenAt }));
  socket.on('device:telemetry', (t: { id: string; at: string; data: Telemetry }) => patchDevice(t.id, { telemetry: { at: t.at, data: t.data }, online: true }));
  socket.on('device:paired', () => refreshDevices().catch(() => {}));
  socket.on('device:updated', (p: { id: string; name: string }) => patchDevice(p.id, { name: p.name }));
  socket.on('command:update', onCommand);
  // Bureau à distance : images de l'écran et réponses de l'agent.
  socket.on('remote:frame', (f: { id: string; seq: number; data: ArrayBuffer }) => remoteListeners.get(f.id)?.forEach((l) => l.frame?.(f.seq, f.data)));
  socket.on('remote:ready', (r: { id: string; width: number; height: number }) => remoteListeners.get(r.id)?.forEach((l) => l.ready?.(r)));
  socket.on('remote:error', (r: { id: string; message: string }) => remoteListeners.get(r.id)?.forEach((l) => l.error?.(r.message)));
}

/* ───────────── Bureau à distance (écran en direct, gestes) ───────────── */

export type RemoteQuality = 'fluide' | 'equilibre' | 'net';
export type RemoteInput =
  | { t: 'move'; dx: number; dy: number }
  | { t: 'tap'; x: number; y: number; button?: 'left' | 'right'; double?: boolean }
  | { t: 'click'; button?: 'left' | 'right' | 'middle' }
  | { t: 'down' | 'up'; button?: 'left' | 'right' }
  | { t: 'scroll'; dx: number; dy: number }
  | { t: 'key'; combo: string }
  | { t: 'text'; text: string };

interface RemoteListener {
  frame?: (seq: number, data: ArrayBuffer) => void;
  ready?: (info: { width: number; height: number }) => void;
  error?: (message: string) => void;
}
const remoteListeners = new Map<string, Set<RemoteListener>>();

export function onRemote(deviceId: string, l: RemoteListener) {
  const set = remoteListeners.get(deviceId) ?? new Set<RemoteListener>();
  set.add(l);
  remoteListeners.set(deviceId, set);
  return () => {
    set.delete(l);
  };
}

/** Attend que le canal temps réel soit connecté (ouverture de l'app, reconnexion), au plus `ms`. */
async function waitConnected(ms = 8000) {
  const t0 = Date.now();
  while (!socket?.connected && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150));
  return !!socket?.connected;
}

/** Envoie un message temps réel au PC ; résout avec la réponse du Core ({ ok, error }). */
async function remoteEmit(event: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!(await waitConnected())) return { ok: false, error: 'Connexion au serveur ORION perdue.' };
  return new Promise((resolve) => {
    if (!socket) return resolve({ ok: false, error: 'Connexion au serveur ORION perdue.' });
    socket.timeout(8000).emit(event, payload, (err: Error | null, res?: { ok: boolean; error?: string }) =>
      resolve(err ? { ok: false, error: 'Le serveur ORION ne répond pas.' } : (res ?? { ok: true })),
    );
  });
}

export const remoteStart = (deviceId: string, quality: RemoteQuality) => remoteEmit('remote:start', { deviceId, quality });
export const remoteStop = (deviceId: string) => remoteEmit('remote:stop', { deviceId });
/** Accusé de réception d'une image : le PC n'envoie la suivante que si le téléphone suit. */
export const remoteAck = (deviceId: string, seq: number) => socket?.emit('remote:ack', { deviceId, seq });
/** Geste ou frappe : envoyé sans attendre de réponse (des dizaines par seconde). */
export const remoteInput = (deviceId: string, ev: RemoteInput) => socket?.emit('remote:input', { deviceId, ...ev });

export function disconnectLive() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  set({ connected: false });
}

export function resetLive() {
  disconnectLive();
  state = { devices: [], loaded: false, connected: false, commands: {} };
  listeners.forEach((l) => l());
}

/* ───────────── Commandes ───────────── */

/**
 * Envoie une action à un PC et attend son résultat (temps réel, avec repli sur l'attente HTTP).
 * Rejette avec un message lisible si l'action échoue.
 */
export async function runCommand(deviceId: string, action: Action, params: Record<string, unknown> = {}): Promise<Command> {
  const cmd = await api<Command>(`/devices/${deviceId}/commands?wait=1`, { body: { action, params }, timeoutMs: 200_000 });
  onCommand(cmd);
  if (cmd.status === 'done') {
    // Un « état du PC » rafraîchit aussitôt les jauges, sans attendre la télémétrie suivante.
    if (action === 'status' && cmd.result) patchDevice(deviceId, { telemetry: { at: new Date().toISOString(), data: cmd.result as Telemetry } });
    return cmd;
  }
  throw new Error(cmd.error || (cmd.status === 'timeout' ? 'Le PC n’a pas répondu à temps.' : 'L’action a échoué.'));
}

export const listCommands = (limit = 50) => api<Command[]>(`/commands?limit=${limit}`);

export const createPairingCode = () => api<{ code: string; expiresAt: string }>('/devices/pairing-codes', { body: {} });

export async function renameDevice(id: string, name: string) {
  const d = await api<Device>(`/devices/${id}`, { method: 'PATCH', body: { name } });
  patchDevice(id, { name: d.name });
}

export async function forgetDevice(id: string) {
  await api(`/devices/${id}`, { method: 'DELETE' });
  set({ devices: state.devices.filter((d) => d.id !== id) });
}
