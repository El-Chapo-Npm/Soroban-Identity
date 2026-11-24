import { useEffect, useState } from 'react';
import { fetchIdentityEvents, type IdentityEvent } from '../utils/identityApi';
import { formatTimestamp } from '../utils/formatDate';

const TYPE_STYLE: Record<IdentityEvent['type'], { label: string; color: string }> = {
  create: { label: 'Created', color: 'var(--success, #16a34a)' },
  update: { label: 'Updated', color: 'var(--accent, #6366f1)' },
  revoke: { label: 'Revoked', color: 'var(--error, #dc2626)' },
};

/** Timeline of create/update/revoke events for a DID, sourced from the indexer (#1354). */
export default function AuditLogViewer({ did }: { did: string }) {
  const [events, setEvents] = useState<IdentityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setEvents(null);
    setError(null);
    fetchIdentityEvents(did, ctrl.signal)
      .then(setEvents)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Failed to load audit log');
      });
    return () => ctrl.abort();
  }, [did]);

  return (
    <section className="card" aria-labelledby="audit-log-title" style={{ marginTop: '1rem' }}>
      <h3 id="audit-log-title" style={{ marginBottom: '0.5rem' }}>Activity log</h3>
      {error && <p role="alert" style={{ color: 'var(--error, #dc2626)' }}>{error}</p>}
      {!error && events === null && <p aria-busy="true">Loading activity…</p>}
      {events && events.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No activity recorded yet.</p>}
      {events && events.length > 0 && (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderLeft: '2px solid var(--card-border, #e2e8f0)' }}>
          {events.map((ev) => {
            const s = TYPE_STYLE[ev.type];
            return (
              <li key={ev.id} style={{ position: 'relative', padding: '0 0 0.75rem 1rem' }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', left: '-6px', top: '0.35rem', width: 10, height: 10,
                    borderRadius: '50%', background: s.color,
                  }}
                />
                <strong style={{ color: s.color }}>{s.label}</strong>{' '}
                <time dateTime={new Date(ev.timestamp * 1000).toISOString()} style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {formatTimestamp(ev.timestamp)}
                </time>
                {ev.details && <div style={{ fontSize: '0.85rem' }}>{ev.details}</div>}
                {ev.txHash && (
                  <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--text-muted)' }}>
                    tx: {ev.txHash}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
