'use strict';

class DuplicateKeyError extends Error {
  constructor(id) {
    super(`Credential with ID "${id}" already exists`);
    this.name = 'DuplicateKeyError';
    this.id = id;
  }
}

class CredentialStore {
  constructor() {
    this._store = new Map();
  }

  add(credential) {
    if (this._store.has(credential.id)) {
      throw new DuplicateKeyError(credential.id);
    }
    this._store.set(credential.id, { ...credential });
  }

  get(id) {
    return this._store.get(id) ?? null;
  }

  delete(id) {
    return this._store.delete(id);
  }

  has(id) {
    return this._store.has(id);
  }
}

module.exports = { CredentialStore, DuplicateKeyError };
