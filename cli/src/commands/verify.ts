import { Command } from 'commander';
import { CredentialClient } from '@soroban-identity/sdk';
import { toSdkConfig } from '../config';
import { validateAddress, validateCredentialId } from '../keys';
import { printResult, table } from '../output';
import { askText } from '../prompts';
import { effectiveConfig, type GlobalOptions } from './shared';

export function verifyCommand(): Command {
  return new Command('verify')
    .description('Verify a credential is valid (exists, not revoked, not expired)')
    .argument('[credentialId]', '64-character hex credential ID')
    .option('-a, --account <address>', 'account used to simulate the read (defaults to config defaultAccount)')
    .option('--details', 'also fetch and print the full credential')
    .action(async (idArg: string | undefined, opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const config = effectiveConfig(globals);
      const client = new CredentialClient(toSdkConfig(config, ['credentialManagerId']));

      const credentialId = await askText(idArg, {
        name: 'credential ID',
        flag: 'the <credentialId> argument',
        message: 'Credential ID:',
        validate: validateCredentialId,
      });
      const idCheck = validateCredentialId(credentialId);
      if (idCheck !== true) throw new Error(idCheck);

      const account = await askText(opts.account ?? config.defaultAccount, {
        name: 'account',
        flag: '--account or config defaultAccount',
        message: 'Caller address for the read:',
        validate: validateAddress,
      });

      const result = await client.verifyCredential(account, credentialId);
      const credential = opts.details ? await client.getCredential(account, credentialId) : undefined;
      printResult({ credentialId, ...result, ...(credential ? { credential } : {}) }, () => {
        const rows: [string, unknown][] = [
          ['Credential ID', credentialId],
          ['Valid', result.valid ? 'yes' : 'no'],
        ];
        if (result.reason) rows.push(['Reason', result.reason]);
        if (credential) rows.push(['Credential', credential]);
        return table(rows);
      });
      if (!result.valid) process.exitCode = 2;
    });
}
