import type { WalletState } from "../../hooks/useWallet";

const noop = () => {};

export const disconnectedWallet = {
  publicKey: null,
  networkPassphrase: null,
  connected: false,
  connecting: false,
  walletType: null,
  error: null,
  connect: noop,
  disconnect: noop,
  signTransaction: async (xdr: string) => xdr,
} satisfies WalletState & Record<string, unknown>;

export const connectingWallet = { ...disconnectedWallet, connecting: true };

export const connectedWallet = {
  ...disconnectedWallet,
  publicKey: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  networkPassphrase: "Test SDF Network ; September 2015",
  connected: true,
  walletType: "freighter" as const,
};

export const erroredWallet = { ...disconnectedWallet, error: "Freighter not installed" };
