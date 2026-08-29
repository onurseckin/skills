# CLI Capability Manifest — mind (admission)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
