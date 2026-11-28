import type { OrbPalette } from '@/theme/appearance';

export interface OrbColors {
  label: string;
  glow: string;
  core: string;
  particles: [string, string, string]; // fond → milieu → devant
  ray: string;
  iris: string[]; // halo des bords
}

/** Palettes de l'orbe. « Cyan » reprend la sphère réseau de la vidéo de référence. */
export const orbPalettes: Record<OrbPalette, OrbColors> = {
  cyan: {
    label: 'Cyan',
    glow: '#22c3ee',
    core: '#effeff',
    particles: ['#0e7490', '#5ee3fa', '#e6fdff'],
    ray: '#7fe9fb',
    iris: ['#22c3ee', '#3b82f6', '#a5f3fc', '#06b6d4', '#22c3ee'],
  },
  orion: {
    label: 'Orion',
    glow: '#9810e6',
    core: '#f7eeff',
    particles: ['#6d28d9', '#a35cf0', '#efe2ff'],
    ray: '#d2acff',
    iris: ['#9810e6', '#5b5bff', '#38bdf8', '#ff5ec4', '#b878f5', '#9810e6'],
  },
  aurore: {
    label: 'Aurore',
    glow: '#3b5bff',
    core: '#effbff',
    particles: ['#1e40af', '#38bdf8', '#dcf6ff'],
    ray: '#a5e9ff',
    iris: ['#3b5bff', '#22d3ee', '#34d399', '#818cf8', '#3b5bff'],
  },
  braise: {
    label: 'Braise',
    glow: '#ff6a00',
    core: '#fff6e6',
    particles: ['#c2410c', '#fb923c', '#ffe4bf'],
    ray: '#ffc27d',
    iris: ['#ff6a00', '#ffb020', '#ff3d6e', '#ff8a3d', '#ff6a00'],
  },
  nebuleuse: {
    label: 'Nébuleuse',
    glow: '#e0279b',
    core: '#fff0fa',
    particles: ['#9d174d', '#f472b6', '#ffd9f0'],
    ray: '#ffacdd',
    iris: ['#e0279b', '#9810e6', '#ff7ab6', '#7c3aed', '#e0279b'],
  },
  glace: {
    label: 'Glace',
    glow: '#6ea3d0',
    core: '#ffffff',
    particles: ['#5b7087', '#b7d0e6', '#ffffff'],
    ray: '#dcebff',
    iris: ['#9cc9ff', '#e0f2ff', '#7dd3fc', '#c7d2fe', '#9cc9ff'],
  },
};

/** Sur fond clair, les particules claires disparaissent : on les assombrit. */
export function forScheme(p: OrbColors, scheme: 'light' | 'dark'): OrbColors {
  if (scheme === 'dark') return p;
  return { ...p, particles: [p.particles[0], p.glow, p.particles[1]], ray: p.glow };
}
