# CLI Capability Manifest — role

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `role:list`

List available system roles.

Queries and lists all available agent roles from the agents/ directory.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--roles-dir` | string | no | no | - | Override roles directory path. |
| `--dir` | string | no | no | - | Alias for roles-dir. |

```bash
bun harness.ts role:list
```

### `role:profile`

Resolve agent model profile binding.

Resolves profile tier, model bindings, and host support capabilities for an agent role.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | no | no | - | Role name to resolve. |
| `--profile` | string | no | no | - | Abstract profile name. |
| `--host` | string | no | no | - | Target host platform identifier. |

```bash
bun harness.ts role:profile --role implementer
```

### `role:cheat-sheet`

Display compact terminal cheat sheets and command matrices for system roles.

Renders ASCII tables and formatted markdown cheat sheets detailing tier, granted commands, forbidden actions, spawn rights, and architectural invariants.

- **Aliases**: `role:contract`, `role:cheat`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | no | no | - | Specific role name to inspect. |
| `--roles-dir` | string | no | no | - | Override roles directory path. |
| `--all` | bool | no | no | - | Render full cheat sheets for all available roles. |
| `--compact` | bool | no | no | - | Render compact summary format. |

```bash
bun harness.ts role:cheat-sheet
bun harness.ts role:cheat-sheet --role implementer
bun harness.ts role:cheat-sheet --all
```
