import {
  StellarWalletsKit,
  WalletNetwork,
  ALBEDO_ID,
  XBULL_ID,
  AlbedoModule,
  xBullModule,
} from "@creit.tech/stellar-wallets-kit";

/** Wallets connected through stellar-wallets-kit (FE-35). */
export type KitWalletType = "albedo" | "xbull";

const KIT_IDS: Record<KitWalletType, string> = {
  albedo: ALBEDO_ID,
  xbull: XBULL_ID,
};

export const isKitWallet = (type: unknown): type is KitWalletType =>
  type === "albedo" || type === "xbull";

function kitFor(type: KitWalletType, networkPassphrase: string): StellarWalletsKit {
  return new StellarWalletsKit({
    network: networkPassphrase as WalletNetwork,
    selectedWalletId: KIT_IDS[type],
    modules: [new AlbedoModule(), new xBullModule()],
  });
}

export async function kitGetAddress(
  type: KitWalletType,
  networkPassphrase: string,
): Promise<string> {
  const { address } = await kitFor(type, networkPassphrase).getAddress();
  return address;
}

export async function kitSignTransaction(
  type: KitWalletType,
  xdr: string,
  networkPassphrase: string,
  address: string | null,
): Promise<string> {
  const { signedTxXdr } = await kitFor(type, networkPassphrase).signTransaction(xdr, {
    networkPassphrase,
    address: address ?? undefined,
  });
  return signedTxXdr;
}
