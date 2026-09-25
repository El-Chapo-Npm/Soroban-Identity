# Documentation style guide

Public APIs must explain intent, inputs, outputs, failure modes, and a minimal usage example. Write for an engineer who knows TypeScript or Rust but has not read the implementation.

## TypeScript

Use TSDoc on exported functions, classes, interfaces, and type aliases. Every parameter and non-trivial return value must be described. Link related concepts with `{@link Symbol}` and keep examples executable where possible.

```ts
/**
 * Fetches an identity by its DID.
 *
 * @param did - Fully qualified `did:stellar:` identifier.
 * @returns The identity record, or `undefined` when it is not registered.
 * @throws {NetworkError} When the RPC request cannot be completed.
 * @example
 * ```ts
 * const identity = await client.identity.get('did:stellar:test:123')
 * ```
 */
export async function getIdentity(did: string): Promise<Identity | undefined> {
  // ...
}
```

## Rust

Use Rustdoc on every public item. Describe authorization requirements, storage effects, events, and error conditions for contract methods. Examples should use `no_run` when they require a live network.

```rust
/// Registers an identity for `owner`.
///
/// The owner must authorize the call. A duplicate registration returns
/// [`Error::AlreadyRegistered`] without modifying storage.
///
/// # Errors
///
/// Returns [`Error::InvalidDid`] when the DID is malformed.
///
/// # Examples
///
/// ```no_run
/// client.register(&owner, &did);
/// ```
///
/// [`Error::AlreadyRegistered`]: crate::Error::AlreadyRegistered
/// [`Error::InvalidDid`]: crate::Error::InvalidDid
pub fn register(&self, owner: Address, did: String) -> Result<(), Error> {
    // ...
}
```

## CI and generated references

Run `npm run docs:api --prefix docs` for the TypeScript reference and `cargo doc --workspace --no-deps` for Rust. CI rejects undocumented exported TypeScript declarations and fails on Rustdoc warnings. The generated HTML is published from the `docs` artifact by the documentation workflow; Algolia indexing is configured separately by the repository owner because it requires an application ID and write-restricted crawler key.
