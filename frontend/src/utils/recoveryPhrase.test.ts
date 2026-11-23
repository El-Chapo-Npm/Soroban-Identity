/** Recovery phrase generation and confirmation (issue #1256). */
import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_WORD_COUNT,
  PHRASE_WORD_COUNT,
  fingerprintPhrase,
  generateRecoveryPhrase,
  isConfirmationCorrect,
  normalizePhrase,
  pickConfirmationWords,
} from "./recoveryPhrase";

describe("recoveryPhrase (#1256)", () => {
  it("generates a deterministic 12-word phrase from injected randomness", () => {
    const phrase = generateRecoveryPhrase(() => 0);
    expect(phrase.split(" ")).toHaveLength(PHRASE_WORD_COUNT);
    expect(phrase).not.toMatch(/^\s|\s$/);
    expect(generateRecoveryPhrase(() => 0)).toBe(phrase);
  });

  it("picks three distinct positions and validates the answers", () => {
    const phrase = generateRecoveryPhrase(() => 0.42);
    const words = normalizePhrase(phrase).split(" ");
    let seed = 0;
    const questions = pickConfirmationWords(
      phrase,
      CONFIRMATION_WORD_COUNT,
      () => ((seed++ * 7) % 12 + 0.5) / 12,
    );

    expect(questions).toHaveLength(3);
    expect(new Set(questions.map((q) => q.position)).size).toBe(3);
    expect(questions.every((q) => q.word === words[q.position - 1])).toBe(true);

    const answers = Object.fromEntries(questions.map((q) => [q.position, q.word]));
    expect(isConfirmationCorrect(phrase, answers, questions)).toBe(true);
    expect(
      isConfirmationCorrect(phrase, { ...answers, [questions[0].position]: "wrong" }, questions),
    ).toBe(false);
    expect(isConfirmationCorrect(phrase, {}, questions)).toBe(false);
  });

  it("normalizes whitespace and case before comparing", () => {
    expect(normalizePhrase("  Alpha   BETA\nGamma ")).toBe("alpha beta gamma");
    const questions = [{ position: 2, word: "beta" }];
    expect(isConfirmationCorrect("alpha BETA gamma", { 2: "  BeTa " }, questions)).toBe(true);
  });

  it("fingerprints a phrase one way without exposing it", async () => {
    const phrase = "alpha beta gamma";
    const first = await fingerprintPhrase(phrase);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await fingerprintPhrase("  ALPHA  BETA gamma ")).toBe(first);
    expect(await fingerprintPhrase("alpha beta delta")).not.toBe(first);
    expect(first).not.toContain("alpha");
  });
});
