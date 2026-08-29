# CLI Capability Manifest — sched

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `sched:eval`

Calculate anti-idle scheduling intervals.

Computes anti-idle sleep and rollover intervals based on work status, rate limiting, and backoff streak.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--pending-work` | bool | no | no | - | Indicates pending work in queue. |
| `--has-pending-work` | bool | no | no | - | Alias for pending work. |
| `--active` | bool | no | no | - | Indicates active work running. |
| `--streak` | int | no | no | - | Zero-value streak count. |
| `--zero-value-streak` | int | no | no | - | Alias for streak. |
| `--retry-after` | int | no | no | - | Retry-After interval in milliseconds. |
| `--retry-after-ms` | int | no | no | - | Alias for retry-after. |
| `--base-interval` | int | no | no | - | Base interval in milliseconds. |
| `--base-interval-ms` | int | no | no | - | Alias for base-interval. |
| `--max-interval` | int | no | no | - | Maximum interval in milliseconds. |
| `--max-interval-ms` | int | no | no | - | Alias for max-interval. |
| `--max-pause-interval` | int | no | no | - | Maximum pause interval in milliseconds. |
| `--max-pause-interval-ms` | int | no | no | - | Alias for max-pause-interval. |
| `--rate-limited` | bool | no | no | - | Indicates active rate limit. |
| `--is-rate-limited` | bool | no | no | - | Alias for rate-limited. |
| `--previous-interval` | int | no | no | - | Previous interval in milliseconds. |
| `--previous-interval-ms` | int | no | no | - | Alias for previous-interval. |
| `--jitter` | bool | no | no | - | Apply random jitter. |
| `--apply-jitter` | bool | no | no | - | Alias for jitter. |
| `--jitter-ratio` | string | no | no | - | Jitter ratio fraction. |
| `--multiplier` | string | no | no | - | Exponential backoff multiplier. |

```bash
bun harness.ts sched:eval --streak 2
```

### `sched:backoff`

Calculate backoff interval using specified strategy.

Computes interval delay using exponential, linear, fibonacci, or fixed backoff strategies.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--base-interval` | int | no | no | - | Base interval in milliseconds. |
| `--base-interval-ms` | int | no | no | - | Alias for base-interval. |
| `--max-interval` | int | no | no | - | Maximum interval in milliseconds. |
| `--max-interval-ms` | int | no | no | - | Alias for max-interval. |
| `--streak` | int | no | no | - | Consecutive streak count. |
| `--strategy` | string | no | no | - | Backoff strategy (exponential, linear, fibonacci, fixed, immediate). |
| `--multiplier` | string | no | no | - | Backoff multiplier factor. |

```bash
bun harness.ts sched:backoff --streak 3 --strategy exponential
```

### `sched:jitter`

Apply interval jitter to a base duration.

Calculates randomized or deterministic interval with bounded jitter ratio.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--interval` | int | no | no | - | Base interval in milliseconds. |
| `--interval-ms` | int | no | no | - | Alias for interval. |
| `--raw-interval-ms` | int | no | no | - | Alias for interval. |
| `--jitter-ratio` | string | no | no | - | Target jitter ratio. |
| `--min-ratio` | string | no | no | - | Minimum jitter ratio. |
| `--max-ratio` | string | no | no | - | Maximum jitter ratio. |
| `--min-interval` | int | no | no | - | Minimum interval clamp in milliseconds. |
| `--min-interval-ms` | int | no | no | - | Alias for min-interval. |
| `--max-interval` | int | no | no | - | Maximum interval clamp in milliseconds. |
| `--max-interval-ms` | int | no | no | - | Alias for max-interval. |
| `--seed` | int | no | no | - | Deterministic seed value. |

```bash
bun harness.ts sched:jitter --interval 5000 --seed 42
```
