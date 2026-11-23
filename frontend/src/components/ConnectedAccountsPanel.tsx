import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { WalletState } from "../hooks/useWallet";
import "./ConnectedAccountsPanel.css";

type LinkedAccounts = {
  github: null | { login: string; avatarUrl: string | null; linkedAt?: string };
  email: null | { email: string; verifiedAt: string };
  capabilities: { github: boolean; email: boolean };
};
type Props = {
  wallet: Pick<WalletState, "connected" | "publicKey" | "networkPassphrase"> & {
    signTransaction: (xdr: string) => Promise<string>;
  };
};
const API_BASE = import.meta.env.VITE_API_URL ?? "";

export default function ConnectedAccountsPanel({ wallet }: Props) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<LinkedAccounts | null>(null);
  const [session, setSession] = useState<{
    token: string;
    expiresAt: string;
    address: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const popup = useRef<Window | null>(null);
  const walletAddress = useRef(wallet.publicKey);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const activeSession =
    wallet.connected && wallet.publicKey && session?.address === wallet.publicKey ? session : null;

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> => {
      const headers = new Headers(init.headers);
      if (init.body) headers.set("Content-Type", "application/json");
      if (authenticated && activeSession?.token)
        headers.set("Authorization", `Bearer ${activeSession.token}`);
      const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
      if (!response.ok) {
        if (response.status === 401 && authenticated) {
          setSession(null);
          setAccounts(null);
        }
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
      }
      return response.json() as Promise<T>;
    },
    [activeSession]
  );

  const refresh = useCallback(async () => {
    if (!activeSession) return;
    setBusy("load");
    setError(null);
    try {
      setAccounts(await request<LinkedAccounts>("/account-links"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("accounts.error"));
    } finally {
      setBusy(null);
    }
  }, [request, activeSession, t]);

  useEffect(() => {
    if (activeSession) void refresh();
  }, [activeSession, refresh]);
  useEffect(() => {
    if (!wallet.connected || walletAddress.current !== wallet.publicKey) {
      walletAddress.current = wallet.publicKey;
      setSession(null);
      setAccounts(null);
      setError(null);
      setNotice(null);
      popup.current?.close();
      popup.current = null;
    }
  }, [wallet.connected, wallet.publicKey]);
  useEffect(() => {
    const readToken = () => {
      const match = window.location.hash.match(/(?:^#|&)account_link_token=([^&]*)/);
      if (match) setPendingToken(decodeURIComponent(match[1]));
    };
    readToken();
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);

  const authenticate = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      setError(t("accounts.connectWallet"));
      return;
    }
    setBusy("auth");
    setError(null);
    setNotice(null);
    try {
      const address = wallet.publicKey;
      if (!address) throw new Error(t("accounts.connectWallet"));
      const challenge = await request<{
        challengeId: string;
        xdr: string;
        networkPassphrase: string;
      }>(`/account-links/challenge?address=${encodeURIComponent(address)}`, {}, false);
      if (!wallet.networkPassphrase || challenge.networkPassphrase !== wallet.networkPassphrase) {
        throw new Error(t("accounts.networkMismatch"));
      }
      // Signing is deliberately initiated only by this user-triggered button.
      const signedXdr = await wallet.signTransaction(challenge.xdr);
      const currentWallet = walletRef.current;
      if (
        !currentWallet.connected ||
        currentWallet.publicKey !== address ||
        currentWallet.networkPassphrase !== challenge.networkPassphrase
      ) {
        throw new Error(t("accounts.walletChanged"));
      }
      const created = await request<{ token: string; expiresAt: string }>(
        "/account-links/session",
        { method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, signedXdr }) },
        false
      );
      if (!walletRef.current.connected || walletRef.current.publicKey !== address) {
        throw new Error(t("accounts.walletChanged"));
      }
      setSession({ ...created, address });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("accounts.error"));
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (provider: "github" | "email") => {
    if (!window.confirm(t("accounts.unlinkConfirm", { provider: t(`accounts.${provider}`) })))
      return;
    setBusy(`unlink-${provider}`);
    setError(null);
    setNotice(null);
    try {
      await request(`/account-links/${provider}`, { method: "DELETE" });
      await refresh();
      setNotice(t("accounts.unlinked"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("accounts.error"));
    } finally {
      setBusy(null);
    }
  };

  const startGithub = async () => {
    setBusy("github");
    setError(null);
    setNotice(null);
    setPopupBlocked(false);
    // Open synchronously from the click to avoid popup blockers; navigate once URL arrives.
    popup.current = window.open(
      "about:blank",
      "account-link-github",
      "width=600,height=720,noopener=false"
    );
    if (!popup.current) setPopupBlocked(true);
    try {
      const { authorizationUrl } = await request<{ authorizationUrl: string }>(
        "/account-links/github/start",
        { method: "POST", body: "{}" }
      );
      if (popup.current && !popup.current.closed) popup.current.location.href = authorizationUrl;
      const started = Date.now();
      const timer = window.setInterval(async () => {
        if (Date.now() - started > 120_000 || popup.current?.closed) {
          window.clearInterval(timer);
          setBusy(null);
          return;
        }
        try {
          const latest = await request<LinkedAccounts>("/account-links");
          if (latest.github) {
            setAccounts(latest);
            window.clearInterval(timer);
            setBusy(null);
            setNotice(t("accounts.githubLinked"));
            popup.current?.close();
          }
        } catch {
          /* transient polling failures do not end authorization */
        }
      }, 2000);
    } catch (e) {
      popup.current?.close();
      setError(e instanceof Error ? e.message : t("accounts.error"));
      setBusy(null);
    }
  };

  const sendEmail = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("email");
    setError(null);
    setNotice(null);
    try {
      await request("/account-links/email", { method: "POST", body: JSON.stringify({ email }) });
      setNotice(t("accounts.emailSent"));
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("accounts.error"));
    } finally {
      setBusy(null);
    }
  };

  const confirmEmail = async () => {
    if (!pendingToken) return;
    setBusy("confirm");
    setError(null);
    setNotice(null);
    try {
      await request<{ success: true }>(
        "/account-links/email/confirm",
        { method: "POST", body: JSON.stringify({ token: pendingToken }) },
        false
      );
      setPendingToken(null);
      const url = new URL(window.location.href);
      url.hash = "";
      window.history.replaceState({}, "", url);
      setNotice(t("accounts.emailConfirmed"));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("accounts.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="connected-accounts" aria-labelledby="accounts-heading">
      <header>
        <h2 id="accounts-heading">{t("accounts.title")}</h2>
        <p>{t("accounts.description")}</p>
      </header>
      {!wallet.connected ? (
        <div className="accounts-message" role="status">
          {t("accounts.connectWallet")}
        </div>
      ) : !activeSession ? (
        <div className="accounts-message">
          <p>{t("accounts.authenticateDescription")}</p>
          <button type="button" onClick={() => void authenticate()} disabled={busy === "auth"}>
            {busy === "auth" ? t("accounts.authenticating") : t("accounts.authenticate")}
          </button>
        </div>
      ) : (
        <>
          {busy === "load" && <p role="status">{t("accounts.loading")}</p>}
          {accounts && (
            <div className="account-list">
              <article className="account-card">
                <div>
                  <h3>{t("accounts.github")}</h3>
                  {accounts.github ? (
                    <p className="account-linked">
                      {accounts.github.avatarUrl && (
                        <img src={accounts.github.avatarUrl} alt="" referrerPolicy="no-referrer" />
                      )}
                      <span>{t("accounts.linkedAs", { account: accounts.github.login })}</span>
                    </p>
                  ) : (
                    <p>{t("accounts.notLinked")}</p>
                  )}
                </div>
                {accounts.github ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void unlink("github")}
                    disabled={busy === "unlink-github"}
                  >
                    {t("accounts.unlink")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startGithub()}
                    disabled={!accounts.capabilities.github || !!busy}
                  >
                    {busy === "github" ? t("accounts.openingGithub") : t("accounts.linkGithub")}
                  </button>
                )}
              </article>
              <article className="account-card">
                <div>
                  <h3>{t("accounts.email")}</h3>
                  {accounts.email ? (
                    <p>
                      {accounts.email.email}{" "}
                      <span className="verified">{t("accounts.verified")}</span>
                    </p>
                  ) : (
                    <>
                      <p>{t("accounts.notLinked")}</p>
                      <form onSubmit={sendEmail}>
                        <label htmlFor="account-email">{t("accounts.emailLabel")}</label>
                        <div className="email-form">
                          <input
                            id="account-email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                          />
                          <button type="submit" disabled={!accounts.capabilities.email || !!busy}>
                            {busy === "email"
                              ? t("accounts.sending")
                              : t("accounts.sendVerification")}
                          </button>
                        </div>
                      </form>
                    </>
                  )}
                </div>
                {accounts.email && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void unlink("email")}
                    disabled={busy === "unlink-email"}
                  >
                    {t("accounts.unlink")}
                  </button>
                )}
              </article>
            </div>
          )}
        </>
      )}
      {pendingToken && (
        <div className="accounts-confirm" role="group" aria-label={t("accounts.confirmEmail")}>
          <p>{t("accounts.confirmDescription")}</p>
          <button type="button" onClick={() => void confirmEmail()} disabled={busy === "confirm"}>
            {busy === "confirm" ? t("accounts.confirming") : t("accounts.confirmEmail")}
          </button>
          <button type="button" className="secondary" onClick={() => setPendingToken(null)}>
            {t("accounts.dismiss")}
          </button>
        </div>
      )}
      {popupBlocked && (
        <p className="accounts-hint" role="status">
          {t("accounts.popupBlocked")}
        </p>
      )}
      {error && (
        <p className="accounts-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="accounts-success" role="status">
          {notice}
        </p>
      )}
      {activeSession && (
        <p className="accounts-hint">
          {t("accounts.sessionExpiry", {
            expiry: new Date(activeSession.expiresAt).toLocaleString(),
          })}
        </p>
      )}
    </section>
  );
}
