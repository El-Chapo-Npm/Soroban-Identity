import { Command } from 'commander';
import { IdentityClient } from '@soroban-identity/sdk';
import { toSdkConfig } from '../config';
import { resolveKeypair } from '../keys';
import { info, printResult, table } from '../output';
import { askConfirm, askText, canPrompt } from '../prompts';
import { collectMeta, effectiveConfig, readJsonObject, type GlobalOptions } from './shared';

export function createDidCommand(): Command {
  return new Command('create-did')
    .description('Register a new DID controlled by the signing account')
    .option('-s, --secret-key <secret>', 'controller secret key (or SOROBAN_SECRET_KEY)')
    .option('-m, --meta <key=value>', 'DID document metadata entry (repeatable)', collectMeta)
    .option('--meta-file <path>', 'JSON file with DID document metadata')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const config = effectiveConfig(globals);
      const client = new IdentityClient(toSdkConfig(config, ['identityRegistryId']));
      const keypair = await resolveKeypair(opts.secretKey);

      let metadata: Record<string, string> = {
        ...(opts.metaFile ? readJsonObject(opts.metaFile) : {}),
        ...(opts.meta ?? {}),
      };
      if (Object.keys(metadata).length === 0 && canPrompt()) {
        const name = await askText(undefined, { name: 'name', flag: '--meta', message: 'Display name (optional):', default: '' });
        if (name) metadata = { name };
      }

      if (!(await askConfirm(`Create DID for ${keypair.publicKey()}?`, opts.yes))) {
        info('Aborted.');
        return;
      }

      info('Submitting create_did transaction...');
      const { data, txHash } = await client.createDid(keypair, metadata);
      printResult({ ...data, controller: keypair.publicKey(), txHash }, () =>
        table([
          ['DID', data.did],
          ['Controller', keypair.publicKey()],
          ['Tx hash', txHash],
        ])
      );
    });
}
