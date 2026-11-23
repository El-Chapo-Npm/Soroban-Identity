import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Account, Keypair, Networks, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

const DATA_NAME = "soroban-identity-account-link";
const SESSION_TTL_SECONDS = 15 * 60;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const EMAIL_TOKEN_TTL_SECONDS = 30 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export class AccountLinksError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AccountLinksError";
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => {
  throw new AccountLinksError(status, code, message);
};
const base64url = (value) => Buffer.from(value).toString("base64url");
const tokenHash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const accountKey = (address) => address;
const emptyAccount = () => ({ github: null, email: null });

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

async function writePrivateAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const file = await fs.open(tmpPath, "wx", 0o600);
  try {
    await file.writeFile(data, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await fs.rename(tmpPath, filePath);
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Wallet-bound connected account service. Wallet addresses are the primary
 * account IDs: every browser session starts with a short-lived, one-use
 * Stellar ManageData transaction signed by the address owner. No API accepts
 * a caller-selected account ID after that proof.
 *
 * Persistence follows the server's existing file-backed deployment model.
 * Deployments running multiple processes must point all processes at a
 * shared, transaction-capable storage adapter before enabling this feature.
 */
export class AccountLinksService {
  constructor(config, { emailTransport, fetchImpl = fetch, now = Date.now } = {}) {
    this.config = config;
    this.emailTransport = emailTransport;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.filePath = config.accountLinksStorePath ?? path.resolve(process.cwd(), "data", "account-links.json");
    this.data = null;
    this.loadPromise = null;
    this.writeQueue = Promise.resolve();
  }

  get networkPassphrase() {
    return this.config.sorobanNetworkPassphrase ?? this.config.networkPassphrase ??
      (this.config.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET);
  }

  get enabled() {
    return typeof this.config.accountLinksSessionSecret === "string" &&
      Buffer.byteLength(this.config.accountLinksSessionSecret) >= 32;
  }

  get capabilities() {
    return {
      github: Boolean(this.enabled && this.config.githubClientId && this.config.githubClientSecret && this.config.githubRedirectUri),
      email: Boolean(this.enabled && this.emailTransport?.enabled && this.config.accountLinksAppUrl),
    };
  }

  _secret(purpose, value) {
    if (!this.enabled) fail(503, "ACCOUNT_LINKS_DISABLED", "Connected accounts are not configured on this server.");
    return crypto.createHmac("sha256", this.config.accountLinksSessionSecret)
      .update(`${purpose}\0${value}`).digest();
  }

  _signedToken(payload, purpose) {
    const encoded = base64url(JSON.stringify(payload));
    const signature = this._secret(purpose, encoded).toString("base64url");
    return `${encoded}.${signature}`;
  }

  _verifyToken(token, purpose) {
    if (typeof token !== "string" || token.length > 2048) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts;
    let supplied;
    try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
    const expected = this._secret(purpose, encoded);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (!payload || typeof payload !== "object" || Number(payload.exp) <= Math.floor(this.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async _load() {
    if (this.data) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
          this.data = {
            accounts: parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {},
            githubStates: Array.isArray(parsed.githubStates) ? parsed.githubStates : [],
            emailTokens: Array.isArray(parsed.emailTokens) ? parsed.emailTokens : [],
            usedChallenges: Array.isArray(parsed.usedChallenges) ? parsed.usedChallenges : [],
          };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          this.data = { accounts: {}, githubStates: [], emailTokens: [], usedChallenges: [] };
        }
      })();
    }
    await this.loadPromise;
  }

  async _mutate(mutator) {
    await this._load();
    const previous = this.writeQueue;
    let release;
    this.writeQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const draft = structuredClone(this.data);
      const result = await mutator(draft);
      await writePrivateAtomic(this.filePath, `${JSON.stringify(draft, null, 2)}\n`);
      this.data = draft;
      return result;
    } finally {
      release();
    }
  }

  async issueChallenge(address) {
    if (!this.enabled) fail(503, "ACCOUNT_LINKS_DISABLED", "Connected accounts are not configured on this server.");
    if (typeof address !== "string") fail(400, "INVALID_WALLET_ADDRESS", "A valid Stellar public key is required.");
    try { Keypair.fromPublicKey(address); } catch { fail(400, "INVALID_WALLET_ADDRESS", "A valid Stellar public key is required."); }
    const nowSeconds = Math.floor(this.now() / 1000);
    const payload = {
      sub: address,
      jti: crypto.randomBytes(24).toString("base64url"),
      nonce: crypto.randomBytes(32).toString("hex"),
      exp: nowSeconds + CHALLENGE_TTL_SECONDS,
    };
    const challengeId = this._signedToken(payload, "wallet-challenge");
    const value = this._secret("wallet-challenge-data", challengeId).toString("hex");
    const transaction = new TransactionBuilder(new Account(address, "0"), {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    }).addOperation(Operation.manageData({ name: DATA_NAME, value })).setTimeout(120).build();
    return {
      challengeId,
      xdr: transaction.toXDR(),
      networkPassphrase: this.networkPassphrase,
      expiresAt: payload.exp,
    };
  }

  async createSession({ challengeId, signedXdr }) {
    const challenge = this._verifyToken(challengeId, "wallet-challenge");
    if (!challenge || typeof challenge.sub !== "string" || typeof challenge.jti !== "string") {
      fail(401, "INVALID_WALLET_PROOF", "The wallet challenge is invalid or has expired.");
    }
    if (typeof signedXdr !== "string" || signedXdr.length > 16_384) {
      fail(400, "INVALID_WALLET_PROOF", "A signed challenge transaction is required.");
    }
    let transaction;
    try {
      transaction = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    } catch {
      fail(401, "INVALID_WALLET_PROOF", "The signed transaction could not be verified.");
    }
    if (!(transaction instanceof Transaction) || transaction.source !== challenge.sub || transaction.sequence !== "1") {
      fail(401, "INVALID_WALLET_PROOF", "The signed transaction does not match this wallet challenge.");
    }
    const operations = transaction.operations ?? [];
    const expectedValue = this._secret("wallet-challenge-data", challengeId).toString("hex");
    if (operations.length !== 1 || operations[0]?.type !== "manageData" || operations[0]?.name !== DATA_NAME ||
        (operations[0]?.source && operations[0].source !== challenge.sub) ||
        Buffer.from(operations[0]?.value ?? []).toString("utf8") !== expectedValue) {
      fail(401, "INVALID_WALLET_PROOF", "The signed transaction does not match this wallet challenge.");
    }
    const bounds = transaction.timeBounds;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (!bounds || Number(bounds.maxTime) < nowSeconds || Number(bounds.maxTime) > Number(challenge.exp) + 120) {
      fail(401, "INVALID_WALLET_PROOF", "The signed challenge transaction has expired.");
    }
    let validSignature = false;
    const publicKey = Keypair.fromPublicKey(challenge.sub);
    for (const decorated of transaction.signatures ?? []) {
      try {
        if (publicKey.verify(transaction.hash(), Buffer.from(decorated.signature()))) {
          validSignature = true;
          break;
        }
      } catch { /* ignore signatures that are malformed or from another signer */ }
    }
    if (!validSignature) fail(401, "INVALID_WALLET_PROOF", "The wallet signature is invalid.");

    const session = await this._mutate((draft) => {
      const now = Math.floor(this.now() / 1000);
      draft.usedChallenges = draft.usedChallenges.filter((entry) => entry.exp > now);
      if (draft.usedChallenges.some((entry) => entry.jti === challenge.jti)) {
        fail(409, "WALLET_CHALLENGE_REPLAYED", "This wallet challenge has already been used.");
      }
      draft.usedChallenges.push({ jti: challenge.jti, exp: challenge.exp });
      const payload = { sub: challenge.sub, exp: now + SESSION_TTL_SECONDS, jti: crypto.randomBytes(18).toString("base64url") };
      return { token: this._signedToken(payload, "account-session"), expiresAt: new Date(payload.exp * 1000).toISOString() };
    });
    return session;
  }

  authenticate(token) {
    const payload = this._verifyToken(token, "account-session");
    if (!payload || typeof payload.sub !== "string") fail(401, "ACCOUNT_SESSION_INVALID", "Your connected-accounts session is invalid or expired. Sign in with your wallet again.");
    return payload.sub;
  }

  async getLinks(address) {
    await this._load();
    const entry = this.data.accounts[accountKey(address)] ?? emptyAccount();
    return {
      github: entry.github ? { login: entry.github.login, avatarUrl: entry.github.avatarUrl, linkedAt: entry.github.linkedAt } : null,
      email: entry.email ? { email: entry.email.email, verifiedAt: entry.email.verifiedAt } : null,
      capabilities: this.capabilities,
    };
  }

  async beginGithubLink(address) {
    if (!this.capabilities.github) fail(503, "GITHUB_LINKING_UNAVAILABLE", "GitHub account linking is not configured on this server.");
    const state = crypto.randomBytes(32).toString("base64url");
    const stateDigest = tokenHash(state);
    const now = Math.floor(this.now() / 1000);
    await this._mutate((draft) => {
      draft.githubStates = draft.githubStates.filter((entry) => entry.expiresAt > now);
      draft.githubStates.push({ digest: stateDigest, address, expiresAt: now + OAUTH_STATE_TTL_SECONDS });
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.config.githubClientId);
    url.searchParams.set("redirect_uri", this.config.githubRedirectUri);
    url.searchParams.set("scope", "read:user");
    url.searchParams.set("state", state);
    return { authorizationUrl: url.toString() };
  }

  async completeGithubCallback({ code, state }) {
    if (!this.capabilities.github) fail(503, "GITHUB_LINKING_UNAVAILABLE", "GitHub account linking is not configured on this server.");
    if (typeof code !== "string" || code.length < 1 || code.length > 512 || typeof state !== "string" || state.length > 256) {
      fail(400, "INVALID_GITHUB_CALLBACK", "The GitHub callback is invalid or expired. Start linking again.");
    }
    const now = Math.floor(this.now() / 1000);
    const address = await this._mutate((draft) => {
      draft.githubStates = draft.githubStates.filter((entry) => entry.expiresAt > now);
      const index = draft.githubStates.findIndex((entry) => entry.digest === tokenHash(state));
      if (index < 0) fail(400, "INVALID_GITHUB_STATE", "The GitHub link request is invalid or has expired. Start linking again.");
      const [record] = draft.githubStates.splice(index, 1);
      return record.address;
    });

    const tokenResponse = await this.fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.config.githubClientId, client_secret: this.config.githubClientSecret, code, redirect_uri: this.config.githubRedirectUri }),
    });
    let tokenPayload;
    try { tokenPayload = await tokenResponse.json(); } catch { tokenPayload = null; }
    if (!tokenResponse.ok || typeof tokenPayload?.access_token !== "string") {
      fail(502, "GITHUB_TOKEN_EXCHANGE_FAILED", "GitHub could not complete account linking. Start linking again.");
    }
    const userResponse = await this.fetchImpl("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    let user;
    try { user = await userResponse.json(); } catch { user = null; }
    if (!userResponse.ok || (typeof user?.id !== "number" && typeof user?.id !== "string") || typeof user?.login !== "string" || user.login.length > 39) {
      fail(502, "GITHUB_PROFILE_UNAVAILABLE", "GitHub could not verify the account profile. Start linking again.");
    }
    const linkedAt = new Date(this.now()).toISOString();
    const avatarUrl = typeof user.avatar_url === "string" && user.avatar_url.startsWith("https://") ? user.avatar_url : null;
    await this._mutate((draft) => {
      const githubId = String(user.id);
      const linkedElsewhere = Object.entries(draft.accounts).some(([owner, item]) => owner !== address && item.github?.id === githubId);
      if (linkedElsewhere) fail(409, "GITHUB_ACCOUNT_ALREADY_LINKED", "That GitHub account is already linked to another wallet.");
      const item = draft.accounts[address] ?? emptyAccount();
      item.github = { id: githubId, login: user.login, avatarUrl, linkedAt };
      draft.accounts[address] = item;
    });
    return { address, login: user.login };
  }

  async sendEmailVerification(address, email) {
    if (!this.capabilities.email) fail(503, "EMAIL_LINKING_UNAVAILABLE", "Verified email linking is not configured on this server.");
    if (typeof email !== "string" || email.length > 254 || !EMAIL_RE.test(email)) {
      fail(400, "INVALID_EMAIL", "Enter a valid email address.");
    }
    const normalized = email.trim().toLowerCase();
    const token = crypto.randomBytes(32).toString("base64url");
    const digest = tokenHash(token);
    const now = Math.floor(this.now() / 1000);
    const alreadyOwned = await this._mutate((draft) => {
      const owner = Object.entries(draft.accounts).find(([, item]) => item.email?.email?.toLowerCase() === normalized)?.[0];
      if (owner && owner !== address) return true;
      if (owner === address) return true;
      draft.emailTokens = draft.emailTokens.filter((entry) => entry.expiresAt > now && !(entry.address === address && entry.email === normalized));
      draft.emailTokens.push({ digest, address, email: normalized, createdAt: now, expiresAt: now + EMAIL_TOKEN_TTL_SECONDS });
      return false;
    });
    if (alreadyOwned) return { message: "If this address can be verified, a confirmation link will be sent." };

    const link = new URL(this.config.accountLinksAppUrl);
    link.hash = `account_link_token=${encodeURIComponent(token)}`;
    try {
      await this.emailTransport.send({
        to: normalized,
        subject: "Verify your email for Soroban Identity",
        text: `Confirm this email address for your Soroban Identity wallet by opening:\n\n${link.toString()}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore the message.`,
        html: `<p>Confirm this email address for your Soroban Identity wallet.</p><p><a href="${htmlEscape(link.toString())}">Verify email</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore the message.</p>`,
      });
    } catch {
      await this._mutate((draft) => { draft.emailTokens = draft.emailTokens.filter((entry) => entry.digest !== digest); });
      fail(502, "EMAIL_DELIVERY_FAILED", "The verification email could not be sent. Try again later.");
    }
    return { message: "If this address can be verified, a confirmation link will be sent." };
  }

  async confirmEmail(token) {
    if (typeof token !== "string" || token.length > 128) fail(400, "INVALID_EMAIL_TOKEN", "The verification link is invalid or expired.");
    const digest = tokenHash(token);
    const now = Math.floor(this.now() / 1000);
    const address = await this._mutate((draft) => {
      const index = draft.emailTokens.findIndex((entry) => entry.digest === digest && entry.expiresAt > now);
      if (index < 0) {
        draft.emailTokens = draft.emailTokens.filter((entry) => entry.expiresAt > now);
        fail(400, "INVALID_EMAIL_TOKEN", "The verification link is invalid or expired.");
      }
      const [record] = draft.emailTokens.splice(index, 1);
      const existing = Object.entries(draft.accounts).find(([, item]) => item.email?.email?.toLowerCase() === record.email)?.[0];
      if (existing && existing !== record.address) fail(409, "EMAIL_ALREADY_LINKED", "This email address is already linked to another wallet.");
      const item = draft.accounts[record.address] ?? emptyAccount();
      item.email = { email: record.email, verifiedAt: new Date(this.now()).toISOString() };
      draft.accounts[record.address] = item;
      draft.emailTokens = draft.emailTokens.filter((entry) => entry.address !== record.address);
      return record.address;
    });
    return { success: true, address };
  }

  async unlink(address, provider) {
    if (!(["github", "email"].includes(provider))) fail(404, "ACCOUNT_LINK_NOT_FOUND", "The requested connected account was not found.");
    await this._mutate((draft) => {
      const item = draft.accounts[address];
      if (item) {
        item[provider] = null;
        draft.accounts[address] = item;
      }
    });
    return { success: true };
  }
}
