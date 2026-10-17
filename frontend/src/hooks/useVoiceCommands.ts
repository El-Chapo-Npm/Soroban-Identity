import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * useVoiceCommands
 * -----------------
 * A hook that wraps the Web Speech API (SpeechRecognition / webkitSpeechRecognition)
 * to provide voice command support for accessibility and hands-free operation.
 *
 * Features:
 *  - Command registry mapping localized phrases to actions (search, navigate, verify).
 *  - Microphone permission handling via Permissions API / getUserMedia with clear
 *    denied / unavailable states.
 *  - Continuous listening with automatic restart handling.
 *  - Speech synthesis for voice feedback confirmation.
 *  - Listening state exposed for visual feedback.
 *  - Localized command grammars using the existing i18n setup.
 *
 * Browser support limitations:
 *  - SpeechRecognition is currently well supported in Chromium-based browsers
 *    (Chrome, Edge, Opera) and Safari (with the `webkit` prefix). Firefox does not
 *    support SpeechRecognition by default (behind a flag / not implemented).
 *  - SpeechSynthesis is broadly supported across modern browsers, but available
 *    voices and languages vary by platform and OS.
 *  - The Permissions API `microphone` query is not supported in all browsers
 *    (notably Safari); we fall back to getUserMedia probing in that case.
 *  - Recognition accuracy and language support depend on the browser's speech
 *    service and the user's OS language packs.
 */

export type VoiceCommandAction = 'search' | 'navigate' | 'verify';

export interface VoiceCommandMatch {
  action: VoiceCommandAction;
  /** The raw recognized transcript. */
  transcript: string;
  /** The matched command phrase (localized). */
  phrase: string;
  /** Optional captured argument (e.g. search query or navigation target). */
  argument?: string;
}

export interface VoiceCommandHandlers {
  onSearch?: (query: string, match: VoiceCommandMatch) => void;
  onNavigate?: (target: string, match: VoiceCommandMatch) => void;
  onVerify?: (match: VoiceCommandMatch) => void;
  /** Called for any recognized command, in addition to the specific handler. */
  onCommand?: (match: VoiceCommandMatch) => void;
  /** Called when a transcript is recognized but does not match any command. */
  onUnrecognized?: (transcript: string) => void;
  /** Called when an error occurs during recognition. */
  onError?: (error: string) => void;
}

export type MicrophonePermissionState =
  | 'unknown'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unavailable';

export interface VoiceCommand {
  phrases: string[];
  description?: string;
  handler: (transcript: string) => void;
}

export interface UseVoiceCommandsOptions extends VoiceCommandHandlers {
  /** BCP-47 language tag used for recognition and synthesis. Defaults to i18n language. */
  lang?: string;
  /** Whether to keep listening continuously (auto-restart). Defaults to false. */
  continuous?: boolean;
  /** Whether to return interim (non-final) results. Defaults to false. */
  interimResults?: boolean;
  /** Whether to speak confirmation feedback via speech synthesis. Defaults to true. */
  speakFeedback?: boolean;
  /** Whether to automatically request microphone permission on mount. Defaults to false. */
  autoRequestPermission?: boolean;
  /** Custom localized command phrases or VoiceCommand array, overriding the i18n defaults. */
  commands?: Partial<Record<VoiceCommandAction, string[]>> | VoiceCommand[];
}

export interface UseVoiceCommandsResult {
  /** Whether the browser supports SpeechRecognition. */
  isSupported: boolean;
  /** Whether the browser supports SpeechSynthesis. */
  isSpeechSynthesisSupported: boolean;
  /** Whether recognition is currently active. */
  isListening: boolean;
  /** Current interim transcript for visual feedback. */
  interimTranscript: string;
  /** Last final transcript recognized. */
  finalTranscript: string;
  /** Last matched command, if any. */
  lastMatch: VoiceCommandMatch | null;
  /** Current microphone permission state. */
  permissionState: MicrophonePermissionState;
  /** Last error message, if any. */
  error: string | null;
  /** The resolved recognition language. */
  lang: string;
  /** The localized command registry currently in use. */
  commandRegistry: Record<VoiceCommandAction, string[]>;
  /** Start listening. Optionally requests permission first. */
  start: () => Promise<void>;
  /** Stop listening. */
  stop: () => void;
  /** Toggle listening state. */
  toggle: () => Promise<void>;
  /** Explicitly request microphone permission. */
  requestPermission: () => Promise<MicrophonePermissionState>;
  /** Speak a confirmation message via speech synthesis. */
  speak: (message: string) => void;
  /** Clear the last error. */
  clearError: () => void;
}

/* -------------------------------------------------------------------------- */
/* Browser API typings (minimal, to avoid depending on lib.dom experimental)   */
/* -------------------------------------------------------------------------- */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_COMMANDS: Record<VoiceCommandAction, string[]> = {
  search: ['search', 'find', 'look for'],
  navigate: ['go to', 'navigate to', 'open'],
  verify: ['verify', 'confirm', 'check'],
};

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSpeech;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    // strip diacritics for more forgiving matching across languages
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Attempt to match a transcript against the command registry.
 * Returns the matched action, phrase and any trailing argument.
 */
function matchCommand(
  transcript: string,
  registry: Record<VoiceCommandAction, string[]>,
): VoiceCommandMatch | null {
  const normalizedTranscript = normalize(transcript);
  if (!normalizedTranscript) return null;

  let best: { action: VoiceCommandAction; phrase: string; length: number } | null = null;

  (Object.keys(registry) as VoiceCommandAction[]).forEach((action) => {
    registry[action].forEach((phrase) => {
      const normalizedPhrase = normalize(phrase);
      if (!normalizedPhrase) return;

      // Match at the start of the transcript, or anywhere as a fallback.
      const startsWith = normalizedTranscript.startsWith(normalizedPhrase);
      const includes = normalizedTranscript.includes(normalizedPhrase);
      if (!startsWith && !includes) return;

      // Prefer the longest matching phrase to disambiguate.
      if (!best || normalizedPhrase.length > best.length) {
        best = { action, phrase, length: normalizedPhrase.length };
      }
    });
  });

  if (!best) return null;

  const matched = best as { action: VoiceCommandAction; phrase: string; length: number };
  const normalizedPhrase = normalize(matched.phrase);
  const idx = normalizedTranscript.indexOf(normalizedPhrase);
  const remainder = normalizedTranscript
    .slice(idx + normalizedPhrase.length)
    .trim();

  return {
    action: matched.action,
    transcript,
    phrase: matched.phrase,
    argument: remainder || undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useVoiceCommands(
  options: UseVoiceCommandsOptions = {},
): UseVoiceCommandsResult {
  const {
    lang: langOption,
    continuous = false,
    interimResults = false,
    speakFeedback = true,
    autoRequestPermission = false,
    commands: customCommands,
    onSearch,
    onNavigate,
    onVerify,
    onCommand,
    onUnrecognized,
    onError,
  } = options;

  const { i18n } = useTranslation();

  const resolvedLang = useMemo(
    () => langOption ?? i18n.language ?? 'en-US',
    [langOption, i18n.language],
  );

  const isSupported = useMemo(() => getSpeechRecognitionConstructor() !== null, []);
  const isSpeechSynthesisSupported = useMemo(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
    [],
  );

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [lastMatch, setLastMatch] = useState<VoiceCommandMatch | null>(null);
  const [permissionState, setPermissionState] =
    useState<MicrophonePermissionState>('unknown');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Keep latest handlers in refs so the recognition instance doesn't need to
  // be recreated when callbacks change.
  const handlersRef = useRef({
    onSearch,
    onNavigate,
    onVerify,
    onCommand,
    onUnrecognized,
    onError,
  });
  useEffect(() => {
    handlersRef.current = {
      onSearch,
      onNavigate,
      onVerify,
      onCommand,
      onUnrecognized,
      onError,
    };
  }, [onSearch, onNavigate, onVerify, onCommand, onUnrecognized, onError]);

  /* ----------------------------- Command registry ---------------------------- */

  const commandRegistry = useMemo<Record<VoiceCommandAction, string[]>>(() => {
    const t = i18n.getFixedT(resolvedLang);

    const localized: Record<VoiceCommandAction, string[]> = {
      search: t('voice.commands.search', {
        defaultValue: DEFAULT_COMMANDS.search,
        returnObjects: true,
      }) as unknown as string[],
      navigate: t('voice.commands.navigate', {
        defaultValue: DEFAULT_COMMANDS.navigate,
        returnObjects: true,
      }) as unknown as string[],
      verify: t('voice.commands.verify', {
        defaultValue: DEFAULT_COMMANDS.verify,
        returnObjects: true,
      }) as unknown as string[],
    };

    const dictCommands = Array.isArray(customCommands) ? undefined : customCommands;

    const ensureArray = (value: unknown, fallback: string[]): string[] => {
      if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
      if (typeof value === 'string') return [value];
      return fallback;
    };

    return {
      search: ensureArray(dictCommands?.search ?? localized.search, DEFAULT_COMMANDS.search),
      navigate: ensureArray(
        dictCommands?.navigate ?? localized.navigate,
        DEFAULT_COMMANDS.navigate,
      ),
      verify: ensureArray(dictCommands?.verify ?? localized.verify, DEFAULT_COMMANDS.verify),
    };
  }, [i18n, resolvedLang, customCommands]);

  const customCommandsListRef = useRef<VoiceCommand[]>([]);
  useEffect(() => {
    customCommandsListRef.current = Array.isArray(customCommands) ? customCommands : [];
  }, [customCommands]);

  const commandRegistryRef = useRef(commandRegistry);
  useEffect(() => {
    commandRegistryRef.current = commandRegistry;
  }, [commandRegistry]);

  /* ------------------------------ Speech synthesis --------------------------- */

  const speak = useCallback(
    (message: string) => {
      if (!isSpeechSynthesisSupported || !message) return;
      try {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = resolvedLang;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch {
        // Speech synthesis failures are non-fatal.
      }
    },
    [isSpeechSynthesisSupported, resolvedLang],
  );

  const speakFeedbackRef = useRef(speakFeedback);
  useEffect(() => {
    speakFeedbackRef.current = speakFeedback;
  }, [speakFeedback]);

  const speakRef = useRef(speak);
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);

  /* --------------------------- Permission handling --------------------------- */

  const requestPermission = useCallback(async (): Promise<MicrophonePermissionState> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermissionState('unavailable');
      return 'unavailable';
    }

    // Try the Permissions API first for a non-intrusive check.
    try {
      const permissions = navigator.permissions;
      if (permissions?.query) {
        const status = await permissions.query({
          name: 'microphone' as PermissionName,
        });
        if (status.state === 'granted') {
          setPermissionState('granted');
          return 'granted';
        }
        if (status.state === 'denied') {
          setPermissionState('denied');
          return 'denied';
        }
      }
    } catch {
      // Permissions API may not support 'microphone'; fall through to getUserMedia.
    }

    // Fall back to probing via getUserMedia.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionState('granted');
      return 'granted';
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPermissionState('denied');
        return 'denied';
      }
      if (name === 'NotFoundError' || name === 'NotSupportedError') {
        setPermissionState('unavailable');
        return 'unavailable';
      }
      setPermissionState('denied');
      return 'denied';
    }
  }, []);

  /* ------------------------------ Recognition -------------------------------- */

  const handleResult = useCallback((event: SpeechRecognitionEventLike) => {
    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const alternative = result[0];
      if (!alternative) continue;
      if (result.isFinal) {
        final += alternative.transcript;
      } else {
        interim += alternative.transcript;
      }
    }

    if (interim) {
      setInterimTranscript(interim);
    }

    if (final) {
      const transcript = final.trim();
      setFinalTranscript(transcript);
      setInterimTranscript('');

      if (customCommandsListRef.current.length > 0) {
        const norm = normalize(transcript);
        const customMatch = customCommandsListRef.current.find((cmd) =>
          cmd.phrases.some((p) => norm.includes(normalize(p)))
        );
        if (customMatch) {
          customMatch.handler(transcript);
          if (speakFeedbackRef.current && customMatch.description) {
            speakRef.current(customMatch.description);
          }
          return;
        }
      }

      const match = matchCommand(transcript, commandRegistryRef.current);
      if (match) {
        setLastMatch(match);

        const handlers = handlersRef.current;
        handlers.onCommand?.(match);

        switch (match.action) {
          case 'search':
            handlers.onSearch?.(match.argument ?? '', match);
            if (speakFeedbackRef.current) {
              speakRef.current(
                i18n.getFixedT(resolvedLang)('voice.feedback.search', {
                  defaultValue: 'Searching for {{query}}',
                  query: match.argument ?? '',
                }),
              );
            }
            break;
          case 'navigate':
            handlers.onNavigate?.(match.argument ?? '', match);
            if (speakFeedbackRef.current) {
              speakRef.current(
                i18n.getFixedT(resolvedLang)('voice.feedback.navigate', {
                  defaultValue: 'Navigating to {{target}}',
                  target: match.argument ?? '',
                }),
              );
            }
            break;
          case 'verify':
            handlers.onVerify?.(match);
            if (speakFeedbackRef.current) {
              speakRef.current(
                i18n.getFixedT(resolvedLang)('voice.feedback.verify', {
                  defaultValue: 'Verifying',
                }),
              );
            }
            break;
          default:
            break;
        }
      } else {
        setLastMatch(null);
        handlersRef.current.onUnrecognized?.(transcript);
        if (speakFeedbackRef.current) {
          speakRef.current(
            i18n.getFixedT(resolvedLang)('voice.feedback.unrecognized', {
              defaultValue: 'Command not recognized',
            }),
          );
        }
      }
    }
  }, [i18n, resolvedLang]);

  const handleResultRef = useRef(handleResult);
  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  const createRecognition = useCallback((): SpeechRecognitionLike | null => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return null;

    const recognition = new Ctor();
    recognition.lang = resolvedLang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (!mountedRef.current) return;
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      handleResultRef.current(event);
    };

    recognition.onerror = (event) => {
      if (!mountedRef.current) return;
      const code = event.error;
      // 'no-speech' and 'aborted' are common and non-fatal.
      if (code !== 'no-speech' && code !== 'aborted') {
        setError(code);
        handlersRef.current.onError?.(code);
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setPermissionState('denied');
        shouldListenRef.current = false;
      }
    };

    recognition.onend = () => {
      if (!mountedRef.current) return;
      setIsListening(false);
      setInterimTranscript('');

      // Auto-restart if we're supposed to be continuously listening.
      if (shouldListenRef.current) {
        if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = setTimeout(() => {
          if (!mountedRef.current || !shouldListenRef.current) return;
          try {
            recognition.start();
          } catch {
            // start() can throw if already started; ignore.
          }
        }, 250);
      }
    };

    return recognition;
  }, [resolvedLang, continuous, interimResults]);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError('unsupported');
      handlersRef.current.onError?.('unsupported');
      return;
    }

    // Ensure we have microphone permission before starting.
    if (permissionState !== 'granted') {
      const state = await requestPermission();
      if (state !== 'granted') {
        setError(state === 'denied' ? 'not-allowed' : 'unavailable');
        handlersRef.current.onError?.(state === 'denied' ? 'not-allowed' : 'unavailable');
        return;
      }
    }

    shouldListenRef.current = true;

    if (!recognitionRef.current) {
      recognitionRef.current = createRecognition();
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      setError('unsupported');
      return;
    }

    // Keep configuration in sync with latest options.
    recognition.lang = resolvedLang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    try {
      recognition.start();
    } catch {
      // start() throws if already started; treat as already listening.
      setIsListening(true);
    }
  }, [
    isSupported,
    permissionState,
    requestPermission,
    createRecognition,
    resolvedLang,
    continuous,
    interimResults,
  ]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const toggle = useCallback(async () => {
    if (isListening) {
      stop();
    } else {
      await start();
    }
  }, [isListening, start, stop]);

  const clearError = useCallback(() => setError(null), []);

  /* ------------------------------- Lifecycle --------------------------------- */

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      shouldListenRef.current = false;
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      if (isSpeechSynthesisSupported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [isSpeechSynthesisSupported]);

  // Optionally probe permission state on mount.
  useEffect(() => {
    if (!autoRequestPermission) return;
    void requestPermission();
  }, [autoRequestPermission, requestPermission]);

  // Recreate recognition when language changes so the new grammar is used.
  useEffect(() => {
    if (!recognitionRef.current) return;
    const wasListening = shouldListenRef.current;
    const recognition = recognitionRef.current;
    try {
      recognition.abort();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    if (wasListening) {
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedLang]);

  return {
    isSupported,
    isSpeechSynthesisSupported,
    isListening,
    interimTranscript,
    finalTranscript,
    lastMatch,
    permissionState,
    error,
    lang: resolvedLang,
    commandRegistry,
    start,
    stop,
    toggle,
    requestPermission,
    speak,
    clearError,
  };
}

export default useVoiceCommands;