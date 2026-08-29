# CLI Capability Manifest — orchestrator

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `orchestrator:run`

Run the autonomous coordination loop over a fresh capsule.

Drives plan, execute, validate and critic rounds until the critic approves or the round budget is spent. The host must inject a round executor; without one the command fails with INVALID_STATE.

- **Aliases**: none
- **Stdin**: reads stdin when `--prompt-stdin` is set
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root; falls back to the current directory. |
| `--prompt` | string | no | no | - | Inline prompt text. |
| `--prompt-file` | string | no | no | - | File holding the prompt. |
| `--prompt-stdin` | bool | no | no | - | Read the prompt from stdin. |
| `--run-id` | string | no | no | - | Base run id for the generated capsules. |
| `--run` | string | no | no | - | Alias of --run-id. |
| `--capsules-dir` | string | no | no | - | Directory that holds the capsules. |
| `--max-rounds` | int | no | no | `10` | Round budget, clamped to 1-10. |
| `--actor` | string | no | no | - | Actor recorded on the loop summary; omitted leaves the loop unattributed. |

```bash
bun harness.ts orchestrator:run --repo . --prompt "Implement the feature" --max-rounds 3
```

### `orchestrator:supervise`

Reclaim dead agents, escalate dead-end tasks, and dispatch what's ready (B28).

One reclaim-classify-dispatch pass over a run's eligible set: reclaims leases whose agent died without submitting, escalates tasks whose failures have become deterministic (B28.3) instead of retrying them forever, and reports what is safe to dispatch now versus still backing off. With a host-injected dispatcher it loops until the run reaches a terminal state; without one it performs a single pass, which is what makes it safe to drive from an external poll loop. Recovery is on by default (B28.5) - use --no-recover to disable it. --watch turns this into the poll loop itself: it re-runs the reclaim/escalate heartbeat every --interval seconds until the run goes terminal or the process gets an explicit stop (Ctrl-C / SIGTERM), surfacing changes_requested tasks awaiting a repairer alongside the escalated ones so a rejected task is never silently invisible.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the supervisor. Recorded on every event; there is no default actor. |
| `--max-parallel` | int | no | no | - | Occupancy ceiling; falls back to the run's configured default. |
| `--gate-max-parallel` | int | no | no | - | B27.2: the separate, lower ceiling for gate-running (CPU-bound) work, reported alongside --max-parallel; falls back to the run's configured default (derived from host cores). |
| `--no-recover` | bool | no | no | - | Disable automatic dead-agent reclaim and escalation (on by default). |
| `--grace-seconds` | int | no | no | - | Grace period past lease expiry before reclaiming, 0-86400. |
| `--poll-interval-ms` | int | no | no | - | How often to re-tick while a dispatcher is driving the loop. |
| `--max-elapsed-ms` | int | no | no | - | Per-task retry budget before a transient failure reads as deterministic (B28.3). |
| `--max-total-elapsed-ms` | int | no | no | - | Whole-run wall-clock budget before the supervisor stops and reports. |
| `--deterministic-repeat-threshold` | int | no | no | - | Consecutive identical failures before they read as deterministic. |
| `--watch` | bool | no | no | - | Run unattended: re-tick the reclaim/escalate heartbeat every --interval seconds until the run is terminal or the process gets an explicit stop (Ctrl-C / SIGTERM). Ignores any host-injected dispatcher - this is the recovery heartbeat, not a dispatch loop. |
| `--interval` | int | no | no | `30` | Seconds between heartbeat ticks in --watch mode; refused without --watch. |

```bash
bun harness.ts orchestrator:supervise --run .olt/capsules/<run-id> --actor coordinator
bun harness.ts orchestrator:supervise --run .olt/capsules/<run-id> --actor coordinator --watch --interval 30
```
