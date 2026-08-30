# CLI Capability Manifest — reporting (quota)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `quota:check`

Evaluate quota circuit-breaker status, wrap-up directives, and auto-wake timer schedule.

Probes cross-platform quota telemetry, detects exhaustion (<10%), generates wrap-up directives for active agents, and computes one-shot auto-wake scheduler payloads.

- **Aliases**: `quota:circuit-break`, `circuit-breaker:check`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--platform` | string | no | no | - | Filter probe to a specific platform ID (antigravity, claude, cursor, openai, codex). |
| `--threshold` | string | no | no | `10.0` | Quota percentage threshold to trigger circuit breaker (default: 10.0). |
| `--active-agents` | int | no | no | `0` | Number of currently active agents to register in auto-wake schedule. |
| `--detailed` | bool | no | no | - | Include full vendor observation payloads. |
| `--json` | bool | no | no | - | Output structured JSON report. |

```bash
bun harness.ts quota:check
```

### `quota:freeze`

Initiate DAG quota freeze and create a snapshot.

Probes quota telemetry and freezes DAG operations if circuit breaker is triggered or force is applied. Outputs state to a snapshot file.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Must resolve to the verified run repository. |
| `--run` | string | yes | no | - | Verified capsule run root. |
| `--actor` | string | yes | no | - | Acting mind or orchestrator agent ID. |
| `--threshold` | string | no | no | `10.0` | Quota percentage threshold (default: 10.0). |
| `--active-agents` | int | no | no | `0` | Number of currently active agents. |
| `--force` | bool | no | no | `false` | Override quota policy only; never bypasses quota evidence. |
| `--json` | bool | no | no | - | Output structured JSON report. |
| `--detailed` | bool | no | no | - | Detailed markdown output. |

```bash
bun harness.ts quota:freeze --run .olt/capsules/<run-id> --actor mind_1
```

### `quota:resume`

Resume DAG operations from a quota freeze snapshot.

Probes quota telemetry and resumes operations from a prior freeze if quota is healthy or force is applied.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Must resolve to the verified run repository. |
| `--run` | string | yes | no | - | Verified capsule run root. |
| `--actor` | string | yes | no | - | Acting mind or orchestrator agent ID. |
| `--threshold` | string | no | no | `10.0` | Quota percentage threshold (default: 10.0). |
| `--force` | bool | no | no | `false` | Override quota policy only; does not bypass run or grant authority. |
| `--json` | bool | no | no | - | Output structured JSON report. |
| `--detailed` | bool | no | no | - | Detailed markdown output. |

```bash
bun harness.ts quota:resume --run .olt/capsules/<run-id> --actor mind_1
```
