import { Command } from 'commander';
import { CredentialClient } from '@soroban-identity/sdk';
import { toSdkConfig } from '../config';
import { resolveKeypair, validateCredentialId } from '../keys';
import { info, printResult, table } from '../output';
import { askConfirm, askText } from '../prompts';
import { effectiveConfig, type GlobalOptions } from './shared';

export function revokeCommand(): Command {
  return new Command('revoke')
    .description('Revoke a credential you issued')
    .argument('[credentialId]', '64-character hex credential ID')
    .option('-s, --secret-key <secret>', 'issuer secret key (or SOROBAN_SECRET_KEY)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (idArg: string | undefined, opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const config = effectiveConfig(globals);
      const client = new CredentialClient(toSdkConfig(config, ['credentialManagerId']));

      const credentialId = await askText(idArg, {
        name: 'credential ID',
        flag: 'the <credentialId> argument',
        message: 'Credential ID to revoke:',
        validate: validateCredentialId,
      });
      const idCheck = validateCredentialId(credentialId);
      if (idCheck !== true) throw new Error(idCheck);

      const keypair = await resolveKeypair(opts.secretKey);
      if (!(await askConfirm(`Revoke credential ${credentialId}? This cannot be undone.`, opts.yes))) {
        info('Aborted.');
        return;
      }

      info('Submitting revoke_credential transaction...');
      const { data, txHash } = await client.revokeCredential(keypair, credentialId);
      printResult({ credentialId, revokedAt: data.revokedAt, status: data.status, txHash }, () =>
        table([
          ['Credential ID', credentialId],
          ['Status', data.status],
          ['Revoked at', data.revokedAt],
          ['Tx hash', txHash],
        ])
      );
    });
}
