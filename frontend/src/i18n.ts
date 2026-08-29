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
  resources: SUPPORTED_LOCALES,
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

export default i18n;
