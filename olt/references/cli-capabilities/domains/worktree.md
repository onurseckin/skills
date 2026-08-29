# CLI Capability Manifest — worktree

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `worktree:create`

Create a hermetic track worktree with lock acquisition.

Allocates a hermetic track worktree in .olt/worktrees/<track_id>, creates branch track/<track_id>, and acquires a POSIX lock.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--track` | string | yes | no | - | Track identifier. |
| `--base-branch` | string | no | no | `main` | Base branch to fork from (default: main). |
| `--repo-root` | string | no | no | - | Repository root path. |

```bash
bun harness.ts worktree:create --track track-1
bun harness.ts worktree:create --track track-1 --base-branch main
```

### `worktree:land`

Land a completed track worktree to main with immediate teardown.

Performs upstream sync, rebases track onto main, fast-forwards/pushes, executes release hooks, writes telemetry, and tears down worktree and branch.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--track` | string | yes | no | - | Track identifier. |
| `--remote` | string | no | no | `origin` | Git remote (default: origin). |
| `--target-branch` | string | no | no | `main` | Target branch (default: main). |
| `--repo-root` | string | no | no | - | Repository root path. |
| `--no-release-hook` | bool | no | no | - | Skip executing post-land release hooks. |

```bash
bun harness.ts worktree:land --track track-1
bun harness.ts worktree:land --track track-1 --target-branch main
```

### `worktree:list`

List all active track worktrees.

Queries git porcelain and .olt/worktrees to report all currently active track worktrees.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo-root` | string | no | no | - | Repository root path. |

```bash
bun harness.ts worktree:list
```

### `worktree:clean`

Clean up and remove track worktrees and branches.

Removes specified worktree directory, deletes track branch, runs git worktree prune, and cleans lock file.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--track` | string | no | no | - | Track identifier to clean. |
| `--all` | bool | no | no | - | Clean all active track worktrees. |
| `--no-force` | bool | no | no | - | Do not force removal. |
| `--repo-root` | string | no | no | - | Repository root path. |

```bash
bun harness.ts worktree:clean --track track-1
bun harness.ts worktree:clean --all
```

### `worktree:status`

Check status of active track worktrees.

Reports active track worktree path, lock status, and branch information.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--track` | string | no | no | - | Optional track identifier to check. |
| `--repo-root` | string | no | no | - | Repository root path. |

```bash
bun harness.ts worktree:status
bun harness.ts worktree:status --track track-1
```

### `worktree:reclaim`

Reclaim abandoned worktrees from a completed or crashed run.

B22.6: removes the worktree directories a crashed or abandoned run left behind. The harness branch and every per-task worktree branch are left untouched.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the reclaim. Recorded on the event; there is no default actor. |

```bash
bun harness.ts worktree:reclaim --run .olt/capsules/<run-id> --actor coordinator
```
