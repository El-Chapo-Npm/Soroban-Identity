import { useState } from "react";
import {
  CONFIRMATION_WORD_COUNT,
  PHRASE_WORD_COUNT,
  fingerprintPhrase,
  generateRecoveryPhrase,
  isConfirmationCorrect,
  normalizePhrase,
  pickConfirmationWords,
  type ConfirmationWord,
} from "../utils/recoveryPhrase";

export const BACKUP_FINGERPRINT_KEY = "soroban-identity:backup-fingerprint";

interface RecoveryPhraseBackupProps {
  onComplete?: (fingerprint: string) => void;
  storageKey?: string;
  /** Injectable source of randomness, used by tests and by the browser default. */
  random?: () => number;
}

type Phase = "intro" | "reveal" | "confirm" | "done";

/**
 * Backup flow for the locally generated identity recovery phrase.
 *
 * The phrase is shown once, then the user must retype three randomly chosen
 * words before the backup is accepted. Only a SHA-256 fingerprint is stored;
 * wallet seed phrases are never requested.
 */
export function RecoveryPhraseBackup({
  onComplete,
  storageKey = BACKUP_FINGERPRINT_KEY,
  random,
}: RecoveryPhraseBackupProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [phrase, setPhrase] = useState("");
  const [questions, setQuestions] = useState<ConfirmationWord[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const begin = () => {
    const next = generateRecoveryPhrase(random);
    setPhrase(next);
    setQuestions(pickConfirmationWords(next, CONFIRMATION_WORD_COUNT, random));
    setAnswers({});
    setAcknowledged(false);
    setError(null);
    setPhase("reveal");
  };

  const confirm = async () => {
    if (!isConfirmationCorrect(phrase, answers, questions)) {
      setError("One or more words do not match. Check your written backup.");
      return;
    }
    const digest = await fingerprintPhrase(phrase);
    try {
      localStorage.setItem(storageKey, digest);
    } catch {
      // Storage can be disabled; completion still applies to this session.
    }
    setFingerprint(digest);
    setError(null);
    setPhase("done");
    onComplete?.(digest);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setError(null);
    } catch {
      setError("Could not copy automatically. Write the words down instead.");
    }
  };

  return (
    <section aria-label="Identity recovery phrase backup" data-testid="recovery-backup">
      <h3>Back up your identity</h3>
      <p>
        This app generates a {PHRASE_WORD_COUNT}-word recovery phrase for your
        identity record. Store it with your exported identity JSON. Soroban
        Identity never asks for your Freighter seed phrase.
      </p>

      {phase === "intro" && (
        <button type="button" onClick={begin} data-testid="backup-begin">
          Generate recovery phrase
        </button>
      )}

      {phase === "reveal" && (
        <>
          <ol data-testid="backup-phrase">
            {normalizePhrase(phrase).split(" ").map((word, index) => (
              <li key={`${index}-${word}`}>{word}</li>
            ))}
          </ol>
          <button type="button" onClick={copy} data-testid="backup-copy">
            Copy phrase
          </button>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              data-testid="backup-acknowledged"
            />
            I have written down all {PHRASE_WORD_COUNT} words.
          </label>
          <button
            type="button"
            disabled={!acknowledged}
            onClick={() => setPhase("confirm")}
            data-testid="backup-continue"
          >
            Continue
          </button>
        </>
      )}

      {phase === "confirm" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <p>Enter the following words from your phrase:</p>
          {questions.map(({ position }) => (
            <label key={position} htmlFor={`backup-word-${position}`}>
              Word #{position}
              <input
                id={`backup-word-${position}`}
                value={answers[position] ?? ""}
                onChange={(event) =>
                  setAnswers((prev) => ({ ...prev, [position]: event.target.value }))
                }
                autoComplete="off"
                data-testid={`backup-answer-${position}`}
              />
            </label>
          ))}
          <button type="submit" data-testid="backup-confirm">
            Confirm backup
          </button>
        </form>
      )}

      {phase === "done" && (
        <p role="status" data-testid="backup-complete">
          Backup confirmed. A fingerprint ({fingerprint?.slice(0, 12)}…) was saved
          on this device; the phrase itself was not stored.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="backup-error">
          {error}
        </p>
      )}
    </section>
  );
}
