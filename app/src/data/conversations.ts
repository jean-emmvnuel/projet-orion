/**
 * Modèle des conversations. Chaque message ORION peut porter une carte d'action,
 * comme les cartes riches de Siri (brouillon de mail, etc.), adaptées au pilotage des PC.
 */
export type Card =
  | { kind: 'capture'; device: string; size: string; time: string; url?: string }
  | {
      kind: 'confirm';
      device: string;
      action: string;
      detail: string;
      icon: string;
      danger?: boolean;
      status?: 'pending' | 'done' | 'cancelled';
      /** Commande réelle à lancer quand l'utilisateur confirme. */
      run?: { deviceId: string; action: string; params: Record<string, unknown> };
    }
  | { kind: 'file'; device: string; name: string; size: string; ext: string; url?: string }
  | { kind: 'status'; device: string; cpu: number; ram: number; disk: number; battery: number | null }
  | { kind: 'list'; device: string; deviceId: string; title: string; path?: string; mode?: 'get' | 'open'; items: { name: string; path: string; kind: 'file' | 'folder'; size: string }[] }
  | { kind: 'help'; device: string; items: { label: string; example: string; enabled: boolean | null; group?: string }[] }
  | { kind: 'live'; device: string; deviceId: string; note?: string };

export interface Message {
  id: string;
  from: 'user' | 'orion';
  text?: string;
  card?: Card;
  voice?: boolean; // dicté à la voix
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  /** Dernière activité (ISO) : sert au tri et aux groupes « Aujourd'hui », « Hier »… */
  updatedAt: string;
  pinned?: boolean;
  messages: Message[];
}

/** Plus de conversations de démonstration : l'historique se remplit avec les vraies demandes. */
export const conversations: Conversation[] = [];

export const conversationById = (id: string) => conversations.find((c) => c.id === id);
