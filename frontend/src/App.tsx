import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SorobanRpc } from "@stellar/stellar-sdk";
import LoadingFallback from "./components/LoadingFallback";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import { useKeyboardShortcuts, useSequentialShortcuts } from "./hooks/useKeyboardShortcuts";
import { useKeyboardShortcutsContext } from "./context/KeyboardShortcutsContext";

// Tab panels are route-like application surfaces. Keep the initial identity
// route small and fetch the credentials route only when it is needed.
const IdentityPanel = lazy(() => import("./components/IdentityPanel"));
const CredentialsPanel = lazy(() => import("./components/CredentialsPanel"));
const IssuerDashboard = lazy(() => import("./pages/IssuerDashboard"));
const preloadCredentialsPanel = () => {
  void import("./components/CredentialsPanel");
};
import QRScanner from "./components/QRScanner";
import CredentialRecipientVerify from "./components/CredentialRecipientVerify";
import WalletButton from "./components/WalletButton";
import ErrorBoundary from "./components/ErrorBoundary";
import Toast from "./components/Toast";
import { ToastProvider } from "./context/ToastContext";
import { useWallet } from "./hooks/useWallet";
import { useCredentialExpiryCheck } from "./hooks/useCredentialExpiryCheck";
import { useTheme, cycleTheme, getThemeIcon, getThemeLabel } from "./hooks/useTheme";
import { useServiceWorker } from "./hooks/useServiceWorker";
import OfflineIndicator from "./components/OfflineIndicator";
import {
  DEFAULT_NETWORK,
  NETWORK_CONFIGS,
  NETWORK_OPTIONS,
  isMainnet,
  type NetworkName,
} from "./network";
import { checkConnection, IdentityClient, CredentialClient, ReputationClient } from "../../sdk/src/index";
import { setLocale } from "./i18n";
import { useOpenGraphMeta } from "./hooks/useOpenGraphMeta";
import { SHARE_DESCRIPTION, SHARE_TITLE, buildVerificationUrl } from "./utils/socialShare";
import type { Credential } from "../../sdk/src/types";

const SUPPORTED_LOCALES: { code: string; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
  { code: "fr", label: "FR" },
  { code: "zh", label: "中文" },
];

export enum Tab {
  Identity = "identity",
  Credentials = "credentials",
  IssuerAnalytics = "issuerAnalytics",
}

const TAB_ORDER: Tab[] = [Tab.Identity, Tab.Credentials, Tab.IssuerAnalytics];

export default function App() {
  const [tab, setTab] = useState<Tab>(Tab.Identity);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [activeNetwork, setActiveNetwork] = useState<NetworkName>(DEFAULT_NETWORK);
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [deepLinkEncrypted, setDeepLinkEncrypted] = useState<{ c: string; k: string } | null>(null);
  const networkConfig = NETWORK_CONFIGS[activeNetwork];
  const wallet = useWallet(networkConfig);
  const [theme, setTheme, isDarkMode] = useTheme();
  const { t, i18n } = useTranslation();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [uninitializedContracts, setUninitializedContracts] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  
  // Keyboard shortcuts
  const { enabled: shortcutsEnabled, toggleHelp: toggleShortcutsHelp, showHelp: showShortcutsHelp } = useKeyboardShortcutsContext();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Mobile nav drawer (#882): while open, focus moves into the drawer and
  // Tab cycles inside it, the page behind does not scroll, and Escape closes
  // it. Closing returns focus to the menu button.
  const wasMenuOpen = useRef(false);
  useEffect(() => {
    if (!menuOpen) {
      if (wasMenuOpen.current) menuButtonRef.current?.focus();
      wasMenuOpen.current = false;
      return;
    }
    wasMenuOpen.current = true;
    const root = document.documentElement;
    root.classList.add("nav-open");
    const focusable = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      // The menu button stays above the drawer as its close control, so it is
      // part of the cycle.
      const items = [menuButtonRef.current, ...focusable()].filter(
        (el): el is HTMLElement => el !== null,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      root.classList.remove("nav-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Check for verify query param on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const verifyParam = urlParams.get("verify");
    const cParam = urlParams.get("c");
    const kParam = urlParams.get("k");

    if (cParam && kParam) {
      setDeepLinkEncrypted({ c: cParam, k: kParam });
      setTab(Tab.Credentials);
    } else if (verifyParam) {
      setVerifyId(verifyParam);
      setTab(Tab.Credentials);
    }
  }, []);

  // #948: link preview metadata for shared `?verify=<id>` links.
  const verifyMeta = useMemo(
    () => (verifyId ? { title: SHARE_TITLE, description: SHARE_DESCRIPTION, url: buildVerificationUrl(verifyId) } : null),
    [verifyId]
  );
  useOpenGraphMeta(verifyMeta);

  const onMainnet = isMainnet(activeNetwork);

  // Check RPC connection health on load
  useEffect(() => {
    const checkRpcHealth = async () => {
      const rpcUrl = Array.isArray(networkConfig.rpcUrl)
        ? networkConfig.rpcUrl[0]
        : networkConfig.rpcUrl;
      const server = new SorobanRpc.Server(rpcUrl);
      const healthy = await checkConnection(server);
      setIsConnected(healthy);
    };
    checkRpcHealth();
  }, [networkConfig.rpcUrl]);

  // Check contract initialization on load
  useEffect(() => {
    const checkInit = async () => {
      const identity = new IdentityClient(networkConfig);
      const credentials = new CredentialClient(networkConfig);
      const reputation = new ReputationClient(networkConfig);
      const [idOk, credOk, repOk] = await Promise.all([
        identity.isInitialized(),
        credentials.isInitialized(),
        reputation.isInitialized(),
      ]);
      const uninitialized: string[] = [];
      if (!idOk) uninitialized.push("Identity Registry");
      if (!credOk) uninitialized.push("Credential Manager");
      if (!repOk) uninitialized.push("Reputation");
      setUninitializedContracts(uninitialized);
    };
    checkInit();
  }, [networkConfig.rpcUrl]);

  // TODO: integrate SDK — replace with CredentialClient.getCredentialsBySubject() (see issue #226)
  const fetchCredentials = useCallback(
    async (_address: string): Promise<Credential[]> => {
      return [];
    },
    [],
  );

  const { notification, dismiss } = useCredentialExpiryCheck(
    wallet.publicKey,
    fetchCredentials,
  );

  const handleLocaleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocale(e.target.value);
  };

  // WAI-ARIA tab pattern: Left/Right cycle, Home/End jump to the ends.
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = TAB_ORDER.indexOf(tab);
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % TAB_ORDER.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = TAB_ORDER.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = TAB_ORDER[nextIndex];
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    enabled: shortcutsEnabled,
    shortcuts: [
      {
        key: 'k',
        ctrl: true,
        description: t('shortcuts.search'),
        category: 'actions',
        handler: () => {
          // Focus search input if it exists
          searchInputRef.current?.focus();
        },
      },
      {
        key: 'n',
        ctrl: true,
        description: t('shortcuts.createCredential'),
        category: 'actions',
        handler: () => {
          // Switch to credentials tab
          setTab(Tab.Credentials);
          // Note: Actual credential creation would be triggered in CredentialsPanel
        },
      },
      {
        key: 't',
        ctrl: true,
        shift: true,
        description: t('shortcuts.toggleTheme'),
        category: 'ui',
        handler: () => {
          setTheme(cycleTheme(theme));
        },
      },
      {
        key: '?',
        description: t('shortcuts.showHelp'),
        category: 'ui',
        handler: () => {
          toggleShortcutsHelp();
        },
      },
      {
        key: '/',
        ctrl: true,
        description: t('shortcuts.showHelp'),
        category: 'ui',
        handler: () => {
          toggleShortcutsHelp();
        },
      },
      {
        key: 'Escape',
        description: t('shortcuts.closeDialog'),
        category: 'ui',
        handler: () => {
          if (showShortcutsHelp) {
            toggleShortcutsHelp();
          } else if (menuOpen) {
            setMenuOpen(false);
          }
        },
        preventDefault: false,
      },
    ],
  });

  // Sequential shortcuts for navigation (g+d, g+c)
  useSequentialShortcuts({
    'g,d': () => {
      setTab(Tab.Identity);
      tabRefs.current[Tab.Identity]?.focus();
    },
    'g,c': () => {
      setTab(Tab.Credentials);
      tabRefs.current[Tab.Credentials]?.focus();
    },
  }, { enabled: shortcutsEnabled });

  return (
    <ToastProvider>
      <Toast />
      <KeyboardShortcutsModal isOpen={showShortcutsHelp} onClose={toggleShortcutsHelp} />
      <a className="skip-link" href="#main-content">
        {t("a11y.skipToContent")}
      </a>
      <div className="container">
      <header className="app-header">
        <div className="app-header__brand">
          <h1>{t("app.title")}</h1>
          <p>{t("app.subtitle")}</p>
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          className="hamburger-btn"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-header-actions"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={`hamburger-icon${menuOpen ? " open" : ""}`} />
        </button>
        {/* Layout lives in styles/navigation.css: a drawer on phones, inline
            from 768px up. Inline styles here would override it. */}
        <div
          id="mobile-header-actions"
          ref={menuRef}
          className={`header-actions${menuOpen ? " open" : ""}`}
        >
          {isConnected !== null && (
            <div
              role="status"
              aria-live="polite"
              className={`network-status${isConnected ? " is-online" : ""}`}
            >
              <span aria-hidden="true" className="network-status__dot" />
              {isConnected ? t("app.networkOnline") : t("app.networkOffline")}
            </div>
          )}
          <select
            value={i18n.language}
            onChange={handleLocaleChange}
            aria-label={t("a11y.switchLanguage")}
          >
            {SUPPORTED_LOCALES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <label className="network-switcher" htmlFor="network-select">
            <span>Network</span>
            <select
              id="network-select"
              value={activeNetwork}
              onChange={(e) => setActiveNetwork(e.target.value as NetworkName)}
            >
              {NETWORK_OPTIONS.map((network) => (
                <option key={network.name} value={network.name}>
                  {network.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="theme-toggle"
            onClick={() => setTheme(cycleTheme(theme))}
            aria-label={`Switch theme. Current: ${theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}`}
            title={`Theme: ${theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}`}
          >
            {getThemeIcon(theme, isDarkMode)} {getThemeLabel(theme, isDarkMode, t)}
          </button>
          <WalletButton wallet={wallet} />
        </div>
        <div
          className={`mobile-drawer-backdrop${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      </header>

      <OfflineIndicator />

      {uninitializedContracts.length > 0 && (
        <div
          role="alert"
          aria-label="Contract not initialized warning"
          style={{
            background: "var(--warning-bg, #fff3cd)",
            color: "var(--warning-text, #856404)",
            border: "1px solid var(--warning-border, #ffc107)",
            borderRadius: "0.5rem",
            padding: "0.6rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}
        >
          <span aria-hidden="true">⚠</span> Contract not initialized: <strong>{uninitializedContracts.join(", ")}</strong>.
          Please run the deploy script and update your contract IDs.{" "}
          <a
            href="docs/architecture.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            Deployment guide
          </a>
        </div>
      )}

      {onMainnet && (
        <div
          role="alert"
          aria-label="Mainnet warning"
          style={{
            background: "var(--badge-red-bg)",
            color: "var(--badge-red-text)",
            border: "1px solid var(--badge-red-text)",
            borderRadius: "0.5rem",
            padding: "0.6rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
            fontWeight: 600,
          }}
        >
          <span aria-hidden="true">⚠</span> You are connected to Stellar <strong>mainnet</strong>. All actions submit real
          transactions and may incur on-chain fees.
        </div>
      )}

      {notification && !notification.dismissed && (
        <div
          role="alert"
          style={{
            background: "var(--warning-bg, #fff3cd)",
            color: "var(--warning-text, #856404)",
            border: "1px solid var(--warning-border, #ffc107)",
            borderRadius: "0.5rem",
            padding: "0.6rem 1rem",
            marginBottom: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.9rem",
          }}
        >
          <span>
            <span aria-hidden="true">⚠</span> {notification.count} credential
            {notification.count > 1 ? "s" : ""} expiring within 7 days
          </span>
          <button
            onClick={dismiss}
            aria-label={t("a11y.dismissNotification")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
              color: "inherit",
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div
        className="tabs"
        role="tablist"
        aria-label={t("tabs.label")}
        onKeyDown={handleTabKeyDown}
      >
        {TAB_ORDER.map((name) => (
          <button
            key={name}
            id={`tab-${name}`}
            role="tab"
            type="button"
            className={`tab ${tab === name ? "active" : ""}`}
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            // Roving tabindex: only the selected tab is in the tab order, and
            // the arrow keys move between tabs from there.
            tabIndex={tab === name ? 0 : -1}
            ref={(node) => {
              tabRefs.current[name] = node;
            }}
            onClick={() => setTab(name)}
            onMouseEnter={name === Tab.Credentials ? preloadCredentialsPanel : undefined}
            onFocus={name === Tab.Credentials ? preloadCredentialsPanel : undefined}
          >
            {t(`tabs.${name}`)}
          </button>
        ))}
      </div>

      <main id="main-content" tabIndex={-1}>
        <ErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
          <div
            id={`panel-${Tab.Identity}`}
            role="tabpanel"
            aria-labelledby={`tab-${Tab.Identity}`}
            hidden={tab !== Tab.Identity}
          >
            {tab === Tab.Identity && <IdentityPanel />}
          </div>
          <div
            id={`panel-${Tab.Credentials}`}
            role="tabpanel"
            aria-labelledby={`tab-${Tab.Credentials}`}
            hidden={tab !== Tab.Credentials}
          >
            {tab === Tab.Credentials && (
              <>
                {deepLinkEncrypted && (
                  <CredentialRecipientVerify
                    ciphertext={deepLinkEncrypted.c}
                    secretKey={deepLinkEncrypted.k}
                    onClose={() => setDeepLinkEncrypted(null)}
                  />
                )}
                <button type="button" onClick={() => setScanning((v) => !v)}>
                  Scan QR
                </button>
                {scanning && (
                  <QRScanner
                    onVerify={(id) => {
                      setVerifyId(id);
                      setScanning(false);
                    }}
                    onClose={() => setScanning(false)}
                  />
                )}
                <CredentialsPanel verifyId={verifyId} />
              </>
            )}
          </div>
          <div
            id={`panel-${Tab.IssuerAnalytics}`}
            role="tabpanel"
            aria-labelledby={`tab-${Tab.IssuerAnalytics}`}
            hidden={tab !== Tab.IssuerAnalytics}
          >
            {tab === Tab.IssuerAnalytics && <IssuerDashboard />}
          </div>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
    </ToastProvider>
  );
}
