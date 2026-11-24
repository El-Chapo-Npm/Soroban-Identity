import { useState } from "react";
import WalletButton from "./WalletButton";
import type { useWallet } from "../hooks/useWallet";

export type Tab = "identity" | "credentials";

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  wallet: ReturnType<typeof useWallet>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "identity", label: "Identity (DID)" },
  { id: "credentials", label: "Credentials" },
];

export default function Navbar({ tab, onTab, isDark, onToggleTheme, wallet }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="navbar">
      <span className="navbar-brand">Soroban Identity</span>
      <button
        className="navbar-toggle"
        aria-label="Toggle navigation"
        aria-expanded={open}
        aria-controls="navbar-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "✕" : "☰"}
      </button>
      <div id="navbar-menu" className={`navbar-menu ${open ? "open" : ""}`}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => { onTab(t.id); setOpen(false); }}
          >
            {t.label}
          </button>
        ))}
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? "☀ Light" : "☾ Dark"}
        </button>
        <WalletButton wallet={wallet} />
      </div>
    </nav>
  );
}
