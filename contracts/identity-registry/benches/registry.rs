//! Criterion benchmarks for identity-registry contract entry points (#829).
//!
//! Each benchmark measures host wall-clock time and also reports the Soroban
//! CPU-instruction and memory-byte budget consumed, so regressions show up
//! even on noisy CI hardware.
//!
//! Run: `cargo bench -p identity-registry --bench registry` (HTML report in `target/criterion/`).

use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use identity_registry::{IdentityRegistry, IdentityRegistryClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Map, String,
};

fn setup() -> (Env, IdentityRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();
    let id = env.register_contract(None, IdentityRegistry);
    let client = IdentityRegistryClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

fn metadata(env: &Env) -> Map<String, String> {
    let mut m = Map::new(env);
    m.set(String::from_str(env, "name"), String::from_str(env, "bench"));
    m
}

/// Print Soroban resource usage for one invocation of `f`.
fn report_budget(name: &str, f: impl FnOnce(&Env, &IdentityRegistryClient<'static>)) {
    let (env, client, _) = setup();
    env.budget().reset_default();
    f(&env, &client);
    println!(
        "[budget] {name}: cpu_insns={} mem_bytes={}",
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost()
    );
}

/// Print Soroban resource usage for reading an existing DID some ledgers
/// after it was written: the steady state of a hot entry (#866).
fn report_read_budget(name: &str, f: impl FnOnce(&IdentityRegistryClient<'static>, &Address)) {
    let (env, client, _) = setup();
    let controller = Address::generate(&env);
    client.create_did(&controller, &metadata(&env));
    env.as_contract(&client.address, || {
        env.storage().instance().extend_ttl(6_000_000, 6_000_000)
    });
    env.ledger().with_mut(|li| li.sequence_number += 100);
    env.budget().reset_default();
    f(&client, &controller);
    println!(
        "[budget] {name}: cpu_insns={} mem_bytes={}",
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost()
    );
}

fn bench_identity_registry(c: &mut Criterion) {
    let mut g = c.benchmark_group("identity_registry");

    g.bench_function("create_did", |b| {
        b.iter_batched(
            setup,
            |(env, client, _)| {
                let controller = Address::generate(&env);
                black_box(client.create_did(&controller, &metadata(&env)));
            },
            BatchSize::SmallInput,
        )
    });

    g.bench_function("update_did", |b| {
        b.iter_batched(
            || {
                let (env, client, admin) = setup();
                let controller = Address::generate(&env);
                client.create_did(&controller, &metadata(&env));
                (env, client, admin, controller)
            },
            |(env, client, _, controller)| client.update_did(&controller, &metadata(&env)),
            BatchSize::SmallInput,
        )
    });

    g.bench_function("resolve_did", |b| {
        let (env, client, _) = setup();
        let controller = Address::generate(&env);
        client.create_did(&controller, &metadata(&env));
        b.iter(|| black_box(client.resolve_did(&controller)))
    });

    g.bench_function("has_active_did", |b| {
        let (env, client, _) = setup();
        let controller = Address::generate(&env);
        client.create_did(&controller, &metadata(&env));
        b.iter(|| black_box(client.has_active_did(&controller)))
    });

    g.bench_function("deactivate_did", |b| {
        b.iter_batched(
            || {
                let (env, client, admin) = setup();
                let controller = Address::generate(&env);
                client.create_did(&controller, &metadata(&env));
                (env, client, admin, controller)
            },
            |(_env, client, _, controller)| client.deactivate_did(&controller),
            BatchSize::SmallInput,
        )
    });

    g.bench_function("get_did_count", |b| {
        let (_env, client, _) = setup();
        b.iter(|| black_box(client.get_did_count()))
    });

    g.finish();

    report_budget("create_did", |env, client| {
        client.create_did(&Address::generate(env), &metadata(env));
    });
    report_budget("resolve_did", |env, client| {
        let controller = Address::generate(env);
        client.create_did(&controller, &metadata(env));
        client.resolve_did(&controller);
    });
    report_read_budget("resolve_did (100 ledgers later)", |client, controller| {
        client.resolve_did(controller);
    });
    report_read_budget("has_active_did (100 ledgers later)", |client, controller| {
        client.has_active_did(controller);
    });
    report_read_budget("update_did (100 ledgers later)", |client, controller| {
        let env = client.env.clone();
        client.update_did(controller, &metadata(&env));
    });
}

fn bench_recovery(c: &mut Criterion) {
    let mut g = c.benchmark_group("identity_registry_recovery");

    g.bench_function("set_recovery_address", |b| {
        b.iter_batched(
            || {
                let (env, client, admin) = setup();
                let controller = Address::generate(&env);
                client.create_did(&controller, &metadata(&env));
                let recovery = Address::generate(&env);
                (env, client, admin, controller, recovery)
            },
            |(_, client, _, controller, recovery)| {
                black_box(client.set_recovery_address(&controller, &recovery))
            },
            BatchSize::SmallInput,
        )
    });

    g.bench_function("initiate_recovery", |b| {
        b.iter_batched(
            || {
                let (env, client, admin) = setup();
                let controller = Address::generate(&env);
                client.create_did(&controller, &metadata(&env));
                let recovery = Address::generate(&env);
                client.set_recovery_address(&controller, &recovery);
                let new_controller = Address::generate(&env);
                (env, client, admin, controller, recovery, new_controller)
            },
            |(_, client, _, controller, recovery, new_controller)| {
                black_box(client.initiate_recovery(&recovery, &controller, &new_controller))
            },
            BatchSize::SmallInput,
        )
    });

    g.bench_function("recover_did", |b| {
        b.iter_batched(
            || {
                let (env, client, admin) = setup();
                let controller = Address::generate(&env);
                client.create_did(&controller, &metadata(&env));
                let recovery = Address::generate(&env);
                client.set_recovery_address(&controller, &recovery);
                let new_controller = Address::generate(&env);
                client.initiate_recovery(&recovery, &controller, &new_controller);
                use soroban_sdk::testutils::Ledger as _;
                env.ledger().with_mut(|li| {
                    li.sequence_number += identity_registry::recovery::RECOVERY_TIMELOCK_LEDGERS + 1;
                });
                (env, client, admin, controller, recovery)
            },
            |(_, client, _, controller, recovery)| {
                black_box(client.recover_did(&recovery, &controller))
            },
            BatchSize::SmallInput,
        )
    });

    g.finish();

    report_budget("set_recovery_address", |env, client| {
        let controller = Address::generate(env);
        client.create_did(&controller, &metadata(env));
        let recovery = Address::generate(env);
        client.set_recovery_address(&controller, &recovery);
    });
    report_budget("initiate_recovery", |env, client| {
        let controller = Address::generate(env);
        client.create_did(&controller, &metadata(env));
        let recovery = Address::generate(env);
        client.set_recovery_address(&controller, &recovery);
        let new_controller = Address::generate(env);
        client.initiate_recovery(&recovery, &controller, &new_controller);
    });
    report_budget("recover_did", |env, client| {
        let controller = Address::generate(env);
        client.create_did(&controller, &metadata(env));
        let recovery = Address::generate(env);
        client.set_recovery_address(&controller, &recovery);
        let new_controller = Address::generate(env);
        client.initiate_recovery(&recovery, &controller, &new_controller);
        use soroban_sdk::testutils::Ledger as _;
        env.ledger().with_mut(|li| {
            li.sequence_number += identity_registry::recovery::RECOVERY_TIMELOCK_LEDGERS + 1;
        });
        client.recover_did(&recovery, &controller);
    });
}

criterion_group!(benches, bench_identity_registry, bench_recovery);
criterion_main!(benches);
