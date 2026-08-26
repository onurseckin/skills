# CLI Capability Manifest — orphan

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `orphan:dispose`

Close out a command record that arrived without a live owner.

Orphan evidence — typically a durable command record left behind by an agent that died mid-run — blocks completion until it is explicitly dispositioned. --disposition is ignored_non_authoritative, rejected, or superseded; there is no default, and each disposition is terminal.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is recording the disposition. |
| `--orphan-sha256` | string | yes | no | - | Digest of the orphan evidence, from doctor's issues. |
| `--disposition` | string | yes | no | - | ignored_non_authoritative, rejected, or superseded. |
| `--rationale` | string | yes | no | - | Why this disposition is correct. |
| `--evidence` | string | no | yes | - | Command id supporting the disposition; repeat per id. |

```bash
bun harness.ts orphan:dispose --run .olt/capsules/<run-id> --actor coordinator --orphan-sha256 <sha> --disposition ignored_non_authoritative --rationale "agent worker-3 died before submitting; the command it ran is not authoritative for any task" --evidence C-abc123
```
