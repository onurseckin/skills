# CLI Capability Manifest — hygiene

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `hygiene:audit`

Audit repository root hygiene invariants.

Scans repo root, scripts/, and static olt/ directories for unapproved files, loose executables, and runtime pollution.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo-root` | string | no | no | - | Repository root path. |
| `--root` | string | no | no | - | Alias for repo-root. |
| `--fix` | bool | no | no | - | Automatically quarantine detected violations. |
| `--quarantine-dir` | string | no | no | - | Destination directory for quarantined files. |

```bash
bun harness.ts hygiene:audit
```

### `hygiene:fix`

Quarantine repository root hygiene violations.

Scans repository root and automatically quarantines unconfined scratch scripts and loose files.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo-root` | string | no | no | - | Repository root path. |
| `--root` | string | no | no | - | Alias for repo-root. |
| `--quarantine-dir` | string | no | no | - | Destination directory for quarantined files. |

```bash
bun harness.ts hygiene:fix
```
