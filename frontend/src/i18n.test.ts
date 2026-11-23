import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import i18n, { getInitialLocale, setLocale } from "./i18n";

afterEach(() => {
  setLocale("en");
  window.localStorage.clear();
});

describe("English and French localization", () => {
  it("switches translated content and persists the selected locale", async () => {
    setLocale("en");
    await waitFor(() => expect(i18n.language).toBe("en"));
    expect(i18n.t("app.subtitle")).toBe("Decentralized Identity for a Trustless World");

    setLocale("fr");
    await waitFor(() => expect(i18n.language).toBe("fr"));
    expect(i18n.t("app.subtitle")).toBe("Identité Décentralisée pour un Monde sans Confiance");
    expect(window.localStorage.getItem("lang")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("uses English when the saved locale is unsupported", () => {
    window.localStorage.setItem("lang", "xx");
    expect(getInitialLocale()).toBe("en");
  });

  it("falls back to English when asked to select an unsupported locale", async () => {
    setLocale("xx");
    await waitFor(() => expect(i18n.language).toBe("en"));
    expect(window.localStorage.getItem("lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(i18n.t("app.subtitle")).toBe("Decentralized Identity for a Trustless World");
  });
});
