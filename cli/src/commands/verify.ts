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
    .option('--oracle-feed <id>', 'oracle data feed ID to request off-chain verification data from')
    .option('--max-staleness <seconds>', 'maximum acceptable oracle response age in seconds', parseInt)
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

      let oracle: { feedId: string; data?: unknown; fresh?: boolean; error?: string } | undefined;
      if (opts.oracleFeed) {
        const feedId = String(opts.oracleFeed);
        try {
          const response = await client.requestOffchainData(account, feedId, credentialId);
          const fresh =
            opts.maxStaleness !== undefined
              ? await client.isResponseFresh(account, feedId, response, opts.maxStaleness)
              : undefined;
          oracle = { feedId, data: response, fresh };
        } catch (err) {
          oracle = { feedId, error: err instanceof Error ? err.message : String(err) };
        }
      }

      printResult(
        { credentialId, ...result, ...(credential ? { credential } : {}), ...(oracle ? { oracle } : {}) },
        () => {
          const rows: [string, unknown][] = [
            ['Credential ID', credentialId],
            ['Valid', result.valid ? 'yes' : 'no'],
          ];
          if (result.reason) rows.push(['Reason', result.reason]);
          if (credential) rows.push(['Credential', credential]);
          if (oracle) {
            rows.push(['Oracle feed', oracle.feedId]);
            if (oracle.error) rows.push(['Oracle error', oracle.error]);
            if (oracle.data !== undefined) rows.push(['Oracle data', oracle.data]);
            if (oracle.fresh !== undefined) rows.push(['Oracle fresh', oracle.fresh ? 'yes' : 'no']);
          }
          return table(rows);
        },
      );
      if (!result.valid) process.exitCode = 2;
      if (oracle && (oracle.error || oracle.fresh === false)) process.exitCode = 2;
    });
}
