# CLI Capability Manifest — policy

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `policy:init`

Initialize canonical .olt/policy.json with auto-detected ecosystem defaults.

Scans repository signatures to detect ecosystem and initializes .olt/policy.json.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo-root` | string | no | no | - | Target repository root directory. |
| `--repo` | string | no | no | - | Alias for --repo-root. |
| `--dir` | string | no | no | - | Alias for --repo-root. |
| `--ecosystem` | string | no | no | - | Override detected repository ecosystem. |
| `--force` | bool | no | no | - | Force overwrite if policy already exists. |
| `--json` | bool | no | no | - | Output in JSON format. |

```bash
bun harness.ts policy:init
bun harness.ts policy:init --repo /path/to/repo
```

### `policy:get`

Inspect repo policy or retrieve a specific policy key value.

Reads .olt/policy.json and retrieves a specific dot-separated key or the entire policy.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--key` | string | no | no | - | Dot-separated key to retrieve (e.g. test_runner.default_command). |
| `--repo-root` | string | no | no | - | Target repository root directory. |
| `--repo` | string | no | no | - | Alias for --repo-root. |
| `--dir` | string | no | no | - | Alias for --repo-root. |
| `--json` | bool | no | no | - | Output in JSON format. |

```bash
bun harness.ts policy:get
bun harness.ts policy:get --key test_runner.default_command
bun harness.ts policy:get --json
```

### `policy:set`

Set or update a specific key value in .olt/policy.json.

Atomically updates a dot-separated key in .olt/policy.json with flock protection.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--key` | string | yes | no | - | Dot-separated key to set (e.g. review_protocol.cognitive_pushes). |
| `--value` | string | yes | no | - | Value to set (string, number, boolean, or JSON). |
| `--repo-root` | string | no | no | - | Target repository root directory. |
| `--repo` | string | no | no | - | Alias for --repo-root. |
| `--dir` | string | no | no | - | Alias for --repo-root. |
| `--json` | bool | no | no | - | Output in JSON format. |

```bash
bun harness.ts policy:set --key review_protocol.cognitive_pushes --value 5
bun harness.ts policy:set --key typecheck_command --value 'bun run typecheck'
```

### `policy:check-drift`

Check for policy file drift against a known SHA-256 checksum.

Computes SHA-256 hash of .olt/policy.json and detects configuration drift.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--checksum` | string | no | no | - | Known SHA-256 checksum to compare against. |
| `--repo-root` | string | no | no | - | Target repository root directory. |
| `--repo` | string | no | no | - | Alias for --repo-root. |
| `--dir` | string | no | no | - | Alias for --repo-root. |
| `--rearm` | bool | no | no | - | Trigger re-arming and log drift event if drifted. |
| `--strict` | bool | no | no | - | Exit nonzero if drift or corruption detected. |
| `--json` | bool | no | no | - | Output in JSON format. |

```bash
bun harness.ts policy:check-drift
bun harness.ts policy:check-drift --checksum <sha256> --rearm
```
