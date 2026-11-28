import type { Action, Command, Device } from './types';
import type { IconName } from '@/components/ui';

/** Libellés et icônes des actions, pour l'historique et les cartes. */
export const ACTION_META: Record<Action, { label: string; icon: IconName }> = {
  capabilities: { label: 'Capacités du PC', icon: 'help-circle' },
  status: { label: 'État du PC', icon: 'pulse' },
  screenshot: { label: 'Capture d’écran', icon: 'scan' },
  lock: { label: 'Verrouillage', icon: 'lock-closed' },
  unlock: { label: 'Déverrouillage', icon: 'lock-open' },
  standby: { label: 'Veille légère / réveil', icon: 'cloudy-night' },
  sleep: { label: 'Mise en veille', icon: 'moon' },
  notify: { label: 'Notification', icon: 'notifications' },
  'files.list': { label: 'Exploration de dossier', icon: 'folder-open' },
  'files.search': { label: 'Recherche de fichiers', icon: 'search' },
  'files.get': { label: 'Récupération de fichier', icon: 'download' },
  'files.zip': { label: 'Archive de dossier', icon: 'archive' },
  'files.open': { label: 'Ouverture sur le PC', icon: 'desktop' },
  'files.receive': { label: 'Envoi vers le PC', icon: 'cloud-upload' },
  'clipboard.get': { label: 'Presse-papiers récupéré', icon: 'clipboard' },
  'clipboard.set': { label: 'Texte copié sur le PC', icon: 'copy' },
  'open.url': { label: 'Lien ouvert sur le PC', icon: 'globe' },
  volume: { label: 'Volume', icon: 'volume-high' },
  media: { label: 'Lecture multimédia', icon: 'play-circle' },
  power: { label: 'Alimentation', icon: 'power' },
  'apps.list': { label: 'Liste des applications', icon: 'apps' },
  'apps.open': { label: 'Application ouverte', icon: 'open' },
  web: { label: 'Navigation web', icon: 'globe' },
  keys: { label: 'Raccourci clavier', icon: 'keypad' },
  type: { label: 'Texte tapé sur le PC', icon: 'text' },
  remote: { label: 'Écran en direct', icon: 'tv' },
};

export function commandDetail(c: Command): string {
  if (c.status === 'failed' || c.status === 'timeout') return c.error ?? 'Échec';
  if (c.status !== 'done') return 'En cours…';
  const r = c.result ?? {};
  switch (c.action) {
    case 'screenshot':
      return r.width ? `${r.width} × ${r.height} · ${formatSize(r.size)}` : formatSize(r.size);
    case 'files.get':
    case 'files.zip':
      return `${r.name} · ${formatSize(r.size)}`;
    case 'files.list':
      return `${r.path} · ${r.items?.length ?? 0} éléments`;
    case 'files.search':
      return `« ${r.query} » · ${r.items?.length ?? 0} résultat(s)`;
    case 'capabilities':
      return `${(r.actions ?? []).filter((a: { enabled: boolean }) => a.enabled).length} actions disponibles`;
    case 'status':
      return `Processeur ${r.cpu} % · mémoire ${r.ram} %`;
    default:
      return 'Terminé';
  }
}

export function formatSize(bytes?: number | null) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
}

export function timeOf(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dayOf(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === y.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function lastSeen(d: Device) {
  if (d.online) return 'En ligne';
  if (!d.lastSeenAt) return 'Jamais connecté';
  const mins = Math.round((Date.now() - new Date(d.lastSeenAt).getTime()) / 60_000);
  if (mins < 1) return 'Vu à l’instant';
  if (mins < 60) return `Vu il y a ${mins} min`;
  return `Vu ${dayOf(d.lastSeenAt).toLowerCase()} à ${timeOf(d.lastSeenAt)}`;
}

export function uptime(s?: number) {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d} j ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
}
