import { useEffect, useState } from 'react';

interface AuditEvent {
  id: string;
  type: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

const ACTIONS = ['create', 'update', 'revoke'] as const;

function actionOf(type: string): (typeof ACTIONS)[number] | null {
  const t = type.toLowerCase();
  if (t.includes('revok') || t.includes('deactivat')) return 'revoke';
  if (t.includes('creat') || t.includes('register') || t.includes('issu')) return 'create';
  if (t.includes('updat')) return 'update';
  return null;
}

const COLORS = { create: '#16a34a', update: '#2563eb', revoke: '#dc2626' };

/** Timeline of create/update/revoke events for a DID from the indexer API (#1354). */
export default function AuditLogViewer({ did, apiBaseUrl = import.meta.env.VITE_SERVER_URL ?? '' }: { did: string; apiBaseUrl?: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/events?aggregate_id=${encodeURIComponent(did)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Indexer request failed (${r.status})`);
        return r.json() as Promise<{ events: AuditEvent[] }>;
      })
      .then(({ events: list }) => {
        if (cancelled) return;
        setEvents(
          (list ?? [])
            .filter((e) => actionOf(e.type))
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
        );
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load audit log'));
    return () => {
      cancelled = true;
    };
  }, [did, apiBaseUrl]);

  return (
    <section className="card" aria-labelledby="audit-log-heading" style={{ marginTop: '1rem' }}>
      <h3 id="audit-log-heading" style={{ marginBottom: '0.5rem' }}>Activity log</h3>
      {error && <p role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
      {!error && events === null && <p aria-live="polite">Loading activity…</p>}
      {events?.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No activity recorded for this DID.</p>}
      {events && events.length > 0 && (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderLeft: '2px solid var(--border-light)' }}>
          {events.map((e) => {
            const action = actionOf(e.type)!;
            return (
              <li key={e.id} style={{ position: 'relative', padding: '0 0 0.75rem 1rem' }}>
                <span
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-6px', top: '0.35rem', width: 10, height: 10, borderRadius: '50%', background: COLORS[action] }}
                />
                <strong style={{ color: COLORS[action], textTransform: 'capitalize' }}>{action}</strong>{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{e.type}</span>
                <div style={{ fontSize: '0.8rem' }}>
                  <time dateTime={e.timestamp}>{new Date(e.timestamp).toLocaleString()}</time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
