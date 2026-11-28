import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { Conversation, Message } from './conversations';

/**
 * Conversations avec ORION, enregistrées sur le téléphone (AsyncStorage).
 * Partagées entre l'historique et l'écran de discussion.
 */
const KEY = 'orion.conversations.v1';
let state: Conversation[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const set = (next: Conversation[]) => {
  state = next;
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {}), 400);
};
AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw && !state.length) {
      state = JSON.parse(raw);
      emit();
    }
  })
  .catch(() => {});
const now = () => new Date().toISOString();

export function useConversations() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const store = {
  get: (id: string) => state.find((c) => c.id === id),
  togglePin: (id: string) => set(state.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))),
  rename: (id: string, title: string) => set(state.map((c) => (c.id === id ? { ...c, title } : c))),
  remove: (id: string) => set(state.filter((c) => c.id !== id)),
  clear: () => set([]),
  /** Crée une conversation à partir du premier message et renvoie son identifiant. */
  create: (first: Message): string => {
    const id = `c${Date.now()}`;
    const title = (first.text ?? 'Nouvelle conversation').replace(/^(\w)/, (m) => m.toUpperCase()).slice(0, 42);
    set([{ id, title, preview: first.text ?? '', updatedAt: now(), messages: [first] }, ...state]);
    return id;
  },
  append: (id: string, m: Message) =>
    set(state.map((c) => (c.id === id ? { ...c, messages: [...c.messages, m], preview: m.text ?? c.preview, updatedAt: now() } : c))),
  updateCard: (id: string, messageId: string, patch: Record<string, unknown>) =>
    set(
      state.map((c) =>
        c.id !== id
          ? c
          : { ...c, messages: c.messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, ...patch } as Message['card'] } : m)) },
      ),
    ),
};
