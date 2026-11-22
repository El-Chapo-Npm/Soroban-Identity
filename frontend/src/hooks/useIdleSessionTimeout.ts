import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_IDLE_WARNING_MS = 2 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"] as const;

export function getIdleTimeoutMs(value = import.meta.env.VITE_SESSION_IDLE_TIMEOUT_MS): number {
  if (value === undefined || value === "") return DEFAULT_IDLE_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_TIMEOUT_MS;
}

export interface IdleSessionTimeoutResult {
  warningVisible: boolean;
  secondsRemaining: number;
  extendSession: () => void;
}

/** Disconnect an active wallet after a continuous period without user input. */
export function useIdleSessionTimeout(
  active: boolean,
  onIdle: () => void | Promise<void>,
  timeoutMs = getIdleTimeoutMs(),
  warningMs = DEFAULT_IDLE_WARNING_MS
): IdleSessionTimeoutResult {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const [warningVisible, setWarningVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.max(0, Math.ceil(warningMs / 1000))
  );

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const countdownRef = useRef<ReturnType<typeof setInterval> | undefined>();
  const expiredRef = useRef(false);
  const deadlineRef = useRef(0);

  const clearTimers = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    clearTimeout(warningTimerRef.current);
    clearInterval(countdownRef.current);
    idleTimerRef.current = undefined;
    warningTimerRef.current = undefined;
    countdownRef.current = undefined;
  }, []);

  const startCountdown = useCallback(() => {
    clearInterval(countdownRef.current);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };
    tick();
    countdownRef.current = setInterval(tick, 250);
  }, []);

  const resetTimer = useCallback(() => {
    if (expiredRef.current) return;
    clearTimers();
    setWarningVisible(false);

    const effectiveWarningMs = Math.min(Math.max(0, warningMs), Math.max(0, timeoutMs - 1));
    const warningDelay = Math.max(0, timeoutMs - effectiveWarningMs);
    deadlineRef.current = Date.now() + timeoutMs;
    setSecondsRemaining(Math.max(0, Math.ceil(effectiveWarningMs / 1000)));

    warningTimerRef.current = setTimeout(() => {
      if (expiredRef.current) return;
      setWarningVisible(true);
      startCountdown();
    }, warningDelay);

    idleTimerRef.current = setTimeout(() => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      clearTimers();
      setWarningVisible(false);
      void Promise.resolve(onIdleRef.current()).catch((error: unknown) => {
        console.error("Unable to end idle wallet session:", error);
      });
    }, timeoutMs);
  }, [clearTimers, startCountdown, timeoutMs, warningMs]);

  const extendSession = useCallback(() => {
    if (expiredRef.current) return;
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!active || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      clearTimers();
      expiredRef.current = false;
      setWarningVisible(false);
      return;
    }

    expiredRef.current = false;
    const onActivity = () => {
      if (warningVisible) return;
      resetTimer();
    };

    ACTIVITY_EVENTS.forEach((eventName) =>
      window.addEventListener(eventName, onActivity, { passive: true })
    );
    resetTimer();

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, onActivity));
    };
  }, [active, clearTimers, resetTimer, timeoutMs, warningVisible]);

  return { warningVisible, secondsRemaining, extendSession };
}
