# CLI Capability Manifest — authority

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `authority:decide`

Grant or decline a needs_authority requirement.

A requirement disposed needs_authority holds every task built on it non-executable until this is recorded. Granting makes it actionable; declining disposes it out_of_scope and cancels every dormant task that depends on it alone, refusing instead if that would invalidate an active or completed one. The decision is permanent: a second call with the same actor and rationale is idempotent, any other call against an already-decided requirement is refused.

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
bun harness.ts authority:decide --run .olt/capsules/<run-id> --requirement req-prod-deploy --actor coordinator --decision grant --rationale "Human approved the production deploy in the review thread"
```

### `whoami`

Inspect thread execution tier, PID, active agent, grants, and main-thread compliance.

Inspects the calling thread's OS process ID, parent PID, execution tier, active agent ID, active role grants, and task leases. When executed on the interactive main thread, enforces the Main-Thread Restraint Guard advisory and logs structured defect records for unauthorized direct implementations.

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

### `role:cheat-sheet`

Display compact terminal cheat sheets and command matrices for system roles.

Renders ASCII tables and formatted markdown cheat sheets detailing tier, granted commands, forbidden actions, spawn rights, and architectural invariants.

- **Aliases**: `role:contract`, `role:cheat`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | no | no | - | Specific role name to inspect. |
| `--roles-dir` | string | no | no | - | Override roles directory path. |
| `--all` | bool | no | no | - | Render full cheat sheets for all available roles. |
| `--compact` | bool | no | no | - | Render compact summary format. |

```bash
bun harness.ts role:cheat-sheet
bun harness.ts role:cheat-sheet --role implementer
bun harness.ts role:cheat-sheet --all
```

### `watchdog:status`

Query watchdog lifecycle, monitor cadence, and health status.

Inspects background watchdog monitors across runs and generations, reporting active, stale, terminated, and orphaned monitors.

- **Aliases**: `watchdog:list`
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

Scans registered watchdog monitors across generations and pulses, transitioning timed-out monitors to stale or terminated status to prevent monitor accumulation.

- **Aliases**: `watchdog:clean`
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
bun harness.ts watchdog:cleanup --authority-run <run> --run <target-run> --generation 1 --dry-run
```

### `watchdog:phase-cleanup`

Terminate legacy phase watchdog monitors upon phase rollover or completion.

Terminates active watchdog monitors belonging to completed or superseded phases, ensuring old monitors never accumulate across phase transitions.

- **Aliases**: `watchdog:phase-clean`, `watchdog:cleanup-phase`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--authority-run` | string | yes | no | - | Capsule run whose active Mind grant authorizes this mutation. |
| `--run` | string | yes | no | - | Target watchdog run root to clean; may equal --authority-run. |
| `--actor` | string | no | no | - | Explicit acting Mind identity; must match the verified session when supplied. |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--phase` | string | no | no | - | Phase to terminate. |
| `--current-phase` | string | no | no | - | New phase (terminates all prior phases). |
| `--generation` | int | no | no | - | Target generation. |
| `--pulse-id` | string | no | no | - | Target pulse ID. |
| `--exclude-id` | string | no | no | - | Watchdog ID to preserve. |
| `--reason` | string | no | no | - | Termination reason. |
| `--mark-as` | string | no | no | - | Status to mark (default: terminated). |
| `--dry-run` | bool | no | no | - | Simulate phase cleanup. |
| `--all` | bool | no | no | - | Show all terminated monitors. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts watchdog:phase-cleanup --authority-run <run> --run <target-run> --phase planning --generation 1
bun harness.ts watchdog:phase-cleanup --authority-run <run> --run <target-run> --current-phase execution --generation 1
```

### `watchdog:verify`

Verify watchdog lifecycle invariants and single-monitor constraints.

Audits the watchdog registry against architectural constraints (max 1 active monitor per generation/pulse, no overdue heartbeats, no legacy phase orphans).

- **Aliases**: `watchdog:check`, `watchdog:lint`
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

Audits the live capsule across 5 supervisory health points ((a) Work/Span parallelization, (b) Plan enhancement, (c) 100% agent registry accuracy, (d) Strict role boundary adherence, (e) Doctor error resolution) and dispatches active probe report to the top leader.

- **Aliases**: `watchdog:supervise`, `watchdog:health-probe`
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
