import type { Card, Message } from '@/data/conversations';

import { formatSize, timeOf } from './format';
import { CAPABILITIES, commandProblem, HELP, parseIntent } from './intents';
import { runCommand } from './live';
import { confirmOwner } from './secure';
import type { Action, Command, Device, FileItem } from './types';

/**
 * Réponse d'ORION à une demande écrite (ou dictée) : comprend l'intention, exécute l'action
 * sur le PC ciblé via le Core, et renvoie un message avec sa carte de résultat.
 */
const msg = (text: string, card?: Card): Message => ({ id: `o${Date.now()}${Math.random().toString(36).slice(2, 6)}`, from: 'orion', text, card });

export async function respond(text: string, device: Device | undefined): Promise<Message> {
  const intent = parseIntent(text);
  if (!intent) return msg(commandProblem(text) ?? `Je n’ai pas compris. ${HELP}`);
  if (intent.action === 'capabilities') return capabilities(device);
  if (!device) return msg('Aucun PC n’est encore associé. Va dans Appareils > Associer un PC, puis redemande-moi.');
  if (!device.online) return msg(`${device.name} est hors ligne pour l’instant. Je pourrai agir dès qu’il se reconnectera.`);

  if (intent.confirm) {
    return msg(`${intent.confirm.title} ${device.name} ? Confirme pour continuer.`, {
      kind: 'confirm',
      device: device.name,
      action: intent.confirm.title,
      detail: intent.confirm.detail,
      icon: intent.confirm.icon,
      danger: intent.confirm.danger,
      status: 'pending',
      run: { deviceId: device.id, action: intent.action, params: intent.params },
    });
  }

  if (intent.action === 'remote') return msg(`Voici l’écran de ${device.name}, en direct.`, { kind: 'live', device: device.name, deviceId: device.id });

  try {
    if (intent.action === 'files.zip') return await zipByName(device, String(intent.params.query ?? ''));
    if (intent.action === 'apps.open' && intent.params.query) return await openAppByName(device, String(intent.params.query), !!intent.params.orFile);
    const { thenGet, thenOpen, ...params } = intent.params as { thenGet?: boolean; thenOpen?: boolean };
    const cmd = await runCommand(device.id, intent.action, params);
    if (intent.action === 'files.search' && thenGet) return await sendBestMatch(cmd, device);
    if (intent.action === 'files.search' && thenOpen) return await openBestMatch(cmd, device);
    return describe(cmd, device);
  } catch (e) {
    return msg(`Ça n’a pas marché sur ${device.name} : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
  }
}

/** Exécute une action confirmée depuis une carte. */
export async function runConfirmed(run: { deviceId: string; action: string; params: Record<string, unknown> }, device: Device | undefined): Promise<Message> {
  const wake = run.action === 'standby' && run.params.op === 'exit' && !!run.params.unlock;
  if (run.action === 'unlock' || wake) {
    const err = await confirmOwner(`${wake ? 'Réveiller' : 'Déverrouiller'} ${device?.name ?? 'le PC'}`);
    if (err) return msg(err);
  }
  if (wake) {
    // Réveil = rallumer l'écran (fin de la veille légère) puis ouvrir la session.
    try {
      await runCommand(run.deviceId, 'standby', { op: 'exit' });
      const u = await runCommand(run.deviceId, 'unlock');
      return msg(u.result?.already ? `${device?.name ?? 'Le PC'} est réveillé.` : `${device?.name ?? 'Le PC'} est réveillé et déverrouillé.`);
    } catch (e) {
      return msg(`Réveil impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
    }
  }
  try {
    const cmd = await runCommand(run.deviceId, run.action as Action, run.params);
    return device ? describe(cmd, device) : msg('C’est fait.');
  } catch (e) {
    return msg(`Ça n’a pas marché : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
  }
}

/** Ce qu'ORION sait faire ; avec le PC en ligne, indique aussi ce qui est désactivé dans son agent. */
async function capabilities(device: Device | undefined): Promise<Message> {
  let enabled: Record<string, boolean> | null = null;
  if (device?.online) {
    try {
      const cmd = await runCommand(device.id, 'capabilities');
      enabled = Object.fromEntries((cmd.result?.actions ?? []).map((a: { action: string; enabled: boolean }) => [a.action, a.enabled]));
    } catch {
      enabled = null;
    }
  }
  const items = CAPABILITIES.map((c) => ({ group: c.group, label: c.label, example: c.example, enabled: enabled ? (enabled[c.action] ?? (c.action === 'remote' ? true : false)) : null }));
  const off = items.filter((i) => i.enabled === false).length;
  const lead = !device
    ? 'Voici ce que je saurai faire dès qu’un PC sera associé :'
    : !device.online
      ? `${device.name} est hors ligne ; voici ce que je sais faire dès son retour :`
      : off
        ? `Voici ce que je peux faire sur ${device.name}. ${off} action(s) sont désactivées dans les réglages de son agent.`
        : `Voici mes commandes pour ${device.name}. Touche-en une pour l’essayer.`;
  return msg(lead, { kind: 'help', device: device?.name ?? 'ORION', items });
}

/** « Zippe le dossier Documents » : retrouve le dossier par son nom dans le dossier personnel. */
async function zipByName(device: Device, name: string): Promise<Message> {
  const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_.\-\s]+/g, ' ').trim();
  const list = await runCommand(device.id, 'files.list', { path: '~' });
  const folders: FileItem[] = (list.result?.items ?? []).filter((i: FileItem) => i.kind === 'folder');
  const match = folders.find((f) => norm(f.name) === norm(name)) ?? folders.find((f) => norm(f.name).includes(norm(name)));
  if (!match) return msg(`Je ne trouve pas de dossier « ${name} » à la racine de ton dossier personnel. Ouvre-le depuis la liste et touche « .zip ».`);
  return fetchFile(device.id, { path: match.path, kind: 'folder' }, device, true);
}

/**
 * « /ouvre chrome » : retrouve l'application par son nom (accents et casse ignorés) puis l'ouvre.
 * Avec `orFile`, si aucune appli ne correspond, cherche un fichier de ce nom et le lance (vidéo, musique, document…).
 */
async function openAppByName(device: Device, query: string, orFile = false): Promise<Message> {
  const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const q = norm(query);
  const list = await runCommand(device.id, 'apps.list');
  const apps: { id: string; name: string }[] = list.result?.items ?? [];
  const match =
    apps.find((a) => norm(a.name) === q) ??
    apps.find((a) => norm(a.name).startsWith(q)) ??
    apps.find((a) => norm(a.name).split(/\s+/).some((w) => w.startsWith(q))) ??
    apps.find((a) => norm(a.name).includes(q) || norm(a.id).includes(q));
  if (!match && orFile) {
    const search = await runCommand(device.id, 'files.search', { query });
    if ((search.result?.items ?? []).some((i: FileItem) => i.kind === 'file')) return openBestMatch(search, device);
  }
  if (!match) {
    const near = apps.filter((a) => norm(a.name).includes(q.slice(0, 3))).slice(0, 6).map((a) => a.name);
    return msg(`Je ne trouve pas d’application « ${query} » sur ${device.name}.${near.length ? ` Peut-être : ${near.join(', ')} ?` : ' Tape /applis pour voir la liste.'}`);
  }
  await runCommand(device.id, 'apps.open', { id: match.id });
  return msg(`J’ouvre ${match.name} sur ${device.name}.`, { kind: 'live', device: device.name, deviceId: device.id, note: `${match.name} s’ouvre sur le PC. Ouvre l’écran en direct pour t’en servir depuis le téléphone.` });
}

/** Parcourt un dossier (carte « liste »). */
export async function browse(deviceId: string, path: string, device: Device | undefined): Promise<Message> {
  try {
    const cmd = await runCommand(deviceId, 'files.list', { path });
    return device ? describe(cmd, device) : msg('Voici le dossier.');
  } catch (e) {
    return msg(`Impossible d’ouvrir ce dossier : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
  }
}

/** Récupère un fichier ; un dossier n'est téléchargé qu'en .zip, et seulement si `zip` est demandé. */
export async function fetchFile(deviceId: string, item: { path: string; kind: 'file' | 'folder' }, device: Device | undefined, zip = false): Promise<Message> {
  if (item.kind === 'folder' && !zip) return browse(deviceId, item.path, device);
  try {
    const cmd = await runCommand(deviceId, item.kind === 'folder' ? 'files.zip' : 'files.get', { path: item.path });
    return device ? describe(cmd, device) : msg('Fichier prêt.');
  } catch (e) {
    return msg(`Récupération impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
  }
}

/** « /ouvre vacances.mp4 » : un seul résultat → ouvert sur le PC ; sinon la liste, à lancer d'un toucher. */
async function openBestMatch(search: Command, device: Device): Promise<Message> {
  const items: FileItem[] = (search.result?.items ?? []).filter((i: FileItem) => i.kind === 'file');
  if (!items.length) return msg(`Rien trouvé pour « ${search.result?.query} » sur ${device.name}.`);
  if (items.length === 1) return launchOnPc(device.id, items[0].path, device);
  const m = describe(search, device, `${items.length} fichiers correspondent. Touche celui à lancer sur ${device.name} :`);
  if (m.card?.kind === 'list') m.card.mode = 'open';
  return m;
}

/** Ouvre un fichier sur le PC avec son application (vidéo, musique, document…). */
export async function launchOnPc(deviceId: string, path: string, device: Device | undefined): Promise<Message> {
  try {
    const cmd = await runCommand(deviceId, 'files.open', { path });
    return msg(`J’ai lancé « ${cmd.result?.name} » sur ${device?.name ?? 'le PC'}. Utilise /media pause, /media suivant ou /volume pour la suite.`);
  } catch (e) {
    return msg(`Impossible de lancer ce fichier : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
  }
}

async function sendBestMatch(search: Command, device: Device): Promise<Message> {
  const items: FileItem[] = (search.result?.items ?? []).filter((i: FileItem) => i.kind === 'file');
  if (!items.length) return msg(`Je n’ai trouvé aucun fichier « ${search.result?.query} » sur ${device.name}.`);
  if (items.length > 1) return describe(search, device, `J’ai trouvé ${items.length} fichiers. Lequel veux-tu ?`);
  return fetchFile(device.id, items[0], device);
}

function describe(cmd: Command, device: Device, lead?: string): Message {
  const r = cmd.result ?? {};
  switch (cmd.action) {
    case 'screenshot':
      return msg(`Voici l’écran de ${device.name}, à ${timeOf(cmd.createdAt).replace(':', ' h ')}.`, {
        kind: 'capture',
        device: device.name,
        size: `${r.width ?? '?'} × ${r.height ?? '?'} · ${formatSize(r.size)}`,
        time: timeOf(cmd.createdAt),
        url: r.url,
      });
    case 'status': {
      const bat = r.battery ? ` La batterie est à ${r.battery.percent} %${r.battery.charging ? ', en charge' : ''}.` : '';
      return msg(`${device.name} va bien : processeur à ${r.cpu} %, mémoire à ${r.ram} %.${bat}`, {
        kind: 'status',
        device: device.name,
        cpu: r.cpu,
        ram: r.ram,
        disk: r.disk,
        battery: r.battery?.percent ?? null,
      });
    }
    case 'lock':
      return msg(`Session verrouillée sur ${device.name}.`);
    case 'unlock':
      return msg(r.already ? `La session de ${device.name} était déjà ouverte.` : `${device.name} est déverrouillé.`);
    case 'clipboard.get':
      return msg(r.text ? `Presse-papiers de ${device.name} :\n\n${r.text}` : `Le presse-papiers de ${device.name} est vide.`);
    case 'clipboard.set':
      return msg(`Copié dans le presse-papiers de ${device.name} : colle-le où tu veux.`);
    case 'open.url':
      return msg(`J’ai ouvert ${r.url} sur ${device.name}.`);
    case 'volume':
      return msg(r.muted ? `Son coupé sur ${device.name}.` : r.level != null ? `Volume de ${device.name} : ${r.level} %.` : 'Volume réglé.');
    case 'media':
      if (!r.player) return msg(`Rien ne joue sur ${device.name}. Lance un média avec /ouvre <nom>.`);
      return msg(r.title ? `${r.playing ? 'En lecture' : 'En pause'} sur ${r.player} : « ${r.title} »${r.artist ? ` — ${r.artist}` : ''}.` : `${r.player} est ${r.playing ? 'en lecture' : 'en pause'}.`);
    case 'files.open':
      return msg(`J’ai lancé « ${r.name} » sur ${device.name}.`);
    case 'files.receive':
      return msg(`Fichier rangé sur ${device.name} : ${r.path}.`);
    case 'power':
      return msg(r.op === 'restart' ? `${device.name} redémarre. Je le retrouverai à son retour.` : `${device.name} s’éteint.`);
    case 'sleep':
      return msg(`${device.name} se met en veille profonde : il ne répondra plus jusqu’à ce que tu le réveilles sur place.`);
    case 'standby':
      return msg(r.standby ? `${device.name} est en veille légère : écran éteint, session verrouillée, mais toujours joignable. Dis /reveil pour le réveiller.` : `${device.name} est réveillé.`);
    case 'notify':
      return msg(`J’ai affiché le message sur ${device.name}.`);
    case 'apps.list': {
      const items: { name: string }[] = r.items ?? [];
      return msg(`${items.length} applications sur ${device.name}. Ouvre-en une avec /ouvre <nom>, ou depuis la fiche du PC > Applications.\n\n${items.map((a) => a.name).join(' · ')}`);
    }
    case 'apps.open':
      return msg(`J’ouvre ${r.name} sur ${device.name}.`, { kind: 'live', device: device.name, deviceId: device.id, note: `${r.name} s’ouvre sur le PC.` });
    case 'web':
      if (r.op === 'search') return msg(`Recherche Google ouverte sur ${device.name} : « ${r.q} ».`, { kind: 'live', device: device.name, deviceId: device.id, note: 'Ouvre l’écran en direct pour parcourir les résultats.' });
      if (r.op === 'url') return msg(`J’ai ouvert ${r.url} sur ${device.name}.`);
      return msg('C’est fait dans le navigateur du PC.');
    case 'keys':
      return msg(`Raccourci ${r.combo} envoyé à ${device.name}.`);
    case 'type':
      return msg(`Texte tapé sur ${device.name} (${r.length} caractères).`);
    case 'files.get':
    case 'files.zip':
      return msg(cmd.action === 'files.zip' ? 'Voici l’archive du dossier.' : 'Voici ton fichier.', {
        kind: 'file',
        device: device.name,
        name: r.name,
        size: formatSize(r.size),
        ext: String(r.name ?? '').split('.').pop() ?? '',
        url: r.url,
      });
    case 'files.search':
    case 'files.list': {
      const items: FileItem[] = r.items ?? [];
      const title = cmd.action === 'files.search' ? `« ${r.query} »` : r.path;
      if (!items.length) return msg(cmd.action === 'files.search' ? `Rien trouvé pour « ${r.query} » sur ${device.name}.` : 'Ce dossier est vide.');
      const more = r.truncated ? ' (les premiers seulement : précise ta recherche pour en voir d’autres)' : '';
      return msg(lead ?? (cmd.action === 'files.search' ? `${items.length} résultat(s) sur ${device.name}${more}. Touche un fichier pour le récupérer.` : `Contenu de ${r.path} — touche un dossier pour l’ouvrir, un fichier pour le récupérer :`), {
        kind: 'list',
        device: device.name,
        deviceId: device.id,
        title,
        path: cmd.action === 'files.list' ? r.path : undefined,
        items: items.map((i) => ({ name: i.name, path: i.path, kind: i.kind, size: i.kind === 'file' ? formatSize(i.size) : '' })),
      });
    }
    default:
      return msg('C’est fait.');
  }
}
