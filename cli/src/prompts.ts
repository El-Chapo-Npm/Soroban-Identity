/**
 * Interactive prompts.
 *
 * Prompts are only ever used when a required value is missing *and* stdin is a
 * TTY. With `--yes`, in a pipe, or in CI a missing value is an error instead, so
 * a script can never hang on a question nobody can answer.
 */

import * as readline from "node:readline/promises";
import { CliFailure, EXIT_CODES } from "./output";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export interface AskOptions {
  /** `--yes`: never prompt. */
  yes?: boolean;
  /** Value that came from a flag/env — returned as-is when present. */
  provided?: string;
  /** What to ask for when nothing was provided. */
  question: string;
  /** Error code used when prompting is not possible. */
  code: string;
  /** Set for secrets: input is not echoed. */
  secret?: boolean;
}

export async function askValue(options: AskOptions): Promise<string> {
  // `provided` comes from Commander, where a repeatable option yields an array
  // and an absent one yields `undefined` — only accept a real string here.
  const provided = typeof options.provided === "string" ? options.provided.trim() : undefined;
  if (provided) return provided;

  if (options.yes || !isInteractive()) {
    throw new CliFailure(
      options.code,
      `${options.question.replace(/\?\s*$/, "")} is required — pass it as a flag, set the matching environment variable, or run interactively.`,
      EXIT_CODES.usage
    );
  }

  const answer = options.secret ? await questionHidden(options.question) : await questionText(options.question);
  const trimmed = answer.trim();
  if (!trimmed) {
    throw new CliFailure(options.code, `${options.question} — empty value`, EXIT_CODES.usage);
  }
  return trimmed;
}

export async function questionText(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`${question} `);
  } finally {
    rl.close();
  }
}

export async function questionHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Keep the answer off the screen and out of the scrollback.
  const mute = () => {
    (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => undefined;
  };
  process.stdout.write(`${question} `);
  mute();
  try {
    const answer = await rl.question("");
    process.stdout.write("\n");
    return answer;
  } finally {
    rl.close();
  }
}
