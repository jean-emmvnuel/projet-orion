import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { previewTheme } from '@/dev/DevicePreview';

/**
 * Préférences d'affichage et de l'orbe, enregistrées sur l'appareil.
 */
export type AppearanceMode = 'system' | 'light' | 'dark';
export type KeepHistory = '30j' | '1an' | 'toujours';

export type OrbPalette = 'cyan' | 'orion' | 'aurore' | 'braise' | 'nebuleuse' | 'glace';
export type OrbStyle = 'constellation' | 'energie';
export type OrbDensity = 'legere' | 'normale' | 'dense';
export type OrbReactivity = 'douce' | 'normale' | 'intense';

export interface OrbSettings {
  style: OrbStyle;
  palette: OrbPalette;
  density: OrbDensity;
  speed: number; // 0.5 | 1 | 1.6
  reactivity: OrbReactivity;
  rays: boolean;
  orbits: boolean;
  edgeGlow: boolean;
}

export const defaultOrb: OrbSettings = {
  style: 'constellation',
  palette: 'cyan',
  density: 'normale',
  speed: 1,
  reactivity: 'normale',
  rays: true,
  orbits: true,
  edgeGlow: true,
};

interface Ctx {
  mode: AppearanceMode;
  scheme: 'light' | 'dark';
  setMode: (m: AppearanceMode) => void;
  keep: KeepHistory;
  setKeep: (k: KeepHistory) => void;
  orb: OrbSettings;
  setOrb: (patch: Partial<OrbSettings>) => void;
  resetOrb: () => void;
}

const KEY = 'orion.preferences.v2';
const AppearanceContext = createContext<Ctx | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>('system');
  const [keep, setKeep] = useState<KeepHistory>('toujours');
  const [orb, setOrbState] = useState<OrbSettings>(defaultOrb);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { mode?: AppearanceMode; orb?: Partial<OrbSettings>; keep?: KeepHistory };
        if (saved.keep) setKeep(saved.keep);
        if (saved.mode) setModeState(saved.mode);
        if (saved.orb) setOrbState({ ...defaultOrb, ...saved.orb });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEY, JSON.stringify({ mode, orb, keep })).catch(() => {});
  }, [mode, orb, keep, loaded]);

  const setMode = useCallback((m: AppearanceMode) => setModeState(m), []);
  const setOrb = useCallback((patch: Partial<OrbSettings>) => setOrbState((o) => ({ ...o, ...patch })), []);
  const resetOrb = useCallback(() => setOrbState(defaultOrb), []);

  const scheme: 'light' | 'dark' = previewTheme ?? (mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode);
  const value = useMemo(() => ({ mode, scheme, setMode, keep, setKeep, orb, setOrb, resetOrb }), [mode, scheme, setMode, keep, orb, setOrb, resetOrb]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance doit être utilisé sous <AppearanceProvider>');
  return ctx;
}
