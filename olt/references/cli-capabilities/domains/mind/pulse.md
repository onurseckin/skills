# CLI Capability Manifest — mind (pulse)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `mind:pulse-open`

Open an active mind pulse under budget constraints.

Opens a new pulse cycle, validating budget headroom, daily pulse and wall-clock caps, quiet hours, and charter digest consistency before appending mind-pulse-opened.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | The tier-0 agent id. |
| `--host` | string | yes | no | - | Host runtime as reported. |
| `--driver` | string | yes | no | - | Driver identity as reported. |

```bash
bun harness.ts mind:pulse-open --run .olt/capsules/mind-gen-1 --actor mind-1 --host antigravity --driver bash-loop
```

### `mind:pulse`

Unified perpetual mind pulse: report active telemetry or open a new pulse.

Unified perpetual mind pulse command. If a pulse is open, outputs active pulse telemetry and next scheduled interval. If no pulse is open, automatically opens a new perpetual pulse. Enforces CLOSING_FORBIDDEN_FOR_MIND invariant.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | no | no | `mind-1` | The acting agent id. |
| `--host` | string | no | no | `antigravity` | Host runtime as reported. |
| `--driver` | string | no | no | `perpetual-loop` | Driver identity as reported. |
| `--arm` | string | no | no | - | Scheduled duration for the next interval, e.g. 15m. |
| `--arm-mechanism` | string | no | no | - | How the pulse was armed, as reported. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts mind:pulse --run .olt/capsules/mind-gen-1 --actor mind-1
bun harness.ts mind:pulse --run .olt/capsules/mind-gen-1 --arm 15m
```
