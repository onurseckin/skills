# CLI Capability Manifest — authority

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `authority:decide`

Grant or decline a needs_authority requirement.

A requirement disposed needs_authority holds every task built on it non-executable until this is recorded. Granting makes it actionable; declining disposes it out_of_scope and cancels every dormant task that depends on it alone, refusing instead if that would invalidate an active or completed one.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--requirement` | string | yes | no | - | Requirement id, currently disposed needs_authority. |
| `--actor` | string | yes | no | - | Who is making the decision. |
| `--decision` | string | yes | no | - | grant or decline. |
| `--rationale` | string | yes | no | - | Why this decision is correct. |

```bash
bun harness.ts authority:decide --run .olt/capsules/<run-id> --requirement req-prod-deploy --actor coordinator --decision grant --rationale "Approved"
```

### `whoami`

Inspect thread execution tier, PID, active agent, grants, and main-thread compliance.

Inspects the calling thread's OS process ID, parent PID, execution tier, active agent ID, active role grants, and task leases.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root to cross-reference active leases and grants. |
| `--agent` | string | no | no | - | Explicit agent id override to inspect. |
| `--role` | string | no | no | - | Explicit role override to inspect. |
| `--tier` | string | no | no | - | Explicit execution tier override to inspect. |
| `--pid` | int | no | no | - | Process ID override for testing. |
| `--ppid` | int | no | no | - | Parent Process ID override for testing. |

```bash
bun harness.ts whoami
bun harness.ts whoami --run .olt/capsules/<run-id> --agent coordinator-lead
```

### `watchdog:status`

Query watchdog lifecycle, monitor cadence, and health status.

Inspects background watchdog monitors across runs and generations, reporting active, stale, terminated, and orphaned monitors.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--generation` | int | no | no | - | Filter by mind generation. |
| `--pulse-id` | string | no | no | - | Filter by pulse ID. |
| `--phase` | string | no | no | - | Filter by execution phase. |
| `--filter-status` | string | no | no | - | Filter by status: active, stale, terminated, orphaned, all. |
| `--max-age-ms` | int | no | no | - | Maximum age in milliseconds. |
| `--dry-run` | bool | no | no | - | Simulate cleanup without disk mutation. |
| `--all` | bool | no | no | - | Show all watchdog monitors. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts watchdog:status
bun harness.ts watchdog:status --generation 1 --filter-status active
```

### `watchdog:cleanup`

Purge stale or legacy watchdog monitors exceeding heartbeat timeout.

Scans registered watchdog monitors across generations and pulses, transitioning timed-out monitors to stale or terminated status.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--authority-run` | string | yes | no | - | Capsule run whose active Mind grant authorizes this mutation. |
| `--run` | string | yes | no | - | Target watchdog run root to clean; may equal --authority-run. |
| `--actor` | string | no | no | - | Explicit acting Mind identity; must match the verified session when supplied. |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--generation` | int | no | no | - | Target generation. |
| `--pulse-id` | string | no | no | - | Target pulse ID. |
| `--phase` | string | no | no | - | Target phase to clean up. |
| `--max-age-ms` | int | no | no | - | Maximum age before considered stale. |
| `--mark-as` | string | no | no | - | Status to mark: stale, terminated, orphaned. |
| `--reason` | string | no | no | - | Termination reason string. |
| `--dry-run` | bool | no | no | - | Simulate cleanup without disk mutation. |
| `--all` | bool | no | no | - | Show all cleaned monitors in report. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts watchdog:cleanup --authority-run <run> --run <target-run>
```

### `watchdog:phase-cleanup`

Terminate legacy phase watchdog monitors upon phase rollover or completion.

Terminates active watchdog monitors belonging to completed or superseded phases.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--authority-run` | string | yes | no | - | Capsule run whose active Mind grant authorizes this mutation. |
| `--run` | string | yes | no | - | Target watchdog run root to clean; may equal --authority-run. |
| `--actor` | string | no | no | - | Explicit acting Mind identity. |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--phase` | string | no | no | - | Phase to terminate. |
| `--current-phase` | string | no | no | - | New phase. |
| `--generation` | int | no | no | - | Target generation. |
| `--pulse-id` | string | no | no | - | Target pulse ID. |
| `--exclude-id` | string | no | no | - | Watchdog ID to preserve. |
| `--reason` | string | no | no | - | Termination reason. |
| `--mark-as` | string | no | no | - | Status to mark. |
| `--dry-run` | bool | no | no | - | Simulate phase cleanup. |
| `--all` | bool | no | no | - | Show all terminated monitors. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts watchdog:phase-cleanup --authority-run <run> --run <target-run> --phase planning --generation 1
```

### `watchdog:verify`

Verify watchdog lifecycle invariants and single-monitor constraints.

Audits the watchdog registry against architectural constraints.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--generation` | int | no | no | - | Filter by mind generation. |
| `--pulse-id` | string | no | no | - | Filter by pulse ID. |
| `--phase` | string | no | no | - | Filter by phase. |
| `--all` | bool | no | no | - | Show all monitors in table. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts watchdog:verify
bun harness.ts watchdog:verify --generation 1
```

### `watchdog:probe`

Execute 2-way supervisory health probe and doctor diagnostics to top leader.

Audits the live capsule across 5 supervisory health points and dispatches active probe report.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--generation` | int | no | no | - | Target generation. |
| `--pulse-id` | string | no | no | - | Target pulse ID. |
| `--all` | bool | no | no | - | Show verbose report details. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts watchdog:probe
bun harness.ts watchdog:probe --run .olt/capsules/<run-id>
```
