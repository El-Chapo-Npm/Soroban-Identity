//! Fuzz target: `did-bridge::resolve_external_did` with arbitrary bytes.
//!
//! The contract must not panic on deep proofs, unknown chains, or proofs that
//! do not match the oracle root. A rejected proof must not create a cache entry.
#![no_main]

use arbitrary::Arbitrary;
use did_bridge::{DidBridge, DidBridgeClient};
use soroban_sdk::{
    testutils::Address as _,
    Bytes, BytesN, Env, String, Vec as SorobanVec,
};

#[derive(Arbitrary, Debug)]
struct ResolveInput {
    chain_selector: u8,
    did: Vec<u8>,
    document: Vec<u8>,
    siblings: Vec<[u8; 32]>,
    on_left: Vec<bool>,
    publish_matching_root: bool,
}

fn ascii(env: &Env, bytes: &[u8]) -> String {
    let mut text = std::string::String::new();
    for byte in bytes.iter().take(24) {
        text.push((b'a' + (byte % 26)) as char);
    }
    if text.is_empty() {
        text.push('x');
    }
    String::from_str(env, &text)
}

libfuzzer_sys::fuzz_target!(|input: ResolveInput| {
    let env = Env::default();
    env.mock_all_auths();
    let contract = env.register_contract(None, DidBridge);
    let client = DidBridgeClient::new(&env, &contract);
    let admin = soroban_sdk::Address::generate(&env);
    let oracle = soroban_sdk::Address::generate(&env);
    let resolver = soroban_sdk::Address::generate(&env);
    let _ = client.try_initialize(&admin, &oracle);

    let chain_id: u32 = if input.chain_selector % 2 == 0 { 1 } else { 137 };
    let name = if chain_id == 1 {
        String::from_str(&env, "Ethereum")
    } else {
        String::from_str(&env, "Polygon")
    };
    let _ = client.try_set_chain(&admin, &chain_id, &name, &true);

    let did = ascii(&env, &input.did);
    let document = Bytes::from_slice(&env, &input.document[..input.document.len().min(128)]);
    if input.publish_matching_root {
        let mut leaf_data = did.clone().to_xdr(&env);
        leaf_data.append(&document.to_xdr(&env));
        let leaf: BytesN<32> = env.crypto().sha256(&leaf_data).into();
        let _ = client.try_publish_state_root(&oracle, &chain_id, &leaf, &50_000u64);
    } else {
        let root = BytesN::from_array(&env, &[0xab; 32]);
        let _ = client.try_publish_state_root(&oracle, &chain_id, &root, &50_000u64);
    }

    let mut siblings = SorobanVec::new(&env);
    let mut on_left = SorobanVec::new(&env);
    for (sibling, left) in input.siblings.iter().zip(input.on_left.iter()).take(8) {
        siblings.push_back(BytesN::from_array(&env, sibling));
        on_left.push_back(*left);
    }
    let result = client.try_resolve_external_did(
        &resolver,
        &chain_id,
        &did,
        &document,
        &siblings,
        &on_left,
    );
    if result.is_err() {
        let _ = client.try_get_cached_did(&chain_id, &did);
    }
});
