import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Onboarding tour context.
 *
 * Manages the guided onboarding tour state for new users:
 *  - current step index
 *  - active tour path (issuer vs holder)
 *  - completed / skipped status
 *  - persistence to localStorage under a versioned key
 *  - lifecycle events emitted to the analytics/metrics layer
 *  - feature-flag gating so the tour can be disabled via config
 */

export type TourPath = 'issuer' | 'holder';

export type TourStatus = 'idle' | 'active' | 'completed' | 'skipped';

export type TourLifecycleEvent =
  | 'start'
  | 'step'
  | 'complete'
  | 'skip';

export interface TourStep {
  /** Stable identifier for the step, used for analytics. */
  id: string;
  /** Human readable title shown in the tooltip. */
  title: string;
  /** Tooltip / hint body copy. */
  description: string;
  /** Optional CSS selector for the element to highlight. */
  target?: string;
  /** Optional placement hint for the tooltip. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TourEventPayload {
  event: TourLifecycleEvent;
  path: TourPath;
  stepIndex: number;
  stepId?: string;
  totalSteps: number;
  timestamp: number;
}

export interface TourAnalytics {
  track: (payload: TourEventPayload) => void;
}

export interface TourConfig {
  /** Feature flag: when false the tour is disabled entirely. */
  enabled: boolean;
  /** Versioned storage key suffix, bumped when steps change. */
  version: string;
}

export interface TourState {
  /** Whether the tour feature is enabled via config. */
  enabled: boolean;
  /** Current lifecycle status. */
  status: TourStatus;
  /** Active tour path. */
  path: TourPath;
  /** Index of the current step. */
  stepIndex: number;
  /** Steps for the active path. */
  steps: TourStep[];
  /** Current step, or null when not active. */
  currentStep: TourStep | null;
  /** Total number of steps for the active path. */
  totalSteps: number;
  /** Whether the tour has been completed at least once. */
  completed: boolean;
  /** Whether the tour was skipped. */
  skipped: boolean;
  /** Whether the tour is currently active. */
  isActive: boolean;
  /** Whether the current step is the first step. */
  isFirstStep: boolean;
  /** Whether the current step is the last step. */
  isLastStep: boolean;
}

export interface TourActions {
  /** Start the tour, optionally switching path. */
  start: (path?: TourPath) => void;
  /** Advance to the next step, completing the tour on the last step. */
  next: () => void;
  /** Go back to the previous step. */
  prev: () => void;
  /** Skip the tour. */
  skip: () => void;
  /** Restart the tour from the beginning. */
  restart: (path?: TourPath) => void;
  /** Mark the tour as completed. */
  complete: () => void;
  /** Jump to a specific step index. */
  goTo: (index: number) => void;
  /** Switch the active tour path. */
  setPath: (path: TourPath) => void;
}

export type TourContextValue = TourState & TourActions;

/* -------------------------------------------------------------------------- */
/*                                  Config                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_CONFIG: TourConfig = {
  enabled: true,
  version: 'v1',
};

const STORAGE_PREFIX = 'onboarding-tour';

const buildStorageKey = (version: string): string =>
  `${STORAGE_PREFIX}:${version}`;

/* -------------------------------------------------------------------------- */
/*                              Tour definitions                              */
/* -------------------------------------------------------------------------- */

export const TOUR_STEPS: Record<TourPath, TourStep[]> = {
  issuer: [
    {
      id: 'welcome',
      title: 'Welcome to the Issuer Dashboard',
      description:
        'This quick tour shows you how to create a DID and issue your first verifiable credential.',
      placement: 'bottom',
    },
    {
      id: 'create-did',
      title: 'Create your DID',
      description:
        'A decentralized identifier (DID) is your on-chain identity. Click here to create one.',
      target: '[data-tour="create-did"]',
      placement: 'bottom',
    },
    {
      id: 'issue-credential',
      title: 'Issue a credential',
      description:
        'Once your DID is ready, issue verifiable credentials to your holders from here.',
      target: '[data-tour="issue-credential"]',
      placement: 'left',
    },
    {
      id: 'manage-credentials',
      title: 'Manage credentials',
      description:
        'Track, revoke, and audit every credential you have issued in this panel.',
      target: '[data-tour="manage-credentials"]',
      placement: 'top',
    },
  ],
  holder: [
    {
      id: 'welcome',
      title: 'Welcome to your Wallet',
      description:
        'This quick tour shows you how to receive and manage your verifiable credentials.',
      placement: 'bottom',
    },
    {
      id: 'create-did',
      title: 'Create your DID',
      description:
        'A decentralized identifier (DID) is your on-chain identity. Create one to get started.',
      target: '[data-tour="create-did"]',
      placement: 'bottom',
    },
    {
      id: 'receive-credential',
      title: 'Receive a credential',
      description:
        'Share your DID with an issuer to receive verifiable credentials into your wallet.',
      target: '[data-tour="receive-credential"]',
      placement: 'left',
    },
    {
      id: 'view-credentials',
      title: 'View your credentials',
      description:
        'All of your credentials live here. You can share them with verifiers at any time.',
      target: '[data-tour="view-credentials"]',
      placement: 'top',
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*                              Persistence                                   */
/* -------------------------------------------------------------------------- */

interface PersistedTourState {
  path: TourPath;
  stepIndex: number;
  completed: boolean;
  skipped: boolean;
  status: TourStatus;
  updatedAt: number;
}

const isTourPath = (value: unknown): value is TourPath =>
  value === 'issuer' || value === 'holder';

const isTourStatus = (value: unknown): value is TourStatus =>
  value === 'idle' ||
  value === 'active' ||
  value === 'completed' ||
  value === 'skipped';

const readPersistedState = (
  version: string,
): PersistedTourState | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(buildStorageKey(version));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedTourState>;

    if (!isTourPath(parsed.path)) {
      return null;
    }

    const stepIndex =
      typeof parsed.stepIndex === 'number' && parsed.stepIndex >= 0
        ? Math.floor(parsed.stepIndex)
        : 0;

    return {
      path: parsed.path,
      stepIndex,
      completed: Boolean(parsed.completed),
      skipped: Boolean(parsed.skipped),
      status: isTourStatus(parsed.status) ? parsed.status : 'idle',
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
};

const writePersistedState = (
  version: string,
  state: PersistedTourState,
): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(
      buildStorageKey(version),
      JSON.stringify(state),
    );
  } catch {
    /* storage unavailable or quota exceeded — fail silently */
  }
};

const clearPersistedState = (version: string): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(buildStorageKey(version));
  } catch {
    /* fail silently */
  }
};

/* -------------------------------------------------------------------------- */
/*                                  Context                                   */
/* -------------------------------------------------------------------------- */

const TourContext = createContext<TourContextValue | undefined>(undefined);

export interface TourProviderProps {
  children: React.ReactNode;
  /** Optional config override; merged with defaults. */
  config?: Partial<TourConfig>;
  /** Optional analytics sink for tour lifecycle events. */
  analytics?: TourAnalytics;
  /** Optional initial path when no persisted state exists. */
  initialPath?: TourPath;
}

export const TourProvider: React.FC<TourProviderProps> = ({
  children,
  config,
  analytics,
  initialPath = 'issuer',
}) => {
  const resolvedConfig = useMemo<TourConfig>(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    [config?.enabled, config?.version],
  );

  const { enabled, version } = resolvedConfig;

  const [path, setPathState] = useState<TourPath>(initialPath);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [status, setStatus] = useState<TourStatus>('idle');
  const [completed, setCompleted] = useState<boolean>(false);
  const [skipped, setSkipped] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  const analyticsRef = useRef<TourAnalytics | undefined>(analytics);
  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);

  const steps = useMemo<TourStep[]>(() => TOUR_STEPS[path] ?? [], [path]);
  const totalSteps = steps.length;

  const emit = useCallback(
    (
      event: TourLifecycleEvent,
      overrides?: { path?: TourPath; stepIndex?: number; stepId?: string },
    ) => {
      const eventPath = overrides?.path ?? path;
      const eventStepIndex = overrides?.stepIndex ?? stepIndex;
      const eventSteps = TOUR_STEPS[eventPath] ?? [];
      const stepId =
        overrides?.stepId ?? eventSteps[eventStepIndex]?.id;

      const payload: TourEventPayload = {
        event,
        path: eventPath,
        stepIndex: eventStepIndex,
        stepId,
        totalSteps: eventSteps.length,
        timestamp: Date.now(),
      };

      try {
        analyticsRef.current?.track(payload);
      } catch {
        /* analytics must never break the tour */
      }
    },
    [path, stepIndex],
  );

  /* ------------------------------ hydration ------------------------------ */

  useEffect(() => {
    if (!enabled) {
      setHydrated(true);
      return;
    }

    const persisted = readPersistedState(version);
    if (persisted) {
      setPathState(persisted.path);
      setStepIndex(persisted.stepIndex);
      setCompleted(persisted.completed);
      setSkipped(persisted.skipped);
      setStatus(persisted.status);
    }

    setHydrated(true);
  }, [enabled, version]);

  /* ----------------------------- persistence ----------------------------- */

  useEffect(() => {
    if (!enabled || !hydrated) {
      return;
    }

    writePersistedState(version, {
      path,
      stepIndex,
      completed,
      skipped,
      status,
      updatedAt: Date.now(),
    });
  }, [enabled, hydrated, version, path, stepIndex, completed, skipped, status]);

  /* ------------------------------- actions ------------------------------- */

  const start = useCallback(
    (nextPath?: TourPath) => {
      if (!enabled) {
        return;
      }

      const targetPath = nextPath ?? path;
      const targetSteps = TOUR_STEPS[targetPath] ?? [];

      if (targetSteps.length === 0) {
        return;
      }

      setPathState(targetPath);
      setStepIndex(0);
      setStatus('active');
      setCompleted(false);
      setSkipped(false);

      emit('start', { path: targetPath, stepIndex: 0 });
    },
    [enabled, path, emit],
  );

  const complete = useCallback(() => {
    if (!enabled) {
      return;
    }

    setStatus('completed');
    setCompleted(true);
    setSkipped(false);

    emit('complete');
  }, [enabled, emit]);

  const next = useCallback(() => {
    if (!enabled || status !== 'active') {
      return;
    }

    const lastIndex = totalSteps - 1;

    if (stepIndex >= lastIndex) {
      complete();
      return;
    }

    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);

    emit('step', { stepIndex: nextIndex });
  }, [enabled, status, stepIndex, totalSteps, complete, emit]);

  const prev = useCallback(() => {
    if (!enabled || status !== 'active') {
      return;
    }

    if (stepIndex <= 0) {
      return;
    }

    const prevIndex = stepIndex - 1;
    setStepIndex(prevIndex);

    emit('step', { stepIndex: prevIndex });
  }, [enabled, status, stepIndex, emit]);

  const skip = useCallback(() => {
    if (!enabled) {
      return;
    }

    setStatus('skipped');
    setSkipped(true);
    setCompleted(false);

    emit('skip');
  }, [enabled, emit]);

  const restart = useCallback(
    (nextPath?: TourPath) => {
      if (!enabled) {
        return;
      }

      const targetPath = nextPath ?? path;
      const targetSteps = TOUR_STEPS[targetPath] ?? [];

      if (targetSteps.length === 0) {
        return;
      }

      clearPersistedState(version);

      setPathState(targetPath);
      setStepIndex(0);
      setStatus('active');
      setCompleted(false);
      setSkipped(false);

      emit('start', { path: targetPath, stepIndex: 0 });
    },
    [enabled, path, version, emit],
  );

  const goTo = useCallback(
    (index: number) => {
      if (!enabled || status !== 'active') {
        return;
      }

      if (index < 0 || index >= totalSteps) {
        return;
      }

      setStepIndex(index);
      emit('step', { stepIndex: index });
    },
    [enabled, status, totalSteps, emit],
  );

  const setPath = useCallback(
    (nextPath: TourPath) => {
      if (!enabled) {
        return;
      }

      const targetSteps = TOUR_STEPS[nextPath] ?? [];
      if (targetSteps.length === 0) {
        return;
      }

      setPathState(nextPath);
      setStepIndex(0);

      if (status === 'active') {
        emit('start', { path: nextPath, stepIndex: 0 });
      }
    },
    [enabled, status, emit],
  );

  /* -------------------------------- derived ------------------------------- */

  const currentStep = status === 'active' ? steps[stepIndex] ?? null : null;
  const isActive = status === 'active';
  const isFirstStep = stepIndex <= 0;
  const isLastStep = totalSteps > 0 && stepIndex >= totalSteps - 1;

  const value = useMemo<TourContextValue>(
    () => ({
      enabled,
      status,
      path,
      stepIndex,
      steps,
      currentStep,
      totalSteps,
      completed,
      skipped,
      isActive,
      isFirstStep,
      isLastStep,
      start,
      next,
      prev,
      skip,
      restart,
      complete,
      goTo,
      setPath,
    }),
    [
      enabled,
      status,
      path,
      stepIndex,
      steps,
      currentStep,
      totalSteps,
      completed,
      skipped,
      isActive,
      isFirstStep,
      isLastStep,
      start,
      next,
      prev,
      skip,
      restart,
      complete,
      goTo,
      setPath,
    ],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
};

/* -------------------------------------------------------------------------- */
/*                                   Hook                                     */
/* -------------------------------------------------------------------------- */

export const useTour = (): TourContextValue => {
  const context = useContext(TourContext);

  if (context === undefined) {
    throw new Error('useTour must be used within a TourProvider');
  }

  return context;
};

export default TourContext;