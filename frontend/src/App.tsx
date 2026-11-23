import { useState } from "react";
import IdentityPanel from "./components/IdentityPanel";
import CredentialsPanel from "./components/CredentialsPanel";
import Navbar, { type Tab } from "./components/Navbar";
import { useWallet } from "./hooks/useWallet";
import { useTheme } from "./hooks/useTheme";

export default function App() {
  const [tab, setTab] = useState<Tab>("identity");
  const wallet = useWallet();
  const { isDark, toggle } = useTheme();

  return (
    <>
      <Navbar tab={tab} onTab={setTab} isDark={isDark} onToggleTheme={toggle} wallet={wallet} />
      <div className="container">
        <header>
          <h1>Soroban Identity</h1>
          <p>Decentralized Identity for a Trustless World</p>
        </header>

        {tab === "identity" && <IdentityPanel wallet={wallet} />}
        {tab === "credentials" && <CredentialsPanel wallet={wallet} />}
      </div>
    </>
  );
}
