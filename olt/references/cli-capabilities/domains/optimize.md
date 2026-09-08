# CLI Capability Manifest — optimize

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `optimize:scan`

Scan codebase for architectural and quality violations across five pillars.

Evaluates codebase files against modularity (<= 400 SLOC), purity, type safety, hot-path latency, and ergonomics rules.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--dir` | string | no | no | - | Directory path to scan. |
| `--root` | string | no | no | - | Root directory path to scan (alias for dir). |
| `--strict` | bool | no | no | - | Fail with non-zero exit when violations are detected. |
| `--json` | bool | no | no | - | Output results in JSON format. |
| `--pillar` | string | no | no | - | Filter scan violations by specific pillar. |
| `--limit` | int | no | no | - | Maximum number of violations to report. |

```bash
bun harness.ts optimize:scan --dir src --strict
bun harness.ts optimize:scan --pillar modularity
```

### `optimize:analyze`

Empirical decomposition analysis and public API surface locking for target file.

Generates empirical baseline metrics, inbound/outbound coupling map, submodule decomposition, public API surface lock, verification gates, and rollback thresholds.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--target` | string | yes | no | - | Path to source file to analyze. |
| `--out` | string | no | no | - | Output markdown analysis file path. |
| `--dry-run` | bool | no | no | - | Simulate analysis without writing output file. |
| `--json` | bool | no | no | - | Output results in JSON format. |

```bash
bun harness.ts optimize:analyze --target src/core/engine.ts --dry-run
bun harness.ts optimize:analyze --target src/core/engine.ts
```

### `optimize:check-ast`

Verify AST public API invariants and prevent signature mutations or evasions.

Compares pre- and post-mutation AST representations to detect added, removed, or mutated public exports, and checks for double-cast type safety evasions.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--pre` | string | no | no | - | Pre-mutation file path or source content. |
| `--post` | string | no | no | - | Post-mutation file path or source content. |
| `--target` | string | no | no | - | Target file path to compare against HEAD or pre-mutation version. |
| `--strict` | bool | no | no | - | Throw on any AST invariant breach. |
| `--json` | bool | no | no | - | Output results in JSON format. |

```bash
bun harness.ts optimize:check-ast --pre old.ts --post new.ts --strict
bun harness.ts optimize:check-ast --target src/core/engine.ts
```

### `optimize:check-tests`

Enforce assertion preservation gate and prohibit test deletions or evasion.

Inspects git diff or pre/post test content to ensure zero assertions are deleted or commented out.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--target` | string | no | no | - | Target test file or directory path filter. |
| `--base` | string | no | no | - | Base git reference to diff against (default HEAD). |
| `--diff` | string | no | no | - | Git diff file path or inline diff string to check. |
| `--json` | bool | no | no | - | Output results in JSON format. |

```bash
bun harness.ts optimize:check-tests --target tests/core
bun harness.ts optimize:check-tests --base HEAD~1
```

### `optimize:quarantine`

Isolate and quarantine failing optimization plans with atomic recovery.

Cleans target child worktrees, restores git index to clean main, verifies compiler health, and archives quarantine details to QUARANTINED.md.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--plan` | string | yes | no | - | Plan slug to quarantine. |
| `--reason` | string | no | no | - | Reason for quarantine. |
| `--defect` | string | no | no | - | Defect identifier or defect commit SHA. |
| `--failure-logs` | string | no | no | - | Raw failure log output or details. |
| `--logs` | string | no | no | - | Alias for failure-logs. |
| `--clean-all` | bool | no | no | - | Clean all active worktrees instead of only target plan worktrees. |
| `--clean-all-worktrees` | bool | no | no | - | Alias for clean-all. |
| `--dry-run` | bool | no | no | - | Simulate quarantine without modifying worktrees or files. |
| `--json` | bool | no | no | - | Output results in JSON format. |
| `--repo-root` | string | no | no | - | Repository root path. |
| `--repo` | string | no | no | - | Alias for repo-root. |
| `--actor` | string | no | no | - | Actor invoking quarantine. |
| `--run` | string | no | no | - | Capsule run directory or ID. |

```bash
bun harness.ts optimize:quarantine --plan my-plan --dry-run
bun harness.ts optimize:quarantine --plan my-plan --reason 'Persistent test failure'
```

### `optimize:check-drift`

Check for code-relevant drift against baseline to enforce quiescent standby.

Differentiates code-relevant mutations from quiescent/hygiene changes across specified git revisions or file paths.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--base` | string | no | no | - | Base git reference to compare against (default HEAD~1). |
| `--target` | string | no | no | - | Target path or directory to check for drift. |
| `--paths` | string | no | no | - | Explicit paths list or comma-separated string to evaluate. |
| `--json` | bool | no | no | - | Output results in JSON format. |
| `--strict` | bool | no | no | - | Fail with exit code 1 if code-relevant drift is detected. |

```bash
bun harness.ts optimize:check-drift --base HEAD~1 --strict
bun harness.ts optimize:check-drift --paths src/index.ts,src/core.ts
```
