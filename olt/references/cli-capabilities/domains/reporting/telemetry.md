# CLI Capability Manifest — reporting (telemetry)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `skill:audit:live`

Live Tier 0 out-of-band audit of skill compliance and delta event forensics.

Scans incremental delta events, audits cognitive contracts, and routes defects upstream.

- **Aliases**: `skill:audit`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root path. |
| `--run` | string | no | no | - | Target capsule run root directory. |
| `--log-defects` | bool | no | no | `true` | Automatically log detected incidents as defects. |
| `--json` | bool | no | no | - | Output structured JSON. |

```bash
bun harness.ts skill:audit:live
bun harness.ts skill:audit:live --run .olt/capsules/run-1 --json
```
