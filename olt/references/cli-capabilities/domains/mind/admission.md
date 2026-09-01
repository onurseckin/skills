# CLI Capability Manifest — mind (admission)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `mind:init`

Single-touch autonomous initialization of the Tier 0 Mind capsule.

Performs 3-stage autonomous initialization: (1) In-flight worktree snapshot & user intent extraction, (2) Active empirical baseline diagnostic probing & clustering, (3) Strategic hierarchy mobilization (Mind, Mind Auditor, Skill Auditor, Domain Orchestrator), 70/20/10 portfolio governance, and live executive dashboard initialization into a perpetual sovereign execution loop.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | `.` | Repository root the mind serves; defaults to cwd. |
| `--charter` | string | no | no | - | Path to owner's charter file; auto-detected if omitted. |
| `--actor` | string | no | no | `owner` | Recorded on mind-initialized; defaults to owner. |
| `--mind-id` | string | no | no | `mind-gen-1` | Mind capsule run id; defaults to mind-gen-1. |
| `--generation` | int | no | no | `1` | Mind generation index (>=1). |
| `--capsules-dir` | string | no | no | - | Override .olt/capsules/ directory location. |

```bash
bun harness.ts mind:init
bun harness.ts mind:init --repo . --charter olt/agents/mind.yaml
```

### `mind:bootstrap`

Single-touch autonomous initialization of the Tier 0 Mind capsule (bootstrap entrypoint).

Performs 3-stage autonomous initialization: (1) In-flight worktree snapshot & user intent extraction, (2) Active empirical baseline diagnostic probing & clustering, (3) Strategic hierarchy mobilization (Mind, Mind Auditor, Skill Auditor, Domain Orchestrator), 70/20/10 portfolio governance, and live executive dashboard initialization into a perpetual sovereign execution loop.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | `.` | Repository root the mind serves; defaults to cwd. |
| `--charter` | string | no | no | - | Path to owner's charter file; auto-detected if omitted. |
| `--actor` | string | no | no | `owner` | Recorded on mind-initialized; defaults to owner. |
| `--mind-id` | string | no | no | `mind-gen-1` | Mind capsule run id; defaults to mind-gen-1. |
| `--generation` | int | no | no | `1` | Mind generation index (>=1). |
| `--capsules-dir` | string | no | no | - | Override .olt/capsules/ directory location. |

```bash
bun harness.ts mind:bootstrap
```

### `mind:candidate`

Record a discovery candidate (defect or proposal).

Proposes a defect or proposal candidate. Defects require a witness command record and falsifier argv. Validates charter goal alignment and write scope before recording mind-candidate-opened.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--kind` | string | yes | no | - | Candidate kind: defect or proposal. |
| `--statement` | string | yes | no | - | One line statement, recorded agent_reported. |
| `--witness` | string | no | no | - | Command id evidencing the defect; required unless --kind proposal. |
| `--charter-goal` | string | yes | yes | - | Goal ids from the pinned charter; repeat for multiple. |
| `--falsifier` | string | no | no | - | Argv that fails now and would pass if fixed (defects only). |
| `--write-scope` | string | yes | yes | - | Paths the work would touch; repeat for multiple. |
| `--rationale` | string | no | no | - | Proposals only. |

```bash
bun harness.ts mind:candidate --run .olt/capsules/mind-gen-1 --actor mind-1 --kind defect --statement "typecheck fails" --witness cmd-123 --charter-goal G1 --falsifier "bun run typecheck" --write-scope olt/scripts/src/health/
```

### `mind:admit`

Run admission gates on a candidate and admit it.

Runs the six admission gates (falsifier verification, scope disjointness, charter alignment, etc.) in order and admits the candidate, appending mind-candidate-admitted.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--candidate` | string | yes | no | - | Candidate id. |

```bash
bun harness.ts mind:admit --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12
```

### `mind:decline`

Permanently decline a candidate with a recorded reason.

Marks a candidate permanently declined with a recorded reason and gate failure attribution, appending mind-candidate-declined.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--candidate` | string | yes | no | - | Candidate id. |
| `--reason` | string | yes | no | - | Reason why candidate was declined. |

```bash
bun harness.ts mind:decline --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12 --reason "scope overlaps active lease"
```
