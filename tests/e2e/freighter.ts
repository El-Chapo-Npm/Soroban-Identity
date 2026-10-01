import type { Page } from "@playwright/test";

/** Valid ed25519 StrKey. Display and SDK parsing only; no matching secret is used. */
export const FREIGHTER_PUBLIC_KEY =
  "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export async function installFreighter(page: Page, opts?: { connected?: boolean; passphrase?: string }) {
  const connected = opts?.connected ?? true;
  const passphrase = opts?.passphrase ?? TESTNET_PASSPHRASE;
  await page.addInitScript(
    ({ publicKey, connected, passphrase }) => {
      const freighter = {
        isConnected: async () => connected,
        getPublicKey: async () => publicKey,
        getNetwork: async () => ({
          network: "TESTNET",
          networkPassphrase: passphrase,
        }),
        signTransaction: async (xdr: string) => xdr,
        setAllowedHosts: async () => undefined,
      };
      (window as unknown as { freighter: typeof freighter }).freighter = freighter;
    },
    { publicKey: FREIGHTER_PUBLIC_KEY, connected, passphrase },
  );
}

/** Soroban RPC stub. Health succeeds. Every other method fails in a structured way. */
export async function stubSorobanRpc(page: Page) {
  await page.route(/stellar\.org|soroban-testnet|soroban-mainnet/, async (route) => {
    const request = route.request();
    const url = request.url();
    let id: number | string = 1;
    try {
      const body = request.postDataJSON() as { id?: number | string; method?: string };
      id = body?.id ?? 1;
      if (body?.method === "getHealth") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jsonrpc: "2.0", id, result: { status: "healthy" } }),
        });
        return;
      }
      if (body?.method === "getNetwork") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { passphrase: "Test SDF Network ; September 2015", protocolVersion: "21" },
          }),
        });
        return;
      }
    } catch {
      // Non-JSON body: fall through to a generic RPC error.
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32001, message: "e2e rpc stub: ledger entry not found" },
      }),
    });
  });
}
