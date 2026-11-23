import React, { useMemo, useState } from 'react';

export type IdentityStatus = 'active' | 'suspended';

export interface ManagedIdentity {
  id: string;
  did: string;
  owner: string;
  label: string;
  status: IdentityStatus;
  createdAt: string;
}

export interface AdminIdentityTableProps {
  initialIdentities?: ManagedIdentity[];
  /** Called with the full list after every create, update, suspend or delete. */
  onChange?: (identities: ManagedIdentity[]) => void;
  className?: string;
}

/** Case-insensitive filter over the DID, label and owner fields. */
export function filterIdentities(identities: ManagedIdentity[], query: string): ManagedIdentity[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return identities;
  return identities.filter((identity) =>
    [identity.did, identity.label, identity.owner].some((field) => field.toLowerCase().includes(needle)),
  );
}

type EditDraft = { label: string; owner: string };
type NewDraft = { did: string; owner: string; label: string };

const EMPTY_EDIT: EditDraft = { label: '', owner: '' };
const EMPTY_NEW: NewDraft = { did: '', owner: '', label: '' };

/** Admin CRUD table for viewing, editing and suspending managed identities (#1262). */
export default function AdminIdentityTable({
  initialIdentities = [],
  onChange,
  className = '',
}: AdminIdentityTableProps) {
  const [identities, setIdentities] = useState<ManagedIdentity[]>(initialIdentities);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(EMPTY_EDIT);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<NewDraft>(EMPTY_NEW);

  const visible = useMemo(() => filterIdentities(identities, query), [identities, query]);

  const commit = (next: ManagedIdentity[]) => {
    setIdentities(next);
    onChange?.(next);
  };

  const startEdit = (identity: ManagedIdentity) => {
    setEditingId(identity.id);
    setEditDraft({ label: identity.label, owner: identity.owner });
  };

  const saveEdit = (id: string) => {
    commit(
      identities.map((identity) =>
        identity.id === id
          ? { ...identity, label: editDraft.label.trim(), owner: editDraft.owner.trim() }
          : identity,
      ),
    );
    setEditingId(null);
    setEditDraft(EMPTY_EDIT);
  };

  const toggleStatus = (id: string) => {
    commit(
      identities.map((identity) =>
        identity.id === id
          ? {
              ...identity,
              status: identity.status === 'active' ? 'suspended' : 'active',
            }
          : identity,
      ),
    );
  };

  const removeIdentity = (id: string) => {
    if (editingId === id) {
      setEditingId(null);
      setEditDraft(EMPTY_EDIT);
    }
    commit(identities.filter((identity) => identity.id !== id));
  };

  const addIdentity = () => {
    const did = newDraft.did.trim();
    const owner = newDraft.owner.trim();
    if (!did || !owner) return;
    const identity: ManagedIdentity = {
      id: `${Date.now()}-${did}`,
      did,
      owner,
      label: newDraft.label.trim() || did,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    commit([identity, ...identities]);
    setNewDraft(EMPTY_NEW);
    setAdding(false);
  };

  return (
    <section className={['admin-identity-table', className].filter(Boolean).join(' ')} aria-label="Identity management">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search identities"
          aria-label="Search identities"
        />
        <button type="button" onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
          {adding ? 'Cancel' : 'Add identity'}
        </button>
      </div>

      {adding ? (
        <div className="admin-identity-add" role="group" aria-label="New identity" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input
            value={newDraft.did}
            onChange={(event) => setNewDraft({ ...newDraft, did: event.target.value })}
            placeholder="DID"
            aria-label="New identity DID"
          />
          <input
            value={newDraft.owner}
            onChange={(event) => setNewDraft({ ...newDraft, owner: event.target.value })}
            placeholder="Owner"
            aria-label="New identity owner"
          />
          <input
            value={newDraft.label}
            onChange={(event) => setNewDraft({ ...newDraft, label: event.target.value })}
            placeholder="Label (optional)"
            aria-label="New identity label"
          />
          <button type="button" onClick={addIdentity} disabled={!newDraft.did.trim() || !newDraft.owner.trim()}>
            Save identity
          </button>
        </div>
      ) : null}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th scope="col">Identity</th>
            <th scope="col">Owner</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={5}>No identities to manage.</td>
            </tr>
          ) : (
            visible.map((identity) => (
              <tr key={identity.id}>
                <td>
                  {editingId === identity.id ? (
                    <input
                      value={editDraft.label}
                      onChange={(event) => setEditDraft({ ...editDraft, label: event.target.value })}
                      aria-label={`Edit label for ${identity.did}`}
                    />
                  ) : (
                    <>
                      <strong>{identity.label}</strong>
                      <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>{identity.did}</div>
                    </>
                  )}
                </td>
                <td>
                  {editingId === identity.id ? (
                    <input
                      value={editDraft.owner}
                      onChange={(event) => setEditDraft({ ...editDraft, owner: event.target.value })}
                      aria-label={`Edit owner for ${identity.did}`}
                    />
                  ) : (
                    identity.owner
                  )}
                </td>
                <td>
                  <span data-status={identity.status}>{identity.status}</span>
                </td>
                <td>{identity.createdAt}</td>
                <td>
                  {editingId === identity.id ? (
                    <>
                      <button type="button" onClick={() => saveEdit(identity.id)}>Save</button>
                      <button type="button" onClick={() => { setEditingId(null); setEditDraft(EMPTY_EDIT); }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => startEdit(identity)}>Edit</button>
                      <button type="button" onClick={() => toggleStatus(identity.id)}>
                        {identity.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                      <button type="button" onClick={() => removeIdentity(identity.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
