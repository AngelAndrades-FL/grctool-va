/**
 * View state that is not server state: the baseline/framework toggles, list
 * filters, palette visibility and toasts. Persisted preferences (baseline,
 * framework, theme) are mirrored into settings.json on change.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { BaselineFilter, FrameworkMode, ImplementationStatus } from '@shared/types';
import { useSaveSettings, useSettings } from '@/api/queries';

export interface ListFilters {
  statuses: ImplementationStatus[];
  controlTypes: string[];
  priorityCodes: string[];
  designations: string[];
  onlyGaps: boolean;
  onlyStale: boolean;
  showOutOfBaseline: boolean;
  showWithdrawn: boolean;
}

const EMPTY_FILTERS: ListFilters = {
  statuses: [],
  controlTypes: [],
  priorityCodes: [],
  designations: [],
  onlyGaps: false,
  onlyStale: false,
  showOutOfBaseline: false,
  showWithdrawn: false,
};

export interface Toast {
  id: number;
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error';
}

interface AppStateValue {
  baseline: BaselineFilter;
  setBaseline: (value: BaselineFilter) => void;
  mode: FrameworkMode;
  setMode: (value: FrameworkMode) => void;
  themeMode: 'light' | 'dark';
  toggleTheme: () => void;
  filters: ListFilters;
  setFilters: (update: Partial<ListFilters>) => void;
  resetFilters: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  toasts: Toast[];
  notify: (message: string, severity?: Toast['severity']) => void;
  dismissToast: (id: number) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

let toastId = 0;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  const [baseline, setBaselineState] = useState<BaselineFilter>('Moderate');
  const [mode, setModeState] = useState<FrameworkMode>('va');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [filters, setFiltersState] = useState<ListFilters>(EMPTY_FILTERS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Adopt stored preferences once settings arrive.
  useEffect(() => {
    if (!settings) return;
    setBaselineState(settings.baseline);
    setModeState(settings.frameworkMode);
    setThemeMode(settings.themeMode);
  }, [settings]);

  const persist = useCallback(
    (patch: Partial<{ baseline: BaselineFilter; frameworkMode: FrameworkMode; themeMode: 'light' | 'dark' }>) => {
      if (!settings) return;
      // 'All' is a transient view filter, not a system impact level.
      const nextBaseline = patch.baseline && patch.baseline !== 'All' ? patch.baseline : settings.baseline;
      saveSettings.mutate({
        ...settings,
        baseline: nextBaseline,
        frameworkMode: patch.frameworkMode ?? settings.frameworkMode,
        themeMode: patch.themeMode ?? settings.themeMode,
      });
    },
    [saveSettings, settings],
  );

  const notify = useCallback((message: string, severity: Toast['severity'] = 'success') => {
    toastId += 1;
    const toast = { id: toastId, message, severity };
    setToasts((current) => [...current, toast]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== toast.id)), 5000);
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      baseline,
      setBaseline: (next) => {
        setBaselineState(next);
        persist({ baseline: next });
      },
      mode,
      setMode: (next) => {
        setModeState(next);
        persist({ frameworkMode: next });
      },
      themeMode,
      toggleTheme: () => {
        const next = themeMode === 'light' ? 'dark' : 'light';
        setThemeMode(next);
        persist({ themeMode: next });
      },
      filters,
      setFilters: (update) => setFiltersState((current) => ({ ...current, ...update })),
      resetFilters: () => setFiltersState(EMPTY_FILTERS),
      paletteOpen,
      setPaletteOpen,
      toasts,
      notify,
      dismissToast: (id) => setToasts((current) => current.filter((t) => t.id !== id)),
    }),
    [baseline, mode, themeMode, filters, paletteOpen, toasts, notify, persist],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState must be used inside AppStateProvider');
  return context;
}
