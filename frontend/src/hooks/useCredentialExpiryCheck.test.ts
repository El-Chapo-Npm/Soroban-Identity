import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Credential } from "../../../sdk/src/types";
import {
  notifyBatchCredentialsUpdated,
  useCredentialExpiryCheck,
} from "./useCredentialExpiryCheck";

const WALLET = "GWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DAY_S = 24 * 60 * 60;

function cred(id: string, overrides: Partial<Credential> = {}): Credential {
  const nowS = Math.floor(Date.now() / 1000);
  return {
    id,
    issuer: "GISSUER",
    subject: WALLET,
    credentialType: "KYC",
    claimHash: "",
    issuedAt: nowS,
    expiresAt: nowS + 2 * DAY_S,
    revoked: false,
    ...overrides,
  } as Credential;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function renderWith(fetchCredentials: (address: string) => Promise<Credential[]>) {
  const hook = renderHook(() => useCredentialExpiryCheck(WALLET, fetchCredentials));
  await waitFor(() => expect(fetchCredentials).toHaveBeenCalled());
  return hook;
}

describe("useCredentialExpiryCheck badge count (#1081)", () => {
  it("counts only unread expiring credentials and ignores non-expiring ones", async () => {
    const fetchCredentials = vi
      .fn()
      .mockResolvedValue([
        cred("a"),
        cred("b"),
        cred("never", { expiresAt: 0 }),
        cred("revoked", { revoked: true }),
        cred("later", { expiresAt: Math.floor(Date.now() / 1000) + 30 * DAY_S }),
        cred("a"),
      ]);
    const { result } = await renderWith(fetchCredentials);

    await waitFor(() => expect(result.current.notification?.count).toBe(2));
  });

  it("does not re-count credentials already marked read after a batch revoke", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([cred("a"), cred("b"), cred("c")]);
    const { result } = await renderWith(fetchCredentials);
    await waitFor(() => expect(result.current.notification?.count).toBe(3));

    act(() => result.current.markAsRead("a"));
    expect(result.current.notification?.count).toBe(2);

    fetchCredentials.mockResolvedValue([cred("a"), cred("b")]);
    act(() => notifyBatchCredentialsUpdated({ revokedIds: ["c"] }));

    expect(result.current.notification?.count).toBe(1);
    expect(result.current.notification?.readIds).toEqual(["a"]);
    await waitFor(() => expect(fetchCredentials).toHaveBeenCalledTimes(2));
    expect(result.current.notification?.count).toBe(1);
  });

  it("keeps batch-issued credentials when the follow-up fetch has not caught up", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([cred("a")]);
    const { result } = await renderWith(fetchCredentials);
    await waitFor(() => expect(result.current.notification?.count).toBe(1));

    act(() =>
      notifyBatchCredentialsUpdated({ issued: [cred("bulk-1"), cred("bulk-2"), cred("bulk-1")] })
    );
    expect(result.current.notification?.count).toBe(3);

    await waitFor(() => expect(fetchCredentials).toHaveBeenCalledTimes(2));
    expect(result.current.notification?.count).toBe(3);
  });

  it("does not double count once the fetch returns the batch-issued credentials", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([]);
    const { result } = await renderWith(fetchCredentials);

    fetchCredentials.mockResolvedValue([cred("bulk-1"), cred("bulk-2")]);
    act(() => notifyBatchCredentialsUpdated({ issued: [cred("bulk-1"), cred("bulk-2")] }));

    await waitFor(() => expect(fetchCredentials).toHaveBeenCalledTimes(2));
    expect(result.current.notification?.count).toBe(2);
  });

  it("does not resurrect revoked credentials from a stale fetch", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([cred("a"), cred("b")]);
    const { result } = await renderWith(fetchCredentials);
    await waitFor(() => expect(result.current.notification?.count).toBe(2));

    // The follow-up fetch still reports both as live.
    act(() => notifyBatchCredentialsUpdated({ revokedIds: ["a", "b"] }));
    expect(result.current.notification).toBeNull();

    await waitFor(() => expect(fetchCredentials).toHaveBeenCalledTimes(2));
    expect(result.current.notification).toBeNull();
  });

  it("discards a check that started before the batch and resolves after it", async () => {
    const slow = deferred<Credential[]>();
    const fetchCredentials = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue([cred("bulk-1")]);
    const { result } = await renderWith(fetchCredentials);

    act(() => notifyBatchCredentialsUpdated({ issued: [cred("bulk-1")] }));
    await waitFor(() => expect(fetchCredentials).toHaveBeenCalledTimes(2));
    expect(result.current.notification?.count).toBe(1);

    // The pre-batch fetch lands last with an older, larger view.
    await act(async () => {
      slow.resolve([cred("old-1"), cred("old-2"), cred("old-3")]);
      await slow.promise;
    });
    expect(result.current.notification?.count).toBe(1);
  });

  it("ignores deltaCount and derives the count from the credential set", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([cred("a")]);
    const { result } = await renderWith(fetchCredentials);
    await waitFor(() => expect(result.current.notification?.count).toBe(1));

    act(() => notifyBatchCredentialsUpdated({ deltaCount: 5 }));
    expect(result.current.notification?.count).toBe(1);
    await waitFor(() => expect(fetchCredentials).toHaveBeenCalledTimes(2));
    expect(result.current.notification?.count).toBe(1);
  });

  it("keeps a dismissed badge hidden unless new unread credentials arrive", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([cred("a"), cred("b")]);
    const { result } = await renderWith(fetchCredentials);
    await waitFor(() => expect(result.current.notification?.count).toBe(2));

    act(() => result.current.markAllAsRead());
    expect(result.current.notification?.dismissed).toBe(true);

    act(() => notifyBatchCredentialsUpdated({ revokedIds: ["a"] }));
    expect(result.current.notification?.dismissed).toBe(true);
    expect(result.current.notification?.count).toBe(0);

    act(() => notifyBatchCredentialsUpdated({ issued: [cred("new-1")] }));
    expect(result.current.notification?.dismissed).toBe(false);
    expect(result.current.notification?.count).toBe(1);
    await waitFor(() => expect(fetchCredentials).toHaveBeenCalledTimes(3));
  });

  it("shows newly expiring credentials found by a later check after everything was read", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([cred("a")]);
    const { result, rerender } = await renderWith(fetchCredentials);
    await waitFor(() => expect(result.current.notification?.count).toBe(1));
    act(() => result.current.markAllAsRead());

    fetchCredentials.mockResolvedValue([cred("a"), cred("b")]);
    // Any batch event triggers a re-check.
    act(() => notifyBatchCredentialsUpdated({}));
    rerender();

    await waitFor(() => expect(result.current.notification?.count).toBe(1));
    expect(result.current.notification?.dismissed).toBe(false);
  });

  it("clears batch state when the wallet disconnects", async () => {
    const fetchCredentials = vi.fn().mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ key }) => useCredentialExpiryCheck(key, fetchCredentials),
      { initialProps: { key: WALLET as string | null } }
    );
    await waitFor(() => expect(fetchCredentials).toHaveBeenCalled());
    act(() => notifyBatchCredentialsUpdated({ issued: [cred("bulk-1")] }));
    expect(result.current.notification?.count).toBe(1);

    rerender({ key: null });
    expect(result.current.notification).toBeNull();

    rerender({ key: WALLET });
    await waitFor(() => expect(fetchCredentials.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(result.current.notification).toBeNull();
  });
});
