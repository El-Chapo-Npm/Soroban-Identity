import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import zh from "./locales/zh.json";

const SUPPORTED_LOCALES: Record<string, object> = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  zh: { translation: zh },
};

/**
 * BCP-47 language tags used by the Web Speech API for each supported locale.
 * These may differ from the i18n locale keys (e.g. region-specific variants).
 */
const SPEECH_LANGUAGE_MAP: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  zh: "zh-CN",
};

/** Fallback speech recognition language when the active locale is unknown. */
const DEFAULT_SPEECH_LANGUAGE = "en-US";

/** Locales that use right-to-left text direction. */
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

const STORAGE_KEY = "lang";

// Development warning for missing translation keys
const missingKeyHandler = (lngs: readonly string[], ns: string, key: string) => {
  if (process.env.NODE_ENV === "development") {
    console.warn(`[i18n] Missing key '${key}' in locale '${lngs.join(", ")}', falling back to 'en'`);
  }
};

i18n.use(initReactI18next).init({
  resources: SUPPORTED_LOCALES as any,
  lng: localStorage.getItem(STORAGE_KEY) ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  saveMissing: process.env.NODE_ENV === "development",
  missingKeyHandler,
  parseMissingKeyHandler: (key: string) => {
    // Return the key itself; i18next will fall back to the English value.
    return key;
  },
});

/**
 * Apply or remove the `dir="rtl"` attribute on `<html>` so that RTL
 * languages (Arabic, Hebrew, …) render correctly out of the box.
 */
function applyDocumentDirection(locale: string): void {
  const isRtl = RTL_LOCALES.has(locale);
  document.documentElement.setAttribute("dir", isRtl ? "rtl" : "ltr");
  document.documentElement.setAttribute("lang", locale);
}

// Apply direction for the initial locale on load.
applyDocumentDirection(i18n.language);

export function setLocale(locale: string): void {
  const resolved = SUPPORTED_LOCALES[locale] ? locale : "en";
  localStorage.setItem(STORAGE_KEY, resolved);
  i18n.changeLanguage(resolved);
  applyDocumentDirection(resolved);
}

/**
 * Resolve the BCP-47 language tag the Web Speech API should use for the
 * currently active i18n locale. Falls back to the base language code and
 * finally to {@link DEFAULT_SPEECH_LANGUAGE} when nothing matches.
 */
export function getSpeechRecognitionLanguage(locale?: string): string {
  const active = locale ?? i18n.language ?? "en";
  if (SPEECH_LANGUAGE_MAP[active]) {
    return SPEECH_LANGUAGE_MAP[active];
  }
  const base = active.split("-")[0];
  return SPEECH_LANGUAGE_MAP[base] ?? DEFAULT_SPEECH_LANGUAGE;
}

/** List of BCP-47 language tags supported for voice commands. */
export function getSupportedSpeechLanguages(): string[] {
  return Object.values(SPEECH_LANGUAGE_MAP);
}

export default i18n;
