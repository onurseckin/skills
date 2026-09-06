# CLI Capability Manifest — diagnostics (doctor)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `health`

Check whether the code still does what the requirements said.

Reports unused exports and unreachable modules, dead or superseded code, declared behaviour nothing enforces, requirements with no code or no test, literal fallbacks that substitute a plausible value for a missing one, and vendor names in identifier positions. Every check prints what it cannot see. Unlike `doctor` it reads a source tree, not a capsule.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--scripts` | string | no | no | - | Harness scripts root to inspect. Defaults to the running harness. |
| `--consumer` | string | no | no | - | Consumer repository root. Without it the vendor-name sweep covers one repo, and says so. |
| `--check` | string | no | yes | - | Restrict the run to named checks. |
| `--all` | bool | no | no | - | List every failure instead of the first five per check, and every advisory alongside them. |
| `--strict` | bool | no | no | - | Exit nonzero when the report is unhealthy. |

```bash
bun harness.ts health
bun harness.ts health --consumer ../gvui --all
bun harness.ts health --check unused-code --strict
```

### `doctor`

Verify capsule integrity, command evidence and the runtime.

Re-hashes the event chain, re-verifies every recorded command, reports workflow blockers and, with --source and --home, the installation state.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--source` | string | no | no | - | Skill source directory for the installation check. |
| `--home` | string | no | no | - | Home directory for the installation check. |
| `--clients` | string | no | no | - | Comma-separated clients for the installation check. |

```bash
bun harness.ts doctor --run .olt/capsules/<run-id>
```

### `doctor:verify`

Verify capsule integrity, cryptographic hash chain and command receipts.

Re-hashes the event chain, re-verifies every recorded command, reports workflow blockers and verifies milestone cryptographic evidence.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--source` | string | no | no | - | Skill source directory for the installation check. |
| `--home` | string | no | no | - | Home directory for the installation check. |
| `--clients` | string | no | no | - | Comma-separated clients for the installation check. |

```bash
bun harness.ts doctor:verify --run .olt/capsules/<run-id>
```

### `doctor:repair`

Re-derive state.json from the event chain after a crash tears the log's tail.

The repair counterpart to `doctor`: `doctor` only reports a torn tail or a state/event mismatch. This re-derives state.json from the event chain's last complete event, quarantining any torn final fragment under quarantine/ instead of discarding it, and records a projection-recovered event. Refuses if the manifest or prompt itself is corrupt - that is an integrity failure, not something to repair silently.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the repair. Recorded on the event; there is no default actor. |

```bash
bun harness.ts doctor:repair --run .olt/capsules/<run-id> --actor coordinator
```

### `doctor:certify`

Certify doctor's own checks are falsifiable via counterfactual mutation testing.

Runs the full harness health diagnostic suite (bun version, capsule root confinement, unified evidence location, tier confinement, integrity) that `doctor` folds into every run, plus -- for each --write-scope test file -- an adversarial counterfactual check: it mutates the file (flips an assertion, injects a syntax error, etc.), reruns it, and verifies the mutation actually makes it fail, proving the gate is falsifiable rather than vacuous, then reverts the mutation. Slower than `doctor` and gated behind this explicit command because it mutates files and runs real test commands. Each --write-scope path must be a .test.ts or .spec.ts file; anything else is rejected up front rather than silently skipped.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--write-scope` | string | no | yes | - | A .test.ts or .spec.ts file to adversarially mutate and verify falsifiability for. Omit to run only the non-adversarial health diagnostics. |
| `--mutation-kind` | string | no | no | - | syntax_error \| assertion_flip \| return_override \| empty_file \| exception_injection. Defaults to syntax_error. |
| `--strict` | bool | no | no | - | Exit nonzero when the report is not certified. |

```bash
bun harness.ts doctor:certify --run .olt/capsules/<run-id>
bun harness.ts doctor:certify --run .olt/capsules/<run-id> --write-scope tests/unit/doctor/capsule-root.test.ts --strict
```

### `recover`

Release expired leases and interrupted validations.

Returns tasks whose lease expired to retry_ready (or changes_requested after a repair attempt), reopens interrupted validations, reclaims branch sub-tasks whose sub-agent died, and expires a stale completeness critic. A branched parent's frozen lease is never reaped: it is blocked on children, not gone.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the recovery. Recorded on the event; there is no default actor. |
| `--grace-seconds` | int | no | no | `30` | Grace period past expiry, 0-86400. |

```bash
bun harness.ts recover --run .olt/capsules/<run-id> --actor coordinator
```

### `doctor:agent`

Evaluate agent-scoped contracts and 20-role invariant profiles.

Performs fine-grained, deterministic, role-tailored diagnostic checks against an agent's leased tasks and events without global broadcasting.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | yes | no | - | Canonical role to evaluate (e.g. implementer, coordinator). |
| `--agent` | string | yes | no | - | Target agent identifier. |
| `--task` | string | no | no | - | Task ID under active lease. |
| `--run` | string | no | no | - | Run capsule root directory. |
| `--format` | string | no | no | - | Output format: json or markdown. |
| `--files` | string | no | no | - | Comma-separated modified files for AST evaluation. |
| `--commands` | string | no | no | - | Comma-separated executed commands. |
| `--repo-root` | string | no | no | - | Repository root path. |

```bash
bun harness.ts doctor:agent --role implementer --agent implementer_core_01
bun harness.ts doctor:agent --role coordinator --agent coordinator_01 --format json
```
