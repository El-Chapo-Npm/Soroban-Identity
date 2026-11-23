# Reputation score decay

Reputation scores remain stored as their raw accumulated value. `get_reputation`
(and `preview_reputation`) calculate a view-time score from the raw value and
the elapsed time since `updated_at`; reads never destroy score history.

An administrator can configure a curve for an individual subject with
`set_decay_algorithm(admin, subject, DecayParameters)`. The subject curve takes
precedence over the older global/reporter decay settings. `None` is an explicit
identity curve. Parameters are integer-safe and scores are rounded down and
clamped to zero.

## Curves and formulas

Let `S` be the raw score, `t` the elapsed seconds, and `B = 10,000` basis
points (100%). Only complete intervals are applied.

- **None:** `score(t) = S`.
- **Linear:** with `n = floor(t / period_secs)` and rate `r` in basis points,
  `score(t) = max(0, S - floor(S × min(n × r, B) / B))`. The reduction is
  relative to the original score and reaches zero at 100% total reduction.
- **Exponential:** with `n = floor(t / half_life_secs)`,
  `score(t) = floor(S / 2^n)`. A half-life is the number of seconds required
  for one additional half of the current score to disappear.
- **StepFunction:** with `n = floor(t / step_size_secs)` and rate `r`,
  `score(t) = floor(S × (1 - r/B)^n)`, applying one compounding reduction at
  each step boundary.

To keep view calls bounded, at most 3,650 intervals are evaluated. Invalid
periods, step sizes, half-lives, or rates above 10,000 are rejected with
`InvalidDecayParameters`.

## Preview and calculation timestamp

`preview_reputation(subject, future_timestamp)` evaluates a future timestamp
without writing storage. `get_reputation(subject)` records the timestamp of
that calculation in a subject-scoped persistent value returned by
`get_last_calculation_time(subject)`. A new score submission resets the cache
implicitly because its `updated_at` becomes the new calculation origin.

## Events and benchmarking

A successful subject configuration emits topic `SUBDECAY,updated` with payload
`[event_version, admin, subject, parameters]`. The Criterion benchmark
`contracts/reputation/benches/decay.rs` measures all four curve calculations;
run it with:

```sh
cargo bench -p reputation --bench decay
```
