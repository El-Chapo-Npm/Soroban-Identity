#!/usr/bin/env node
import crypto from 'node:crypto';
import { Command } from 'commander';
import { Keypair } from '@stellar/stellar-sdk';
import { IdentityClient, CredentialClient } from '@soroban-identity/sdk';
import { loadConfig } from '../src/config.js';
import { ask } from '../src/prompt.js';

const program = new Command();
program
  .name('soroban-id')
  .description('Manage Soroban Identity DIDs and credentials')
  .version('0.1.0')
  .option('-c, --config <file>', 'config file with RPC endpoints and contract IDs')
  .option('--json', 'machine-readable JSON output');

function output(data, human) {
  if (program.opts().json) console.log(JSON.stringify(data, null, 2));
  else console.log(human ?? data);
}

const secretKey = (opt) => ask(opt ?? process.env.SOROBAN_SECRET_KEY, 'Secret key', { secret: true });

function action(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      if (program.opts().json) console.error(JSON.stringify({ error: error.message }));
      else console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    }
  };
}

program
  .command('create-did')
  .description('Register a DID for the signing account')
  .option('-s, --secret <key>', 'signer secret key (or SOROBAN_SECRET_KEY)')
  .option('-m, --metadata <json>', 'DID metadata as JSON object', '{}')
  .action(action(async (opts) => {
    const client = new IdentityClient(loadConfig(program.opts().config));
    const res = await client.createDid(Keypair.fromSecret(await secretKey(opts.secret)), JSON.parse(opts.metadata));
    output(res, `Created DID: ${res.result?.did ?? JSON.stringify(res)}`);
  }));

program
  .command('issue-credential')
  .description('Issue a credential to a subject')
  .option('-s, --secret <key>', 'issuer secret key (or SOROBAN_SECRET_KEY)')
  .option('--subject <address>', 'subject Stellar address')
  .option('--type <type>', 'credential type')
  .option('--claims <json>', 'claims JSON object')
  .option('--expires <unix>', 'expiry timestamp (0 = never)', '0')
  .action(action(async (opts) => {
    const client = new CredentialClient(loadConfig(program.opts().config));
    const subject = await ask(opts.subject, 'Subject address');
    const type = await ask(opts.type, 'Credential type');
    const claims = JSON.parse(await ask(opts.claims, 'Claims JSON'));
    const hash = crypto.createHash('sha256').update(JSON.stringify(claims)).digest('hex');
    const res = await client.issueCredential(Keypair.fromSecret(await secretKey(opts.secret)), subject, type, claims, hash, Number(opts.expires));
    output(res, `Issued credential: ${res.result?.credentialId ?? JSON.stringify(res)}`);
  }));

program
  .command('verify <credentialId>')
  .description('Verify a credential')
  .option('--caller <address>', 'caller Stellar address')
  .action(action(async (credentialId, opts) => {
    const client = new CredentialClient(loadConfig(program.opts().config));
    const res = await client.verifyCredential(await ask(opts.caller, 'Caller address'), credentialId);
    output(res, JSON.stringify(res, null, 2));
  }));

program
  .command('revoke <credentialId>')
  .description('Revoke a credential')
  .option('-s, --secret <key>', 'issuer secret key (or SOROBAN_SECRET_KEY)')
  .action(action(async (credentialId, opts) => {
    const client = new CredentialClient(loadConfig(program.opts().config));
    const res = await client.revokeCredential(Keypair.fromSecret(await secretKey(opts.secret)), credentialId);
    output(res, `Revoked credential ${credentialId}`);
  }));

program.parseAsync();
