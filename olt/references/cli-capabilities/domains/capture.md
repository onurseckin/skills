# CLI Capability Manifest — capture

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `capture:init`

Initialize standard capture configuration in repository.

Generates .capture.yaml or .capture.json with standard presets, default viewports, authentication settings, and example screen targets.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--config-dir` | string | no | no | - | Directory to create the configuration file in. |
| `--format` | string | no | no | `yaml` | Configuration format: yaml or json (default: yaml). |
| `--preset` | string | no | no | `standard-dashboard` | Preset template: standard-dashboard, marketing-site, mobile-app, full-matrix. |
| `--force` | bool | no | no | - | Overwrite existing configuration file if present. |

```bash
bun harness.ts capture:init
bun harness.ts capture:init --format json --preset standard-dashboard
```

### `capture:run`

Execute multi-viewport UI capture and companion manifest persistence.

Dispatches Playwright or simulated runner across configured screens and viewports, generating screenshots and 1-to-1 companion manifest JSON records.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root for artifact and screenshot ledger ingestion. |
| `--config` | string | no | no | - | Explicit path to .capture.yaml or .capture.json. |
| `--config-dir` | string | no | no | - | Directory containing capture configuration. |
| `--screen` | string | no | no | - | Filter execution to a specific screen ID. |
| `--viewport` | string | no | no | - | Filter execution to a specific viewport name. |
| `--out-dir` | string | no | no | - | Explicit output directory for captures and manifests. |
| `--actor` | string | no | no | - | Actor recorded in ledger captures (default: capture-runner). |

```bash
bun harness.ts capture:run --config .capture.yaml
bun harness.ts capture:run --run .olt/capsules/<run-id> --screen dashboard --viewport desktop
```

### `capture:eval`

Evaluate companion manifests against 4-pillar validation engines.

Performs strict binary certification across mechanical, cognitive, custom, and synthesis pillars with 0 numeric scores.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--manifest` | string | no | no | - | Path to single .manifest.json companion file. |
| `--manifest-dir` | string | no | no | - | Directory containing .manifest.json companion files. |
| `--strict` | bool | no | no | - | Exit non-zero (exit code 3) if any defects are found. |

```bash
bun harness.ts capture:eval --manifest .captures/dashboard-desktop.manifest.json
bun harness.ts capture:eval --manifest-dir .captures --strict
```
