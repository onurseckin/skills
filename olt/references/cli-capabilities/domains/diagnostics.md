# CLI Capability Manifest — diagnostics

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `defect:audit`

Audit, deduplicate, and auto-admit defects across capsules.

Discovers defects.jsonl files across .olt/capsules/ and active run, deduplicates entries, displays an ASCII summary matrix, and optionally auto-admits candidate remediations.

- **Aliases**: `defects`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--filter-status` | string | no | no | - | Filter by status: open, admitted, resolved, all. |
| `--filter-category` | string | no | no | - | Filter by defect category/type. |
| `--filter-type` | string | no | no | - | Alias for --filter-category. |
| `--auto-admit` | bool | no | no | - | Automatically admit open defects as candidates. |
| `--actor` | string | no | no | - | Actor recording admissions. |
| `--all` | bool | no | no | - | Show all defects without line truncation. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |
| `--json` | bool | no | no | - | Output JSON. |

```bash
bun harness.ts defect:audit
bun harness.ts defect:audit --run .olt/capsules/<run-id> --filter-status open
bun harness.ts defect:audit --auto-admit --actor coordinator
```

### `coverage:check`

Audit repository test coverage against strict 95% threshold.

Runs bun test with coverage collection, parses per-file metrics across lines, statements, functions, and branches, and enforces the minimum 95% threshold.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--threshold` | string | no | no | `0.95` | Minimum coverage threshold fraction, default 0.95. |
| `--dir` | string | no | no | - | Target repository directory to run coverage check in. |
| `--strict` | bool | no | no | - | Exit nonzero when coverage is below threshold. |

```bash
bun harness.ts coverage:check
bun harness.ts coverage:check --threshold 0.95 --strict
```

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
| `--mutation-kind` | string | no | no | - | syntax_error | assertion_flip | return_override | empty_file | exception_injection. Defaults to syntax_error. |
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

### `meta-audit`

Deep behavioral forensics and anomaly detection across all agent telemetry.

Evaluates raw execution traces against 7 behavioral heuristics (TOKEN_BURNING, FALSE_SERIALIZATION, etc.), computes efficiency scores, and injects autonomous remediation proposals.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--format` | string | no | no | - | Output format. |
| `--inject` | bool | no | no | - | Inject remediation proposals. |
| `--agent` | string | no | no | - | Agent ID to filter. |
| `--actor` | string | yes | no | - | Acting coordinator or meta-auditor authorizing injection. |
| `--verbose` | bool | no | no | - | Verbose output. |
| `--json` | bool | no | no | - | Output JSON. |

```bash
bun harness.ts meta-audit --run .olt/capsules/<run-id> --actor coordinator --inject
```

### `finding:file`

Record a diagnostic finding or defect directly into the flock-locked defect store.

Universal diagnostic finding ingestion command accessible to all companion and auditor roles. Appends or updates defects in .olt/defects.jsonl under flock lock.

- **Aliases**: `finding`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--code` | string | yes | no | - | Diagnostic finding code (e.g. AST_PURITY_VIOLATION). |
| `--severity` | string | no | no | - | Severity: critical, high, warning, low, info. |
| `--file` | string | no | no | - | Target file path where violation occurred. |
| `--path` | string | no | no | - | Alias for --file. |
| `--line` | int | no | no | - | Line number where violation occurred. |
| `--message` | string | no | no | - | Diagnostic message or description. |
| `--description` | string | no | no | - | Alias for --message. |
| `--task-id` | string | no | no | - | Task identifier during which finding occurred. |
| `--commit-sha` | string | no | no | - | Commit SHA where finding was observed. |
| `--remediation` | string | no | no | - | Remediation guidance. |
| `--actor` | string | no | no | - | Actor recording the finding. |
| `--defects-path` | string | no | no | - | Custom defects.jsonl file location. |

```bash
bun harness.ts finding:file --code AST_PURITY_VIOLATION --severity high --file src/index.ts --message 'Found as any'
bun harness.ts finding:file --code RUNTIME_ERROR --task-id task-1 --commit-sha abc1234
```

### `explain`

Explain a HarnessError code: the rule it enforces, common causes and the remedy for each.

Answers a refused command with a command instead of a file to read. --code is one of the ErrorCode values a HarnessError actually carries (INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, UNSUPPORTED_PLATFORM); case-insensitive. Every cause is grounded in real throw sites in this build, cited by file and line, plus a live count of how many places in the current source tree still throw that code. --command narrows further: it dynamically scans that command's own implementation file for direct throws of --code and reports the exact lines and messages, rather than a canned guess about which command hits which cause.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--code` | string | yes | no | - | HarnessError code to explain: INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, or UNSUPPORTED_PLATFORM. Case-insensitive. |
| `--command` | string | no | no | - | CLI command name (e.g. task:claim) to narrow the explanation to that command's own direct throw sites. |

```bash
bun harness.ts explain --code INTEGRITY
bun harness.ts explain --code INVALID_STATE --command task:claim
```
