import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// Prompt only for values not supplied as flags.
export async function ask(value, question, { secret = false } = {}) {
  if (value) return value;
  if (!stdin.isTTY) throw new Error(`Missing required value: ${question}`);
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  if (secret) rl._writeToOutput = (s) => stdout.write(s.includes(question) ? s : '');
  try {
    return (await rl.question(`${question}: `)).trim();
  } finally {
    rl.close();
    if (secret) stdout.write('\n');
  }
}
