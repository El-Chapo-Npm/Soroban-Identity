import { useEffect, useMemo, useState } from "react";
import type { DidDocument } from "../../../sdk/src/types";
import { IdentityClient } from "../../../sdk/src/identity";
import { getNetworkConfig } from "../network";
import type { WalletState } from "../hooks/useWallet";

type StatusFilter = "all" | "active" | "inactive";

export function identityMatchesQuery(identity: DidDocument, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const names = [identity.metadata?.name, identity.metadata?.displayName].filter(
    (value): value is string => Boolean(value)
  );
  return [identity.id, identity.controller, ...names].some((value) =>
    value.toLowerCase().includes(normalizedQuery)
  );
}

export function filterIdentities(
  identities: DidDocument[],
  query: string,
  status: StatusFilter
): DidDocument[] {
  return identities.filter((identity) => {
    const matchesStatus =
      status === "all" || (status === "active" ? identity.active : !identity.active);
    return matchesStatus && identityMatchesQuery(identity, query);
  });
}

const PAGE_SIZE = 100;

interface IdentityDirectoryProps {
  wallet: Pick<WalletState, "connected" | "publicKey">;
  onSelectIdentity?: (controller: string) => void;
}

export default function IdentityDirectory({ wallet, onSelectIdentity }: IdentityDirectoryProps) {
  const [identities, setIdentities] = useState<DidDocument[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const visibleIdentities = useMemo(
    () => filterIdentities(identities, debouncedQuery, status),
    [identities, debouncedQuery, status]
  );

  const loadIdentities = async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const client = new IdentityClient(getNetworkConfig());
      const results: DidDocument[] = [];
      let page = 1;
      while (true) {
        const batch = await client.listDIDs(wallet.publicKey, page, PAGE_SIZE);
        results.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        page += 1;
      }
      setIdentities(results);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load identities.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card" aria-labelledby="identity-directory-heading">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "1rem",
        }}
      >
        <div>
          <h2 id="identity-directory-heading">Identity directory</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            Search identities by DID, address, or name and filter by status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadIdentities()}
          disabled={!wallet.connected || loading}
        >
          {loading ? "Loading…" : loaded ? "Refresh" : "Load identities"}
        </button>
      </div>

      {!wallet.connected && (
        <p role="status" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Connect an administrator wallet to browse identities.
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--danger-text)" }}>
          {error}
        </p>
      )}

      {loaded && (
        <>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
            <label style={{ flex: "1 1 16rem" }}>
              <span className="visually-hidden">Search identities</span>
              <input
                type="search"
                aria-label="Search identities"
                placeholder="Search by DID, address, or name…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <span className="visually-hidden">Identity status</span>
              <select
                aria-label="Identity status"
                value={status}
                onChange={(event) => setStatus(event.target.value as StatusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <p role="status" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
            Showing {visibleIdentities.length} of {identities.length} identities
          </p>

          {visibleIdentities.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
              No identities match the current filters.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <caption className="visually-hidden">Registered identities</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: "left" }}>
                      DID
                    </th>
                    <th scope="col" style={{ textAlign: "left" }}>
                      Name
                    </th>
                    <th scope="col" style={{ textAlign: "left" }}>
                      Status
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIdentities.map((identity) => {
                    const name = identity.metadata?.name ?? identity.metadata?.displayName ?? "—";
                    return (
                      <tr key={identity.id}>
                        <td
                          style={{ padding: "0.5rem 0", fontFamily: "monospace" }}
                          title={identity.id}
                        >
                          {identity.id.slice(0, 18)}…{identity.id.slice(-8)}
                        </td>
                        <td>{name}</td>
                        <td>{identity.active ? "Active" : "Inactive"}</td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => onSelectIdentity?.(identity.controller)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
