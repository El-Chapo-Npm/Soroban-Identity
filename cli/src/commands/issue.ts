import { Command } from 'commander';
import { CredentialClient, hashSubjectClaims, type CredentialType } from '@soroban-identity/sdk';
import { toSdkConfig } from '../config';
import { resolveKeypair, validateAddress } from '../keys';
import { info, printResult, table } from '../output';
import { askChoice, askConfirm, askText, canPrompt } from '../prompts';
import { collectClaim, effectiveConfig, parseExpiry, readJsonObject, type GlobalOptions } from './shared';

const CREDENTIAL_TYPES = ['Kyc', 'Reputation', 'Achievement', 'Custom'] as const;

export function issueCommand(): Command {
  return new Command('issue')
    .description('Issue a verifiable credential to a subject')
    .argument('[subject]', 'subject Stellar address (G...)')
    .option('-t, --type <type>', `credential type (${CREDENTIAL_TYPES.join(', ')})`)
    .option('-c, --claim <key=value>', 'claim entry (repeatable)', collectClaim)
    .option('--claims-file <path>', 'JSON file with claims')
    .option('-e, --expires <when>', 'expiry: 30d, ISO date, Unix seconds, or "never"')
    .option('--schema-id <id>', 'validate claims against a registered schema')
    .option('-s, --secret-key <secret>', 'issuer secret key (or SOROBAN_SECRET_KEY)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (subjectArg: string | undefined, opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const config = effectiveConfig(globals);
      const client = new CredentialClient(toSdkConfig(config, ['credentialManagerId']));

      const subject = await askText(subjectArg, {
        name: 'subject',
        flag: 'the <subject> argument',
        message: 'Subject address:',
        validate: validateAddress,
      });
      const valid = validateAddress(subject);
      if (valid !== true) throw new Error(valid);

      const type = await askChoice<CredentialType>(opts.type, {
        name: 'credential type',
        flag: '--type',
        message: 'Credential type:',
        choices: CREDENTIAL_TYPES,
      });

      const claims: Record<string, string> = {
        ...(opts.claimsFile ? readJsonObject(opts.claimsFile) : {}),
        ...(opts.claim ?? {}),
      };
      if (Object.keys(claims).length === 0 && canPrompt()) {
        info('Enter claims as key=value, blank line to finish.');
        for (;;) {
          const line = await askText(undefined, { name: 'claim', flag: '--claim', message: 'Claim:', default: '' });
          if (!line) break;
          Object.assign(claims, collectClaim(line));
        }
      }
      if (Object.keys(claims).length === 0) throw new Error('At least one claim is required (--claim key=value).');

      const expiresRaw = await askText(opts.expires, {
        name: 'expiry',
        flag: '--expires',
        message: 'Expires (30d, ISO date, or "never"):',
        default: 'never',
      });
      const expiresAt = parseExpiry(expiresRaw);

      const keypair = await resolveKeypair(opts.secretKey);
      const claimsHash = hashSubjectClaims(claims);

      if (!(await askConfirm(`Issue ${type} credential to ${subject}?`, opts.yes))) {
        info('Aborted.');
        return;
      }

      info('Submitting issue_credential transaction...');
      const { data, txHash } = await client.issueCredential(
        keypair,
        subject,
        type,
        claims,
        claimsHash,
        expiresAt,
        opts.schemaId ? { schemaId: opts.schemaId } : undefined
      );
      const result = {
        credentialId: data.credentialId,
        issuer: keypair.publicKey(),
        subject,
        type,
        claims,
        claimsHash,
        expiresAt,
        txHash,
      };
      printResult(result, () =>
        table([
          ['Credential ID', data.credentialId],
          ['Issuer', result.issuer],
          ['Subject', subject],
          ['Type', type],
          ['Expires', expiresAt === 0 ? 'never' : new Date(expiresAt * 1000).toISOString()],
          ['Claims hash', claimsHash],
          ['Tx hash', txHash],
        ])
      );
    });
}
