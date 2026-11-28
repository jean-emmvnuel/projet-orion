import type { Action } from './types';

/**
 * Compréhension simple des demandes (en attendant le module LLM du Core) :
 * transforme une phrase en action pour le PC. Insensible aux accents et à la casse.
 */
export interface Intent {
  action: Action;
  params: Record<string, unknown>;
  /** Action à faire confirmer avant exécution. */
  confirm?: { title: string; detail: string; icon: string; danger?: boolean };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .trim();

/** Extrait ce qui suit un mot-clé : « cherche le contrat de bail » → « contrat de bail ». */
function after(text: string, keys: string[]) {
  const n = norm(text);
  for (const k of keys) {
    const i = n.indexOf(k);
    if (i >= 0) {
      return n
        .slice(i + k.length)
        .replace(/^\s*(le|la|les|l|un|une|des|du|de|d|mon|ma|mes|fichier|fichiers|dossier|document|documents)\s+/g, '')
        .replace(/^\s*(le|la|les|l)\s+/g, '')
        .replace(/\s+(sur|dans)\s+(mon|le)\s+(pc|ordi|ordinateur).*$/, '')
        .replace(/[?.!]+$/, '')
        .trim();
    }
  }
  return '';
}

/**
 * Commandes en un mot, façon Telegram : faciles à retenir, regroupées par thème.
 * Une commande par besoin ; l'argument précise (« /media suivant », « /veille profonde »).
 * Les anciens noms (/lecture, /appli, /google…) restent compris comme alias.
 */
export type CommandGroup = 'Général' | 'Écran' | 'Fichiers' | 'Ouvrir et naviguer' | 'Clavier et presse-papiers' | 'Son et médias' | 'Session' | 'Alimentation';

export interface SlashCommand {
  cmd: string;
  action: Action;
  group: CommandGroup;
  label: string;
  /** Argument attendu (affiché dans l'aide et le menu). */
  arg?: string;
  /** L'argument est obligatoire. */
  required?: boolean;
  example?: string;
}

export const COMMANDS: SlashCommand[] = [
  { cmd: 'aide', action: 'capabilities', group: 'Général', label: 'Tout ce que je sais faire' },
  { cmd: 'etat', action: 'status', group: 'Général', label: 'Processeur, mémoire, disque, batterie' },
  { cmd: 'message', action: 'notify', group: 'Général', label: 'Afficher un message sur le PC', arg: 'texte', required: true, example: '/message J’arrive' },

  { cmd: 'direct', action: 'remote', group: 'Écran', label: 'Écran du PC en direct, à contrôler', example: '/direct' },
  { cmd: 'capture', action: 'screenshot', group: 'Écran', label: 'Photo de l’écran du PC' },

  { cmd: 'fichiers', action: 'files.list', group: 'Fichiers', label: 'Parcourir mes dossiers', arg: 'dossier', example: '/fichiers Documents' },
  { cmd: 'cherche', action: 'files.search', group: 'Fichiers', label: 'Trouver un fichier (envoyé s’il est seul)', arg: 'nom', required: true, example: '/cherche facture' },
  { cmd: 'zip', action: 'files.zip', group: 'Fichiers', label: 'Télécharger un dossier en .zip', arg: 'dossier', required: true, example: '/zip Documents' },

  { cmd: 'ouvre', action: 'apps.open', group: 'Ouvrir et naviguer', label: 'Ouvrir une appli, un lien ou un fichier sur le PC', arg: 'appli, lien ou fichier', required: true, example: '/ouvre chrome' },
  { cmd: 'applis', action: 'apps.list', group: 'Ouvrir et naviguer', label: 'Toutes les applications du PC' },
  { cmd: 'web', action: 'web', group: 'Ouvrir et naviguer', label: 'Chercher sur Google, ou : retour, suivant, actualiser, onglet, fermer', arg: 'recherche ou action', required: true, example: '/web météo Abidjan' },

  { cmd: 'tape', action: 'type', group: 'Clavier et presse-papiers', label: 'Taper un texte ou un raccourci (ctrl+t…)', arg: 'texte ou touches', required: true, example: '/tape ctrl+t' },
  { cmd: 'presse', action: 'clipboard.get', group: 'Clavier et presse-papiers', label: 'Presse-papiers du PC : le lire, ou y copier un texte', arg: 'texte', example: '/presse mon texte' },

  { cmd: 'media', action: 'media', group: 'Son et médias', label: 'Ce qui joue ; pause, suivant, precedent', arg: 'action', example: '/media suivant' },
  { cmd: 'volume', action: 'volume', group: 'Son et médias', label: 'Volume : + , - , muet ou 0 à 100', arg: 'niveau', example: '/volume 40' },

  { cmd: 'verrou', action: 'lock', group: 'Session', label: 'Verrouiller la session' },
  { cmd: 'deverrouille', action: 'unlock', group: 'Session', label: 'Déverrouiller (Face ID / code)' },
  { cmd: 'veille', action: 'standby', group: 'Session', label: 'Veille légère (réveil possible) ; « profonde » = vraie veille', arg: 'profonde', example: '/veille' },
  { cmd: 'reveil', action: 'standby', group: 'Session', label: 'Réveiller et déverrouiller le PC' },

  { cmd: 'redemarre', action: 'power', group: 'Alimentation', label: 'Redémarrer le PC' },
  { cmd: 'eteins', action: 'power', group: 'Alimentation', label: 'Éteindre le PC' },
];

export const GROUP_ORDER: CommandGroup[] = ['Général', 'Écran', 'Fichiers', 'Ouvrir et naviguer', 'Clavier et presse-papiers', 'Son et médias', 'Session', 'Alimentation'];

const UNLOCK_CONFIRM = { title: 'Déverrouiller', detail: 'Face ID ou le code de ton téléphone te sera demandé.', icon: 'lock-open' };
const WAKE_CONFIRM = { title: 'Réveiller', detail: 'L’écran se rallume puis la session s’ouvre : Face ID ou le code de ton téléphone te sera demandé.', icon: 'sunny' };
const DEEP_SLEEP_CONFIRM = {
  title: 'Mettre en veille profonde',
  detail: 'Vraie veille : le PC ne répondra plus et ne pourra pas être réveillé depuis le téléphone. Préfère /veille (légère).',
  icon: 'moon',
  danger: true,
};

/** Actions du navigateur reconnues par /web (sinon c'est une recherche Google). */
const NAV_OPS: Record<string, string> = {
  retour: 'back', back: 'back', precedent: 'back', suivant: 'forward', avance: 'forward', forward: 'forward',
  actualise: 'reload', actualiser: 'reload', recharge: 'reload', reload: 'reload',
  onglet: 'newtab', 'nouvel onglet': 'newtab', newtab: 'newtab', ferme: 'closetab', fermer: 'closetab', close: 'closetab',
  'onglet suivant': 'nexttab', bas: 'pagedown', descends: 'pagedown', haut: 'pageup', monte: 'pageup',
  zoom: 'zoomin', dezoom: 'zoomout', 'plein ecran': 'fullscreen',
};

/** Actions reconnues par /media (vide = ce qui joue). */
const MEDIA_OPS: Record<string, string> = {
  '': 'status', pause: 'play-pause', lecture: 'play-pause', play: 'play-pause', reprends: 'play-pause',
  suivant: 'next', next: 'next', precedent: 'previous', prev: 'previous', previous: 'previous',
};

/**
 * Alias : anciens noms, synonymes, anglais. Un alias peut imposer un argument
 * (« /suivant » = « /media suivant »).
 */
const ALIASES: Record<string, { cmd: string; arg?: string }> = {
  help: { cmd: 'aide' }, start: { cmd: 'aide' }, menu: { cmd: 'aide' }, commandes: { cmd: 'aide' },
  status: { cmd: 'etat' }, statut: { cmd: 'etat' }, info: { cmd: 'etat' },
  notify: { cmd: 'message' }, dis: { cmd: 'message' }, msg: { cmd: 'message' },
  live: { cmd: 'direct' }, remote: { cmd: 'direct' }, bureau: { cmd: 'direct' }, controle: { cmd: 'direct' }, ecran: { cmd: 'direct' },
  shot: { cmd: 'capture' }, screenshot: { cmd: 'capture' }, photo: { cmd: 'capture' },
  ls: { cmd: 'fichiers' }, dossier: { cmd: 'fichiers' }, dossiers: { cmd: 'fichiers' }, files: { cmd: 'fichiers' },
  find: { cmd: 'cherche' }, recherche: { cmd: 'cherche' }, trouve: { cmd: 'cherche' },
  envoie: { cmd: 'cherche' }, get: { cmd: 'cherche' }, recupere: { cmd: 'cherche' }, telecharge: { cmd: 'cherche' },
  archive: { cmd: 'zip' },
  lance: { cmd: 'ouvre' }, appli: { cmd: 'ouvre' }, app: { cmd: 'ouvre' }, application: { cmd: 'ouvre' }, open: { cmd: 'ouvre' },
  lien: { cmd: 'ouvre' }, url: { cmd: 'ouvre' }, ouvrir: { cmd: 'ouvre' }, lancer: { cmd: 'ouvre' },
  apps: { cmd: 'applis' }, applications: { cmd: 'applis' }, programmes: { cmd: 'applis' },
  google: { cmd: 'web' }, g: { cmd: 'web' }, search: { cmd: 'web' }, internet: { cmd: 'web' }, nav: { cmd: 'web' }, navigateur: { cmd: 'web' },
  ecris: { cmd: 'tape' }, type: { cmd: 'tape' }, saisis: { cmd: 'tape' }, raccourci: { cmd: 'tape' }, touche: { cmd: 'tape' }, touches: { cmd: 'tape' }, keys: { cmd: 'tape' },
  copie: { cmd: 'presse' }, clip: { cmd: 'presse' }, clipboard: { cmd: 'presse' }, paste: { cmd: 'presse' }, copy: { cmd: 'presse' },
  lecture: { cmd: 'media', arg: 'pause' }, pause: { cmd: 'media', arg: 'pause' }, play: { cmd: 'media', arg: 'pause' }, joue: { cmd: 'media', arg: 'pause' },
  suivant: { cmd: 'media', arg: 'suivant' }, next: { cmd: 'media', arg: 'suivant' },
  precedent: { cmd: 'media', arg: 'precedent' }, prev: { cmd: 'media', arg: 'precedent' }, previous: { cmd: 'media', arg: 'precedent' },
  musique: { cmd: 'media' }, music: { cmd: 'media' }, morceau: { cmd: 'media' },
  son: { cmd: 'volume' }, vol: { cmd: 'volume' },
  lock: { cmd: 'verrou' }, verrouille: { cmd: 'verrou' }, bloque: { cmd: 'verrou' },
  unlock: { cmd: 'deverrouille' }, deverrou: { cmd: 'deverrouille' }, deverrouiller: { cmd: 'deverrouille' }, debloque: { cmd: 'deverrouille' },
  sleep: { cmd: 'veille' }, dors: { cmd: 'veille' }, veilleprofonde: { cmd: 'veille', arg: 'profonde' },
  wake: { cmd: 'reveil' }, reveille: { cmd: 'reveil' }, debout: { cmd: 'reveil' },
  reboot: { cmd: 'redemarre' }, restart: { cmd: 'redemarre' }, redemarrer: { cmd: 'redemarre' },
  shutdown: { cmd: 'eteins' }, eteindre: { cmd: 'eteins' },
};

/** Commandes proposées pendant la saisie de « /… » : par nom, puis par ancien nom / synonyme. */
export function matchCommands(typed: string): SlashCommand[] {
  const t = norm(typed).replace(/-/g, '');
  const direct = COMMANDS.filter((c) => c.cmd.startsWith(t));
  if (!t) return COMMANDS;
  const viaAlias = Object.entries(ALIASES)
    .filter(([k]) => k.startsWith(t))
    .map(([, v]) => COMMANDS.find((c) => c.cmd === v.cmd))
    .filter((c): c is SlashCommand => !!c && !direct.includes(c));
  const all = [...direct, ...new Set(viaAlias)];
  return COMMANDS.filter((c) => all.includes(c)); // ordre des groupes conservé
}

/** Liste de la carte d'aide, dans l'ordre des groupes. */
export const CAPABILITIES = COMMANDS.filter((c) => c.action !== 'capabilities').map((c) => ({
  action: c.action,
  group: c.group,
  label: c.label,
  example: c.example ?? `/${c.cmd}`,
}));

/** « /cherche contrat de bail » → { cmd: 'cherche', rest: 'contrat de bail' } (alias résolus, accents ignorés). */
export function splitCommand(text: string): { cmd: string; rest: string } | null {
  const m = /^\/(\S+)\s*(.*)$/s.exec(text.trim());
  if (!m) return null;
  const word = norm(m[1]).replace(/@.*/, '').replace(/-/g, '');
  const rest = m[2].trim();
  if (COMMANDS.some((c) => c.cmd === word)) return { cmd: word, rest };
  const alias = ALIASES[word];
  if (alias) return { cmd: alias.cmd, rest: alias.arg !== undefined && !rest ? alias.arg : rest };
  return { cmd: word, rest };
}

/** Raccourci clavier plutôt que texte ? (« ctrl+t », « alt+tab », « enter », « f5 »…) */
const looksLikeCombo = (v: string) => /^((ctrl|alt|shift|super|cmd|win|maj)\+)+\S+$|^(enter|entree|tab|escape|echap|esc|backspace|delete|suppr|f\d{1,2}|up|down|left|right)$/i.test(v.replace(/\s+/g, ''));
const looksLikeUrl = (v: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v) && !/\s/.test(v);

function fromCommand(cmd: string, rest: string): Intent | null {
  const r = norm(rest);
  switch (cmd) {
    case 'aide':
      return { action: 'capabilities', params: {} };
    case 'etat':
      return { action: 'status', params: {} };
    case 'message':
      return rest ? { action: 'notify', params: { title: 'ORION', body: rest } } : null;
    case 'direct':
      return { action: 'remote', params: {} };
    case 'capture':
      return { action: 'screenshot', params: {} };
    case 'fichiers':
      return { action: 'files.list', params: { path: rest ? (rest.startsWith('~') ? rest : `~/${rest}`) : '~' } };
    case 'cherche':
      return rest.length >= 2 ? { action: 'files.search', params: { query: rest, thenGet: true } } : null;
    case 'zip':
      return rest.length >= 2 ? { action: 'files.zip', params: { query: rest } } : null;
    case 'ouvre':
      if (rest.length < 2) return null;
      return looksLikeUrl(rest) ? { action: 'open.url', params: { url: rest } } : { action: 'apps.open', params: { query: rest, orFile: true } };
    case 'applis':
      return { action: 'apps.list', params: {} };
    case 'web': {
      if (!rest) return null;
      const op = NAV_OPS[r];
      if (op) return { action: 'web', params: { op } };
      return looksLikeUrl(rest) ? { action: 'web', params: { op: 'url', url: rest } } : { action: 'web', params: { op: 'search', q: rest } };
    }
    case 'tape':
      if (!rest) return null;
      return looksLikeCombo(rest)
        ? { action: 'keys', params: { combo: r.replace(/\s+/g, '').replace(/^maj\+/, 'shift+').replace(/entree/, 'enter').replace(/echap/, 'escape').replace(/suppr/, 'delete') } }
        : { action: 'type', params: { text: rest } };
    case 'presse':
      return rest ? { action: 'clipboard.set', params: { text: rest } } : { action: 'clipboard.get', params: {} };
    case 'media': {
      const op = MEDIA_OPS[r];
      return op ? { action: 'media', params: { op } } : null;
    }
    case 'volume': {
      if (!r) return { action: 'volume', params: { op: 'status' } };
      if (/^\+|plus|monte/.test(r)) return { action: 'volume', params: { op: 'up' } };
      if (/^-|moins|baisse/.test(r)) return { action: 'volume', params: { op: 'down' } };
      if (/muet|mute|coupe/.test(r)) return { action: 'volume', params: { op: 'toggle' } };
      const n = parseInt(r, 10);
      return Number.isFinite(n) ? { action: 'volume', params: { op: 'set', value: n } } : null;
    }
    case 'verrou':
      return { action: 'lock', params: {} };
    case 'deverrouille':
      return { action: 'unlock', params: {}, confirm: UNLOCK_CONFIRM };
    case 'veille':
      return /profonde|vraie|deep/.test(r) ? { action: 'sleep', params: {}, confirm: DEEP_SLEEP_CONFIRM } : { action: 'standby', params: { op: 'enter' } };
    case 'reveil':
      return { action: 'standby', params: { op: 'exit', unlock: true }, confirm: WAKE_CONFIRM };
    case 'redemarre':
      return { action: 'power', params: { op: 'restart' }, confirm: { title: 'Redémarrer', detail: 'Les documents non enregistrés seront perdus.', icon: 'refresh-circle', danger: true } };
    case 'eteins':
      return { action: 'power', params: { op: 'shutdown' }, confirm: { title: 'Éteindre', detail: 'Les documents non enregistrés seront perdus et le PC ne répondra plus.', icon: 'power', danger: true } };
    default:
      return null;
  }
}

/** Message d'erreur précis pour une commande mal formée. */
export function commandProblem(text: string): string | null {
  const sc = splitCommand(text);
  if (!sc) return null;
  const def = COMMANDS.find((c) => c.cmd === sc.cmd);
  if (!def) return `Commande inconnue : /${sc.cmd}. Tape /aide pour voir la liste.`;
  if (def.cmd === 'media') return 'Pour la musique : /media (ce qui joue), /media pause, /media suivant ou /media precedent.';
  if (def.required && sc.rest.length < (def.cmd === 'message' || def.cmd === 'tape' || def.cmd === 'web' ? 1 : 2)) return `Il manque le ${def.arg} : par exemple « ${def.example} ».`;
  return null;
}

export function parseIntent(text: string): Intent | null {
  const sc = splitCommand(text);
  if (sc) return fromCommand(sc.cmd, sc.rest);
  const n = norm(text);
  if (/^\/?(aide|help|\?|commandes?)$/.test(n) || /(que (sais|peux)[ -]tu|tu sais faire|tu peux faire|capacite|quelles commandes|liste des commandes)/.test(n)) {
    return { action: 'capabilities', params: {} };
  }
  // Web et applications avant les règles sur les fichiers (« cherche sur google… » n'est pas un fichier).
  if (/(sur google|google|sur internet|sur le web)/.test(n)) {
    const q = after(text, ['cherche sur google', 'recherche sur google', 'sur google', 'google', 'sur internet', 'sur le web']);
    if (q.length >= 1) return { action: 'web', params: { op: 'search', q } };
  }
  if (/((ouvre|lance|demarre) (l )?(appli|application|logiciel|programme))/.test(n)) {
    const q = after(text, ['application', 'appli', 'logiciel', 'programme']);
    if (q.length >= 2) return { action: 'apps.open', params: { query: q, orFile: true } };
  }
  if (/(ecran en direct|en direct|controle a distance|bureau a distance|prendre la main|controler le pc|voir mon ecran)/.test(n)) return { action: 'remote', params: {} };
  if (/(zippe|zip|archive|compresse)/.test(n)) {
    const name = after(text, ['zippe', 'compresse', 'archive', 'zip']);
    return name.length >= 2 ? { action: 'files.zip', params: { query: name } } : null;
  }
  if (/(capture|screenshot|ecran|screen)/.test(n)) return { action: 'screenshot', params: {} };
  if (/(presse.?papier|clipboard)/.test(n)) return { action: 'clipboard.get', params: {} };
  if (/(morceau suivant|chanson suivante|piste suivante)/.test(n)) return { action: 'media', params: { op: 'next' } };
  if (/(mets? (la )?pause|reprends? la lecture|play|pause)/.test(n)) return { action: 'media', params: { op: 'play-pause' } };
  if (/(qu.est.ce qui (joue|passe)|quelle musique|quel morceau)/.test(n)) return { action: 'media', params: { op: 'status' } };
  if (/(monte|augmente) le son/.test(n)) return { action: 'volume', params: { op: 'up' } };
  if (/(baisse|diminue) le son/.test(n)) return { action: 'volume', params: { op: 'down' } };
  if (/(coupe le son|mode muet)/.test(n)) return { action: 'volume', params: { op: 'toggle' } };
  // « déverrouille » contient « verrouille » (et « unlock » contient « lock ») : à tester d'abord.
  if (/(deverrouill|unlock|debloque|ouvre (ma|la) session)/.test(n)) return { action: 'unlock', params: {}, confirm: UNLOCK_CONFIRM };
  if (/(verrouill|lock|bloque)/.test(n)) return { action: 'lock', params: {} };
  if (/(reveille|wake|rallume l.?ecran)/.test(n)) return { action: 'standby', params: { op: 'exit', unlock: true }, confirm: WAKE_CONFIRM };
  if (/(veille profonde|vraie veille|suspend)/.test(n)) return { action: 'sleep', params: {}, confirm: DEEP_SLEEP_CONFIRM };
  if (/(veille|dors|endors)/.test(n)) return { action: 'standby', params: { op: 'enter' } };
  if (/(cherche|trouve|recherche|ou est|ou se trouve)/.test(n)) {
    const query = after(text, ['recherche', 'cherche', 'trouve', 'ou se trouve', 'ou est']);
    return query.length >= 2 ? { action: 'files.search', params: { query } } : null;
  }
  if (/(envoie|recupere|donne|telecharge)/.test(n)) {
    const query = after(text, ['envoie moi', 'envoie', 'recupere', 'donne moi', 'telecharge']);
    return query.length >= 2 ? { action: 'files.search', params: { query, thenGet: true } } : null;
  }
  if (/(dossier|fichiers|explore|liste|parcour|montre)/.test(n)) return { action: 'files.list', params: { path: '~' } };
  if (/(notifi|fais signe|previens|affiche)/.test(n)) {
    const body = after(text, ['affiche', 'notifie', 'previens', 'fais signe']) || 'Ton téléphone te fait signe.';
    return { action: 'notify', params: { title: 'ORION', body } };
  }
  if (/(etat|statut|status|batterie|comment va|processeur|cpu|memoire|ram|disque)/.test(n)) return { action: 'status', params: {} };
  return null;
}

export const HELP =
  'Tape / pour voir mes commandes par thème, ou /aide. Par exemple : /direct pour voir l’écran du PC, /cherche facture pour récupérer un fichier, /ouvre chrome, /web météo, /veille puis /reveil.';
