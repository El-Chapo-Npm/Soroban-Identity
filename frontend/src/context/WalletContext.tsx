import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWallet } from "../hooks/useWallet";
import type { FrontendNetworkConfig } from "../network";
import { getNetworkConfig } from "../network";
import { useIdleSessionTimeout } from "../hooks/useIdleSessionTimeout";
import SessionTimeoutWarning from "../components/SessionTimeoutWarning";

export type WalletContextValue = ReturnType<typeof useWallet>;

export const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const networkConfig: FrontendNetworkConfig = getNetworkConfig();
  const wallet = useWallet(networkConfig);
  const { warningVisible, secondsRemaining, extendSession } = useIdleSessionTimeout(
    wallet.connected,
    wallet.disconnect
  );

  const value = useMemo(
    () => wallet,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      wallet.publicKey,
      wallet.connected,
      wallet.reconnecting,
      wallet.networkPassphrase,
      wallet.connecting,
      wallet.txLoading,
      wallet.walletType,
      wallet.error,
      wallet.retryCount,
      wallet.isConnecting,
      wallet.connectionError,
      wallet.connect,
      wallet.disconnect,
      wallet.signTransaction,
      wallet.retry,
    ]
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <SessionTimeoutWarning
        open={warningVisible}
        secondsRemaining={secondsRemaining}
        onExtend={extendSession}
        onDisconnect={() => void wallet.disconnect()}
      />
    </WalletContext.Provider>
  );
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used inside WalletProvider");
  return ctx;
}
