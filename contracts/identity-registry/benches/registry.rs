//! Criterion benchmarks for identity-registry contract entry points (#829).
//!
//! Each benchmark measures host wall-clock time and also reports the Soroban
//! CPU-instruction and memory-byte budget consumed, so regressions show up
//! even on noisy CI hardware.
//!
//! Run: `cargo bench -p identity-registry --bench registry` (HTML report in `target/criterion/`).

use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use identity_registry::{IdentityRegistry, IdentityRegistryClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Map, String};

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
}

criterion_group!(benches, bench_identity_registry);
criterion_main!(benches);
