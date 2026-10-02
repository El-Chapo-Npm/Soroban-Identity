/** Global output settings, set once from the root command's options. */
export const output = { json: false, quiet: false };

/** Print a command result: pretty JSON in `--json` mode, otherwise `human()` text. */
export function printResult(data: unknown, human: () => string): void {
  if (output.json) {
    process.stdout.write(JSON.stringify(data, jsonReplacer, 2) + '\n');
  } else if (!output.quiet) {
    process.stdout.write(human() + '\n');
  }
}

/** Progress/info message. Goes to stderr so it never pollutes `--json` stdout. */
export function info(message: string): void {
  if (!output.quiet && !output.json) process.stderr.write(message + '\n');
}

/** Print an error (as `{ "error": ... }` in JSON mode) and set a failing exit code. */
export function printError(err: unknown): void {
  const e = err as { message?: string; code?: string };
  const message = e?.message ?? String(err);
  if (output.json) {
    process.stdout.write(JSON.stringify({ error: { message, code: e?.code } }, null, 2) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exitCode = 1;
}

/** Format key/value rows as aligned text. */
export function table(rows: [string, unknown][]): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows
    .map(([k, v]) => `${k.padEnd(width)}  ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  return value;
}
