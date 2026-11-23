import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { AccountLinksError, AccountLinksService } from "../src/account-links.js";

const SESSION_SECRET = "test-account-link-secret-which-is-at-least-32-bytes";

async function makeFixture({ now = () => Date.now(), fetchImpl, emailTransport } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "soroban-account-links-"));
  const filePath = path.join(dir, "links.json");
  const sent = [];
  const mailer = emailTransport ?? {
    enabled: true,
    async send(message) { sent.push(message); return { status: 202 }; },
  };
  const service = new AccountLinksService({
    accountLinksSessionSecret: SESSION_SECRET,
    accountLinksStorePath: filePath,
    accountLinksAppUrl: "https://identity.example/app",
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    githubRedirectUri: "https://identity.example/account-links/github/callback",
    network: "testnet",
    ...((emailTransport === null) ? {} : {}),
  }, {
    emailTransport: mailer,
    fetchImpl: fetchImpl ?? (async () => ({ ok: true, json: async () => ({ access_token: "test-access-token" }) })),
    now,
  });
  return { service, filePath, dir, sent, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

async function signedChallenge(service, keypair) {
  const challenge = await service.issueChallenge(keypair.publicKey());
  const transaction = TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET);
  transaction.sign(keypair);
  return { challenge, signedXdr: transaction.toXDR() };
}

function expectAccountLinksError(promise, status, code) {
  return assert.rejects(promise, (error) => {
    assert.ok(error instanceof AccountLinksError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("wallet-signed challenge creates a short-lived session and cannot be replayed", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const keypair = Keypair.random();
  const { challenge, signedXdr } = await signedChallenge(fixture.service, keypair);

  const session = await fixture.service.createSession({ challengeId: challenge.challengeId, signedXdr });
  assert.equal(fixture.service.authenticate(session.token), keypair.publicKey());
  assert.ok(Date.parse(session.expiresAt) > Date.now());
  await expectAccountLinksError(
    fixture.service.createSession({ challengeId: challenge.challengeId, signedXdr }),
    409,
    "WALLET_CHALLENGE_REPLAYED",
  );
});

test("wallet proof rejects a transaction signed by a different key", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const owner = Keypair.random();
  const attacker = Keypair.random();
  const challenge = await fixture.service.issueChallenge(owner.publicKey());
  const transaction = TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET);
  transaction.sign(attacker);

  await expectAccountLinksError(
    fixture.service.createSession({ challengeId: challenge.challengeId, signedXdr: transaction.toXDR() }),
    401,
    "INVALID_WALLET_PROOF",
  );
});

test("concurrent submissions consume a wallet challenge only once", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const keypair = Keypair.random();
  const { challenge, signedXdr } = await signedChallenge(fixture.service, keypair);
  const outcomes = await Promise.allSettled([
    fixture.service.createSession({ challengeId: challenge.challengeId, signedXdr }),
    fixture.service.createSession({ challengeId: challenge.challengeId, signedXdr }),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "WALLET_CHALLENGE_REPLAYED");
});

test("GitHub linking consumes OAuth state and prevents linking one GitHub ID to two wallets", async (t) => {
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push(String(url));
    if (String(url).includes("access_token")) return { ok: true, json: async () => ({ access_token: "temporary-token" }) };
    return { ok: true, json: async () => ({ id: 7319, login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" }) };
  };
  const fixture = await makeFixture({ fetchImpl });
  t.after(fixture.cleanup);

  const owner = Keypair.random();
  const { authorizationUrl } = await fixture.service.beginGithubLink(owner.publicKey());
  const state = new URL(authorizationUrl).searchParams.get("state");
  assert.ok(state);
  const storedBefore = await fs.readFile(fixture.filePath, "utf8");
  assert.equal(storedBefore.includes(state), false);
  const result = await fixture.service.completeGithubCallback({ code: "one-use-code", state });
  assert.equal(result.address, owner.publicKey());
  assert.equal(result.login, "octocat");
  assert.equal((await fixture.service.getLinks(owner.publicKey())).github.login, "octocat");
  assert.deepEqual(fetchCalls, ["https://github.com/login/oauth/access_token", "https://api.github.com/user"]);
  await expectAccountLinksError(
    fixture.service.completeGithubCallback({ code: "replay", state }),
    400,
    "INVALID_GITHUB_STATE",
  );

  const other = Keypair.random();
  const second = await fixture.service.beginGithubLink(other.publicKey());
  await expectAccountLinksError(
    fixture.service.completeGithubCallback({ code: "second-code", state: new URL(second.authorizationUrl).searchParams.get("state") }),
    409,
    "GITHUB_ACCOUNT_ALREADY_LINKED",
  );
});

test("verified email tokens are stored as hashes and consumed once", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const owner = Keypair.random();
  const response = await fixture.service.sendEmailVerification(owner.publicKey(), "Alice@example.com");
  assert.match(response.message, /confirmation link/);
  assert.equal(fixture.sent.length, 1);
  const href = fixture.sent[0].html.match(/href="([^"]+)"/)[1];
  const url = new URL(href);
  const token = new URLSearchParams(url.hash.slice(1)).get("account_link_token");
  assert.ok(token);
  const stored = await fs.readFile(fixture.filePath, "utf8");
  assert.equal(stored.includes(token), false);
  assert.equal(stored.includes("alice@example.com"), true);

  assert.deepEqual(await fixture.service.confirmEmail(token), { success: true, address: owner.publicKey() });
  assert.deepEqual((await fixture.service.getLinks(owner.publicKey())).email.email, "alice@example.com");
  await expectAccountLinksError(fixture.service.confirmEmail(token), 400, "INVALID_EMAIL_TOKEN");
});

test("email address ownership is unique and confirmation cannot be replayed by another wallet", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const first = Keypair.random();
  const second = Keypair.random();
  await fixture.service.sendEmailVerification(first.publicKey(), "owner@example.com");
  const link = fixture.sent[0].html.match(/href="([^"]+)"/)[1];
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("account_link_token");
  await fixture.service.confirmEmail(token);
  const result = await fixture.service.sendEmailVerification(second.publicKey(), "OWNER@example.com");
  assert.match(result.message, /confirmation link/);
  assert.equal(fixture.sent.length, 1);
  assert.equal((await fixture.service.getLinks(second.publicKey())).email, null);
});

test("invalid wallet address is rejected before a challenge can be issued", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  await expectAccountLinksError(fixture.service.issueChallenge("not-a-stellar-key"), 400, "INVALID_WALLET_ADDRESS");
});
