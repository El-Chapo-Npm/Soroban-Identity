import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type TourPath = 'issuer' | 'holder';

export interface TourStep {
  /** Value of the target element's data-tour attribute. */
  target: string;
  title: string;
  description: string;
  /** Optional placement hint for the tooltip relative to the target. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TourOverlayProps {
  /** Which tour path to run. */
  path: TourPath;
  /** Whether the tour is currently active. */
  open: boolean;
  /** Called when the tour finishes, is skipped, or is dismissed. */
  onClose?: (reason: 'completed' | 'skipped') => void;
  /** Optional custom step configs; defaults to built-in issuer/holder paths. */
  steps?: Record<TourPath, TourStep[]>;
  /** localStorage key prefix for progress persistence. */
  storageKeyPrefix?: string;
}

const DEFAULT_STEPS: Record<TourPath, TourStep[]> = {
  issuer: [
    {
      target: 'create-did',
      title: 'Create your DID',
      description:
        'Start by creating a decentralized identifier (DID). This is your on-chain identity used to issue credentials.',
      placement: 'bottom',
    },
    {
      target: 'issue-credential',
      title: 'Issue a credential',
      description:
        'Once your DID is ready, issue verifiable credentials to holders directly from this dashboard.',
      placement: 'bottom',
    },
    {
      target: 'credentials-list',
      title: 'Manage credentials',
      description:
        'Track, revoke, and review all credentials you have issued from this list.',
      placement: 'top',
    },
  ],
  holder: [
    {
      target: 'create-did',
      title: 'Create your DID',
      description:
        'Set up your decentralized identifier (DID) to receive and hold verifiable credentials.',
      placement: 'bottom',
    },
    {
      target: 'receive-credential',
      title: 'Receive a credential',
      description:
        'Accept credentials shared with you by issuers. They will appear in your wallet.',
      placement: 'bottom',
    },
    {
      target: 'credentials-list',
      title: 'Your credentials',
      description:
        'View and share the credentials stored in your wallet from this list.',
      placement: 'top',
    },
  ],
};

const DEFAULT_STORAGE_PREFIX = 'tour-progress';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;

function getTargetRect(target: string): Rect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  };
}

function computeTooltipPosition(
  rect: Rect | null,
  placement: TourStep['placement'],
): React.CSSProperties {
  if (!rect || typeof window === 'undefined') {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const gap = 12;
  const place = placement ?? 'bottom';

  switch (place) {
    case 'top':
      return {
        top: rect.top - gap,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, -100%)',
      };
    case 'left':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - gap,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left + rect.width + gap,
        transform: 'translate(0, -50%)',
      };
    case 'bottom':
    default:
      return {
        top: rect.top + rect.height + gap,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, 0)',
      };
  }
}

export const TourOverlay: React.FC<TourOverlayProps> = ({
  path,
  open,
  onClose,
  steps,
  storageKeyPrefix = DEFAULT_STORAGE_PREFIX,
}) => {
  const stepConfig = useMemo(
    () => (steps ?? DEFAULT_STEPS)[path] ?? [],
    [steps, path],
  );

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const storageKey = `${storageKeyPrefix}:${path}`;

  const persistProgress = useCallback(
    (completed: boolean, stepIndex: number) => {
      try {
        const payload = {
          completed,
          stepIndex,
          updatedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {
        // Ignore storage failures (private mode, quota, etc.)
      }
    },
    [storageKey],
  );

  const readProgress = useCallback((): { completed: boolean; stepIndex: number } | null => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.completed === 'boolean') {
        return {
          completed: parsed.completed,
          stepIndex: typeof parsed.stepIndex === 'number' ? parsed.stepIndex : 0,
        };
      }
      return null;
    } catch {
      return null;
    }
  }, [storageKey]);

  // Reset to first step whenever the tour is (re)opened.
  useEffect(() => {
    if (open) {
      setIndex(0);
    }
  }, [open, path]);

  // Resolve the target rect for the current step and keep it in sync.
  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const step = stepConfig[index];
    if (!step) {
      setRect(null);
      return;
    }

    const update = () => setRect(getTargetRect(step.target));
    update();

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, index, stepConfig]);

  // Focus management: move focus into the tooltip when it opens / step changes.
  useEffect(() => {
    if (!open) return;
    if (!previouslyFocused.current) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    }
    const node = tooltipRef.current;
    if (node) {
      node.focus();
    }
  }, [open, index]);

  // Restore focus when the tour closes.
  useEffect(() => {
    if (open) return;
    const prev = previouslyFocused.current;
    previouslyFocused.current = null;
    if (prev && typeof prev.focus === 'function') {
      prev.focus();
    }
  }, [open]);

  const finish = useCallback(
    (reason: 'completed' | 'skipped') => {
      persistProgress(reason === 'completed', index);
      onClose?.(reason);
    },
    [index, onClose, persistProgress],
  );

  const handleNext = useCallback(() => {
    if (index >= stepConfig.length - 1) {
      finish('completed');
      return;
    }
    const next = index + 1;
    setIndex(next);
    persistProgress(false, next);
  }, [index, stepConfig.length, finish, persistProgress]);

  const handleBack = useCallback(() => {
    if (index <= 0) return;
    const prev = index - 1;
    setIndex(prev);
    persistProgress(false, prev);
  }, [index, persistProgress]);

  const handleSkip = useCallback(() => {
    finish('skipped');
  }, [finish]);

  // Escape to skip.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleSkip]);

  // Persist the starting step when the tour opens.
  useEffect(() => {
    if (open) {
      persistProgress(false, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, path]);

  if (!open || stepConfig.length === 0) {
    return null;
  }

  const step = stepConfig[index];
  const isFirst = index === 0;
  const isLast = index === stepConfig.length - 1;
  const progressLabel = `Step ${index + 1} of ${stepConfig.length}`;

  return (
    <div
      className="tour-overlay"
      data-testid="tour-overlay"
      role="dialog"
      aria-modal="false"
      aria-label={`${path} onboarding tour`}
    >
      {/* Dimmed backdrop with a transparent cutout over the target. */}
      <div
        className="tour-overlay__backdrop"
        aria-hidden="true"
        style={
          rect
            ? {
                position: 'fixed',
                inset: 0,
                pointerEvents: 'none',
                background: 'rgba(0, 0, 0, 0.55)',
                // Cut a hole over the highlighted element so it stays interactive.
                clipPath: `polygon(
                  0% 0%, 0% 100%,
                  ${rect.left}px 100%,
                  ${rect.left}px ${rect.top}px,
                  ${rect.left + rect.width}px ${rect.top}px,
                  ${rect.left + rect.width}px ${rect.top + rect.height}px,
                  ${rect.left}px ${rect.top + rect.height}px,
                  ${rect.left}px 100%,
                  100% 100%, 100% 0%
                )`,
              }
            : {
                position: 'fixed',
                inset: 0,
                pointerEvents: 'none',
                background: 'rgba(0, 0, 0, 0.55)',
              }
        }
      />

      {/* Highlight ring around the target (non-interactive). */}
      {rect && (
        <div
          className="tour-overlay__highlight"
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: 8,
            boxShadow: '0 0 0 2px #4f46e5, 0 0 0 4px rgba(79, 70, 229, 0.35)',
            pointerEvents: 'none',
            transition: 'all 0.2s ease',
            zIndex: 1000,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="tour-overlay__tooltip"
        role="document"
        tabIndex={-1}
        style={{
          position: 'fixed',
          zIndex: 1001,
          maxWidth: 320,
          background: '#ffffff',
          color: '#111827',
          borderRadius: 10,
          padding: '16px 18px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
          outline: 'none',
          ...computeTooltipPosition(rect, step.placement),
        }}
      >
        <div
          className="tour-overlay__progress"
          aria-hidden="true"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#6b7280',
            marginBottom: 6,
          }}
        >
          {progressLabel}
        </div>

        <h3
          className="tour-overlay__title"
          style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}
        >
          {step.title}
        </h3>

        <p
          className="tour-overlay__description"
          style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: '#374151' }}
        >
          {step.description}
        </p>

        <div
          className="tour-overlay__actions"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <button
            type="button"
            onClick={handleSkip}
            className="tour-overlay__skip"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              fontSize: 13,
              padding: '6px 4px',
              marginRight: 'auto',
            }}
          >
            Skip tour
          </button>

          <button
            type="button"
            onClick={handleBack}
            disabled={isFirst}
            className="tour-overlay__back"
            style={{
              background: '#f3f4f6',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: '6px 12px',
              cursor: isFirst ? 'not-allowed' : 'pointer',
              opacity: isFirst ? 0.5 : 1,
              fontSize: 13,
            }}
          >
            Back
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="tour-overlay__next"
            style={{
              background: '#4f46e5',
              border: '1px solid #4f46e5',
              color: '#ffffff',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>

        {/* Progress dots */}
        <div
          className="tour-overlay__dots"
          aria-hidden="true"
          style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'center' }}
        >
          {stepConfig.map((_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: i === index ? '#4f46e5' : '#d1d5db',
              }}
            />
          ))}
        </div>
      </div>

      {/* Screen-reader announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {`${progressLabel}. ${step.title}. ${step.description}`}
      </div>
    </div>
  );
};

/**
 * Restart entry point. Clears stored progress for the given path and
 * returns a handler that reopens the tour.
 */
export function useTourRestart(
  path: TourPath,
  storageKeyPrefix: string = DEFAULT_STORAGE_PREFIX,
) {
  const [open, setOpen] = useState(false);

  const restart = useCallback(() => {
    try {
      window.localStorage.removeItem(`${storageKeyPrefix}:${path}`);
    } catch {
      // Ignore storage failures.
    }
    setOpen(true);
  }, [path, storageKeyPrefix]);

  const close = useCallback(() => setOpen(false), []);

  return { open, restart, close };
}

export default TourOverlay;