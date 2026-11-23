import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import {
  ContractStatusBadge,
  deriveContractHealth,
  type ContractHealthInput,
} from '../ContractStatusIndicator';

const NOW = 1_000_000;

const base = (overrides: Partial<ContractHealthInput> = {}): ContractHealthInput => ({
  connected: false,
  error: null,
  events: [],
  now: NOW,
  staleAfterMs: 60_000,
  ...overrides,
});

describe('deriveContractHealth', () => {
  it('is checking before the stream reports in', () => {
    expect(deriveContractHealth(base())).toBe('checking');
  });

  it('is healthy when the event stream is connected', () => {
    expect(deriveContractHealth(base({ connected: true }))).toBe('healthy');
  });

  it('is healthy on recent successful activity even without a live stream', () => {
    expect(
      deriveContractHealth(
        base({ events: [{ type: 'identity_created', timestamp: new Date(NOW - 1000).toISOString() }] }),
      ),
    ).toBe('healthy');
  });

  it('is unhealthy on a stream error', () => {
    expect(deriveContractHealth(base({ error: 'Event stream disconnected' }))).toBe('unhealthy');
  });

  it('is unhealthy on a recent failure event, taking precedence over connection', () => {
    expect(
      deriveContractHealth(
        base({
          connected: true,
          events: [{ type: 'contract_error', timestamp: new Date(NOW - 1000).toISOString() }],
        }),
      ),
    ).toBe('unhealthy');
  });

  it('ignores stale failure events', () => {
    expect(
      deriveContractHealth(
        base({ events: [{ type: 'contract_error', timestamp: new Date(NOW - 120_000).toISOString() }] }),
      ),
    ).toBe('checking');
  });

  it('treats events with an unparseable timestamp as recent', () => {
    expect(
      deriveContractHealth(base({ events: [{ type: 'contract_failed', timestamp: 'not-a-date' }] })),
    ).toBe('unhealthy');
  });
});

describe('ContractStatusBadge', () => {
  it('renders a green healthy badge with an accessible status', () => {
    render(<ContractStatusBadge status="healthy" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('data-status', 'healthy');
    expect(badge).toHaveTextContent('Healthy');
    expect(badge).toHaveAttribute('aria-label', 'Contract status: Healthy');
  });

  it('renders a red unhealthy badge with the failure detail', () => {
    render(<ContractStatusBadge status="unhealthy" detail="disconnected" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('data-status', 'unhealthy');
    expect(badge).toHaveTextContent('Unhealthy');
    expect(badge).toHaveTextContent('disconnected');
  });
});
