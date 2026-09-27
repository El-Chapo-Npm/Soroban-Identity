/**
 * Output and exit-code handling for the CLI.
 *
 * Every command has exactly two shapes of output:
 *
 * - `--json`: one JSON object, on stdout when the command succeeded and on
 *   stderr when it failed. Nothing else is printed, so `... --json | jq` works.
 * - human: a short summary on stdout, or `error: <message>` on stderr.
 *
 * Exit codes are part of the interface (documented in cli/README.md):
 * 0 ok · 1 the operation failed · 2 bad usage/arguments · 3 configuration.
 */

export const EXIT_CODES = {
  ok: 0,
  failure: 1,
  usage: 2,
  config: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** An error with a stable machine-readable code and an exit code. */
export class CliFailure extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: unknown;

  constructor(code: string, message: string, exitCode: number = EXIT_CODES.failure, details?: unknown) {
    super(message);
    this.name = "CliFailure";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export interface OutputOptions {
  json?: boolean;
  command?: string;
}

export function printResult(data: unknown, options: OutputOptions = {}): void {
  if (options.json) {
    process.stdout.write(JSON.stringify({ ok: true, command: options.command, data }) + "\n");
    return;
  }
  if (typeof data === "string") {
    process.stdout.write(data + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printError(error: CliFailure, options: OutputOptions = {}): void {
  if (options.json) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        command: options.command,
        error: { code: error.code, message: error.message, details: error.details },
      }) + "\n"
    );
    return;
  }
  process.stderr.write(`error: ${error.message}\n`);
  if (error.details !== undefined) {
    process.stderr.write(`  ${JSON.stringify(error.details)}\n`);
  }
}

/** Turns anything thrown inside a command into a {@link CliFailure}. */
export function toCliFailure(error: unknown): CliFailure {
  if (error instanceof CliFailure) return error;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  const code = (error as { code?: string })?.code;
  return new CliFailure(code && typeof code === "string" ? code : "UNEXPECTED", message);
}
