# CLI Capability Manifest — install

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `install`

Install the skill release and link it into the requested clients.

Copies the validated source tree to <home>/.agents/skills and publishes a symlink per client, rolling the whole transaction back on failure.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--source` | string | yes | no | - | Skill source directory to install. |
| `--home` | string | yes | no | - | Home directory that receives the release. |
| `--clients` | string | yes | no | - | Comma-separated clients: antigravity, claude, codex, chatgpt. |

```bash
bun harness.ts install --source . --home ~ --clients claude,antigravity
```

### `installation-status`

Audit the installed release, its digest and its client links.

Compares the installed tree digest against the source, then checks every client symlink target.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--source` | string | yes | no | - | Skill source directory to compare against. |
| `--home` | string | yes | no | - | Home directory holding the release. |
| `--clients` | string | no | no | - | Comma-separated clients; defaults to the installed manifest. |

```bash
bun harness.ts installation-status --source . --home ~
```
