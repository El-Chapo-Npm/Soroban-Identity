import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import AdminIdentityTable, {
  filterIdentities,
  type ManagedIdentity,
} from '../AdminIdentityTable';

const SAMPLE: ManagedIdentity[] = [
  {
    id: '1',
    did: 'did:stellar:alice',
    owner: 'GALICE',
    label: 'Alice',
    status: 'active',
    createdAt: '2026-01-01',
  },
  {
    id: '2',
    did: 'did:stellar:bob',
    owner: 'GBOB',
    label: 'Bob',
    status: 'suspended',
    createdAt: '2026-01-02',
  },
];

describe('filterIdentities', () => {
  it('matches DID, label and owner case-insensitively', () => {
    expect(filterIdentities(SAMPLE, 'BOB')).toHaveLength(1);
    expect(filterIdentities(SAMPLE, 'galice')).toHaveLength(1);
    expect(filterIdentities(SAMPLE, 'stellar:alice')).toHaveLength(1);
    expect(filterIdentities(SAMPLE, '')).toHaveLength(2);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterIdentities(SAMPLE, 'nobody')).toEqual([]);
  });
});

describe('AdminIdentityTable', () => {
  it('renders a row per identity with its status', () => {
    render(<AdminIdentityTable initialIdentities={SAMPLE} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getAllByText('active')).toHaveLength(1);
    expect(screen.getAllByText('suspended')).toHaveLength(1);
  });

  it('shows an empty state when there are no identities', () => {
    render(<AdminIdentityTable />);
    expect(screen.getByText('No identities to manage.')).toBeInTheDocument();
  });

  it('filters identities by search text', async () => {
    const user = userEvent.setup();
    render(<AdminIdentityTable initialIdentities={SAMPLE} />);
    await user.type(screen.getByLabelText('Search identities'), 'bob');
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('edits an identity and reports the change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdminIdentityTable initialIdentities={SAMPLE} onChange={onChange} />);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const labelInput = screen.getByLabelText('Edit label for did:stellar:alice');
    await user.clear(labelInput);
    await user.type(labelInput, 'Alicia');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Alicia')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ label: 'Alicia', owner: 'GALICE' });
  });

  it('suspends and reactivates an identity', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdminIdentityTable initialIdentities={SAMPLE} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ status: 'suspended' });

    await user.click(screen.getAllByRole('button', { name: 'Activate' })[0]);
    expect(onChange.mock.calls[1][0][0]).toMatchObject({ status: 'active' });
  });

  it('deletes an identity', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdminIdentityTable initialIdentities={SAMPLE} onChange={onChange} />);

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it('creates a new active identity', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdminIdentityTable initialIdentities={SAMPLE} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add identity' }));
    await user.type(screen.getByLabelText('New identity DID'), 'did:stellar:carol');
    await user.type(screen.getByLabelText('New identity owner'), 'GCAROL');
    await user.click(screen.getByRole('button', { name: 'Save identity' }));

    expect(screen.getAllByText('did:stellar:carol')).not.toHaveLength(0);
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ did: 'did:stellar:carol', status: 'active' });
  });
});
