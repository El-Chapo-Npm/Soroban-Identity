import { useCallback, useEffect, useState } from 'react';

export type TourPath = 'issuer' | 'holder';

export interface TourProgress {
  /** Current step index within the active tour path. */
  currentStep: number;
  /** Identifiers of steps that have been completed. */
  completedSteps: string[];
  /** Whether the user skipped the tour. */
  skipped: boolean;
  /** Whether the tour has been fully completed. */
  completed: boolean;
  /** The active tour path (issuer vs holder). */
  path: TourPath | null;
  /** Timestamp (ms) of the last update. */
  updatedAt: number;
}

export const TOUR_STORAGE_VERSION = 1;
export const TOUR_STORAGE_KEY = `did-tour-progress:v${TOUR_STORAGE_VERSION}`;

const DEFAULT_PROGRESS: TourProgress = {
  currentStep: 0,
  completedSteps: [],
  skipped: false,
  completed: false,
  path: null,
  updatedAt: 0,
};

const isTourPath = (value: unknown): value is TourPath =>
  value === 'issuer' || value === 'holder';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Safely parse a raw localStorage value into a TourProgress object.
 * Returns null when the value is missing, malformed, or from an
 * incompatible schema version.
 */
export const parseTourProgress = (raw: string | null): TourProgress | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;

    // Reject payloads written by an older/newer schema version.
    if (candidate.version !== TOUR_STORAGE_VERSION) {
      return null;
    }

    const data = candidate.data;
    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const record = data as Record<string, unknown>;

    const currentStep =
      typeof record.currentStep === 'number' && Number.isFinite(record.currentStep)
        ? Math.max(0, Math.floor(record.currentStep))
        : 0;

    const completedSteps = isStringArray(record.completedSteps)
      ? record.completedSteps
      : [];

    const skipped = record.skipped === true;
    const completed = record.completed === true;
    const path = isTourPath(record.path) ? record.path : null;
    const updatedAt =
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : 0;

    return {
      currentStep,
      completedSteps,
      skipped,
      completed,
      path,
      updatedAt,
    };
  } catch {
    return null;
  }
};

const readProgress = (): TourProgress => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_PROGRESS };
  }

  try {
    const raw = window.localStorage.getItem(TOUR_STORAGE_KEY);
    const parsed = parseTourProgress(raw);
    return parsed ?? { ...DEFAULT_PROGRESS };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
};

const writeProgress = (progress: TourProgress): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const payload = {
      version: TOUR_STORAGE_VERSION,
      data: progress,
    };
    window.localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / privacy-mode errors; progress simply won't persist.
  }
};

const clearProgress = (): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};

export interface UseTourProgressResult {
  progress: TourProgress;
  /** Replace the entire progress object. */
  setProgress: (next: TourProgress) => void;
  /** Merge a partial update into the current progress. */
  updateProgress: (patch: Partial<TourProgress>) => void;
  /** Mark a step as completed and advance the current step. */
  completeStep: (stepId: string, nextStep?: number) => void;
  /** Record that the user skipped the tour. */
  skipTour: () => void;
  /** Record that the tour finished successfully. */
  completeTour: () => void;
  /** Reset progress back to defaults (used by "restart tour"). */
  resetProgress: () => void;
  /** Select the active tour path. */
  setPath: (path: TourPath) => void;
}

/**
 * Persist and restore onboarding tour progress in localStorage.
 *
 * The stored payload is versioned so that future schema changes can be
 * detected and safely discarded rather than crashing the app.
 */
export const useTourProgress = (): UseTourProgressResult => {
  const [progress, setProgressState] = useState<TourProgress>(() => readProgress());

  // Keep multiple tabs / hook instances in sync.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TOUR_STORAGE_KEY) {
        return;
      }

      const parsed = parseTourProgress(event.newValue);
      setProgressState(parsed ?? { ...DEFAULT_PROGRESS });
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const persist = useCallback((next: TourProgress) => {
    const stamped: TourProgress = { ...next, updatedAt: Date.now() };
    setProgressState(stamped);
    writeProgress(stamped);
  }, []);

  const setProgress = useCallback(
    (next: TourProgress) => {
      persist(next);
    },
    [persist],
  );

  const updateProgress = useCallback(
    (patch: Partial<TourProgress>) => {
      setProgressState((prev) => {
        const next: TourProgress = { ...prev, ...patch, updatedAt: Date.now() };
        writeProgress(next);
        return next;
      });
    },
    [],
  );

  const completeStep = useCallback(
    (stepId: string, nextStep?: number) => {
      setProgressState((prev) => {
        const completedSteps = prev.completedSteps.includes(stepId)
          ? prev.completedSteps
          : [...prev.completedSteps, stepId];

        const next: TourProgress = {
          ...prev,
          completedSteps,
          currentStep:
            typeof nextStep === 'number' && Number.isFinite(nextStep)
              ? Math.max(0, Math.floor(nextStep))
              : prev.currentStep,
          updatedAt: Date.now(),
        };

        writeProgress(next);
        return next;
      });
    },
    [],
  );

  const skipTour = useCallback(() => {
    updateProgress({ skipped: true });
  }, [updateProgress]);

  const completeTour = useCallback(() => {
    updateProgress({ completed: true, skipped: false });
  }, [updateProgress]);

  const resetProgress = useCallback(() => {
    clearProgress();
    setProgressState({ ...DEFAULT_PROGRESS, updatedAt: Date.now() });
  }, []);

  const setPath = useCallback(
    (path: TourPath) => {
      updateProgress({ path });
    },
    [updateProgress],
  );

  return {
    progress,
    setProgress,
    updateProgress,
    completeStep,
    skipTour,
    completeTour,
    resetProgress,
    setPath,
  };
};

export default useTourProgress;