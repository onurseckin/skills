# CLI Capability Manifest — diagnostics (audit)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `defect:audit`

Audit, deduplicate, and auto-admit defects across capsules.

Discovers defects.jsonl files across .olt/capsules/ and active run, deduplicates entries, displays an ASCII summary matrix, and optionally auto-admits candidate remediations.

- **Aliases**: none
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

- **Aliases**: none
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
