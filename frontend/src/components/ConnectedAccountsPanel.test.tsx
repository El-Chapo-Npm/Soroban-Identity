import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConnectedAccountsPanel from "./ConnectedAccountsPanel";
const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

describe("ConnectedAccountsPanel wallet session", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("does not request or sign a challenge until the user asks to verify the wallet", async () => {
    const signTransaction = vi.fn().mockResolvedValue("signed-xdr");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/account-links/challenge?")) {
        return {
          ok: true,
          json: async () => ({
            challengeId: "challenge",
            xdr: "challenge-xdr",
            networkPassphrase: "test-passphrase",
          }),
        };
      }
      if (url.endsWith("/account-links/session")) {
        return {
          ok: true,
          json: async () => ({
            token: "session",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          github: null,
          email: null,
          capabilities: { github: true, email: true },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ConnectedAccountsPanel
        wallet={{
          connected: true,
          publicKey: "GADDRESS",
          networkPassphrase: "test-passphrase",
          signTransaction,
        }}
      />
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "accounts.authenticate" }));
    await waitFor(() => expect(signTransaction).toHaveBeenCalledWith("challenge-xdr"));
    expect(fetchMock.mock.calls[0][0]).toContain("/account-links/challenge?address=GADDRESS");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/account-links/session"))
      ).toBe(true)
    );
  });
});
