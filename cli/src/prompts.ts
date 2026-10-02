import { input, password, select, confirm } from '@inquirer/prompts';
import { output } from './output';

/**
 * Prompts are only shown on an interactive TTY and never in `--json` or
 * `--no-input` mode; otherwise a missing value is an error.
 */
export const promptState = { enabled: true };

export function canPrompt(): boolean {
  return promptState.enabled && !output.json && Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function missing(name: string, flag: string): never {
  throw new Error(`Missing required value "${name}". Pass ${flag} or run in an interactive terminal.`);
}

export async function askText(
  value: string | undefined,
  opts: { name: string; flag: string; message: string; default?: string; validate?: (v: string) => true | string }
): Promise<string> {
  if (value !== undefined && value !== '') return value;
  if (!canPrompt()) {
    if (opts.default !== undefined) return opts.default;
    missing(opts.name, opts.flag);
  }
  return input({ message: opts.message, default: opts.default, validate: opts.validate });
}

export async function askSecret(
  value: string | undefined,
  opts: { name: string; flag: string; message: string }
): Promise<string> {
  if (value) return value;
  if (!canPrompt()) missing(opts.name, opts.flag);
  return password({ message: opts.message, mask: '*' });
}

export async function askChoice<T extends string>(
  value: string | undefined,
  opts: { name: string; flag: string; message: string; choices: readonly T[]; default?: T }
): Promise<T> {
  if (value !== undefined) {
    if (!opts.choices.includes(value as T)) {
      throw new Error(`Invalid ${opts.name} "${value}". Expected one of: ${opts.choices.join(', ')}`);
    }
    return value as T;
  }
  if (!canPrompt()) {
    if (opts.default !== undefined) return opts.default;
    missing(opts.name, opts.flag);
  }
  return select({
    message: opts.message,
    choices: opts.choices.map((c) => ({ name: c, value: c })),
    default: opts.default,
  });
}

/** Ask for confirmation. Returns `true` without asking when `--yes` was passed or prompts are unavailable. */
export async function askConfirm(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes || !canPrompt()) return true;
  return confirm({ message, default: false });
}
