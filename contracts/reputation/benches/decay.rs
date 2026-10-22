//! Gas-budget benchmark for each #815 decay curve.
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use reputation::{calculate_decay, DecayParameters};
use soroban_sdk::Env;

fn bench_decay(c: &mut Criterion) {
    let mut group = c.benchmark_group("reputation_decay");
    let cases = [
        ("linear", DecayParameters::linear(1_000, 86_400)),
        ("exponential", DecayParameters::exponential(86_400)),
        ("step_function", DecayParameters::step(1_000, 86_400)),
        ("none", DecayParameters::none()),
    ];
    let env = Env::default();
    for (name, params) in cases {
        group.bench_function(name, |b| {
            b.iter(|| black_box(calculate_decay(10_000, 30 * 86_400, &params)))
        });
    }
    group.finish();
    for (name, params) in cases {
        env.budget().reset_default();
        black_box(calculate_decay(10_000, 30 * 86_400, &params));
        println!(
            "[budget] {name}: cpu_insns={} mem_bytes={}",
            env.budget().cpu_instruction_cost(),
            env.budget().memory_bytes_cost()
        );
    }
}

criterion_group!(benches, bench_decay);
criterion_main!(benches);
