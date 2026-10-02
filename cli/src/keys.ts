import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { askSecret } from './prompts';

/**
 * Resolve a signing keypair from `--secret-key`, the `SOROBAN_SECRET_KEY`
 * environment variable, or an interactive password prompt. Secret keys are
 * never read from config files.
 */
export async function resolveKeypair(secretFlag: string | undefined): Promise<Keypair> {
  const secret = await askSecret(secretFlag ?? process.env.SOROBAN_SECRET_KEY, {
    name: 'secret key',
    flag: '--secret-key or SOROBAN_SECRET_KEY',
    message: 'Signing secret key (S...):',
  });
  if (!StrKey.isValidEd25519SecretSeed(secret.trim())) {
    throw new Error('Invalid secret key: expected a Stellar secret seed starting with "S".');
  }
  return Keypair.fromSecret(secret.trim());
}

export function validateAddress(value: string): true | string {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)
    ? true
    : 'Expected a Stellar address (G... or C...)';
}

export function validateCredentialId(value: string): true | string {
  return /^[0-9a-fA-F]{64}$/.test(value) ? true : 'Expected a 64-character hex credential ID';
}
