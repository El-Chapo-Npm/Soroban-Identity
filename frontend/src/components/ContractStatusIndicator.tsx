import React, { useMemo } from 'react';
import { useContractEvents, type StreamedContractEvent } from '../hooks/useContractEvents';

/** Health states surfaced by the indicator. `checking` is the initial, neutral state. */
export type ContractHealth = 'healthy' | 'unhealthy' | 'checking';

export interface ContractHealthInput {
  connected: boolean;
  error: string | null;
  events: Pick<StreamedContractEvent, 'type' | 'timestamp'>[];
  /** Current time in ms. Injectable so the staleness rule is deterministic in tests. */
  now?: number;
  /** Events older than this are ignored when deciding health. Defaults to 60s. */
  staleAfterMs?: number;
}

const FAILURE_PATTERN = /error|fail|revert|panic|invalid/i;

/**
 * Pure health derivation from a Horizon-backed event stream.
 *
 * - A recent failure event or an explicit stream error means the contract is unhealthy (red).
 * - A live stream or recent successful activity means healthy (green).
 * - Anything else is still `checking` (amber) until the stream reports in.
 */
export function deriveContractHealth({
  connected,
  error,
  events,
  now = Date.now(),
  staleAfterMs = 60_000,
}: ContractHealthInput): ContractHealth {
  const recent = events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    // An unparseable timestamp cannot be proven stale, so keep it.
    return Number.isNaN(timestamp) || now - timestamp <= staleAfterMs;
  });

  if (recent.some((event) => FAILURE_PATTERN.test(event.type))) {
    return 'unhealthy';
  }
  if (error) {
    return 'unhealthy';
  }
  if (connected || recent.length > 0) {
    return 'healthy';
  }
  return 'checking';
}

const THEMES: Record<ContractHealth, { label: string; bg: string; fg: string; border: string; dot: string }> = {
  healthy: { label: 'Healthy', bg: '#dcfce7', fg: '#166534', border: '#bbf7d0', dot: '#16a34a' },
  unhealthy: { label: 'Unhealthy', bg: '#fee2e2', fg: '#991b1b', border: '#fecaca', dot: '#dc2626' },
  checking: { label: 'Checking', bg: '#fef3c7', fg: '#92400e', border: '#fde68a', dot: '#f59e0b' },
};

export interface ContractStatusBadgeProps {
  status: ContractHealth;
  label?: string;
  detail?: string;
  className?: string;
}

/** Presentational badge. Exported separately so it can be rendered without an event stream. */
export function ContractStatusBadge({ status, label, detail, className = '' }: ContractStatusBadgeProps) {
  const theme = THEMES[status];
  return (
    <span
      role="status"
      aria-label={`Contract status: ${label ?? theme.label}`}
      data-status={status}
      className={['contract-status-indicator', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '9999px',
        border: `1px solid ${theme.border}`,
        background: theme.bg,
        color: theme.fg,
        fontSize: '12px',
        fontWeight: 700,
        lineHeight: 1.25,
      }}
    >
      <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.dot }} />
      <span>{label ?? theme.label}</span>
      {detail ? <span style={{ fontWeight: 500 }}>({detail})</span> : null}
    </span>
  );
}

export interface ContractStatusIndicatorProps {
  contractId?: string;
  className?: string;
  /** Overrides the 60s staleness window used to ignore old events. */
  staleAfterMs?: number;
}

/** Live contract health badge fed by the Horizon-backed contract event stream (#1259). */
export default function ContractStatusIndicator({
  contractId,
  className,
  staleAfterMs,
}: ContractStatusIndicatorProps) {
  const { connected, error, events } = useContractEvents({ contractId });
  const status = useMemo(
    () => deriveContractHealth({ connected, error, events, staleAfterMs }),
    [connected, error, events, staleAfterMs],
  );

  return (
    <ContractStatusBadge
      status={status}
      detail={status === 'unhealthy' ? error ?? undefined : undefined}
      className={className}
    />
  );
}
