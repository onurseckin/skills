# CLI Capability Manifest — diagnostics (tools)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `explain`

Explain a HarnessError code: the rule it enforces, common causes and the remedy for each.

Answers a refused command with a command instead of a file to read. --code is one of the ErrorCode values a HarnessError actually carries (INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, UNSUPPORTED_PLATFORM); case-insensitive. Every cause is grounded in real throw sites in this build, cited by file and line, plus a live count of how many places in the current source tree still throw that code. --command narrows further: it dynamically scans that command's own implementation file for direct throws of --code and reports the exact lines and messages, rather than a canned guess about which command hits which cause.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--code` | string | yes | no | - | HarnessError code to explain: INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, or UNSUPPORTED_PLATFORM. Case-insensitive. |
| `--command` | string | no | no | - | CLI command name (e.g. task:claim) to narrow the explanation to that command's own direct throw sites. |

```bash
bun harness.ts explain --code INTEGRITY
bun harness.ts explain --code INVALID_STATE --command task:claim
```

### `sentinel:pre-action`

Intercept outgoing tool calls and enforce role boundaries before OS execution.

Evaluates proposed file mutations and commands against leased write scopes and role execution permissions.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | yes | no | - | Canonical role. |
| `--agent` | string | yes | no | - | Target agent identifier. |
| `--target` | string | yes | no | - | Target file path or shell command string. |
| `--action` | string | no | no | - | Action type: file_write, shell_command, task_submit. |
| `--write-scope` | string | no | no | - | Comma-separated leased write scope paths. |
| `--task` | string | no | no | - | Task ID under active lease. |
| `--action-type` | string | no | no | - | Alias for action. |
| `--actor` | string | no | no | - | Alias for agent identifier. |
| `--agent-id` | string | no | no | - | Alias for agent identifier. |
| `--task-id` | string | no | no | - | Alias for task identifier. |

```bash
bun harness.ts sentinel:pre-action --role implementer --agent impl_01 --target src/app.ts --write-scope src/app.ts
```

### `sentinel:post-action`

Scan modified files for AST purity, line budgets and directory fanout.

Audits physical lines (<= 400 LOC), AST type purity (0 any, 0 suppressions), directory fanout (<= 10), and wildcard exports.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | yes | no | - | Canonical role. |
| `--agent` | string | yes | no | - | Target agent identifier. |
| `--files` | string | yes | no | - | Comma-separated list of modified files. |
| `--repo-root` | string | no | no | - | Repository root directory. |
| `--actor` | string | no | no | - | Alias for agent identifier. |
| `--agent-id` | string | no | no | - | Alias for agent identifier. |

```bash
bun harness.ts sentinel:post-action --role implementer --agent impl_01 --files src/foo.ts,src/bar.ts
```

### `sentinel:turn-end`

Holistic turn-end evaluation with 3-strike escalation and scoped mailbox delivery.

Evaluates role profile, advances strike ladder, and dispatches scoped interjections via POSIX flock to agent inbox.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | yes | no | - | Canonical role. |
| `--agent` | string | yes | no | - | Target agent identifier. |
| `--task` | string | no | no | - | Task ID under active lease. |
| `--run` | string | no | no | - | Run capsule root directory. |
| `--parent-supervisor` | string | no | no | - | Parent supervisor agent ID for Strike 3 escalation. |
| `--dry-run` | bool | no | no | - | Dry run evaluation without mailbox delivery. |
| `--files` | string | no | no | - | Comma-separated list of modified files. |
| `--commands` | string | no | no | - | Comma-separated list of executed commands. |
| `--actor` | string | no | no | - | Alias for agent identifier. |
| `--agent-id` | string | no | no | - | Alias for agent identifier. |
| `--repo-root` | string | no | no | - | Repository root path. |
| `--run-id` | string | no | no | - | Alias for capsule run root. |
| `--task-id` | string | no | no | - | Alias for task identifier. |

```bash
bun harness.ts sentinel:turn-end --role implementer --agent impl_01 --task task-100
```

### `sentinel:watch`

Live watchdog loop monitoring active turn execution against role contracts.

Runs continuous or stepped evaluation of agent contracts, dispatching immediate corrective interjections upon violation.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | yes | no | - | Canonical role. |
| `--agent` | string | yes | no | - | Target agent identifier. |
| `--task` | string | no | no | - | Task ID. |
| `--interval` | int | no | no | - | Watch interval in ms. |
| `--max-iterations` | int | no | no | - | Maximum check iterations. |
| `--actor` | string | no | no | - | Alias for agent identifier. |
| `--agent-id` | string | no | no | - | Alias for agent identifier. |
| `--repo-root` | string | no | no | - | Repository root path. |
| `--task-id` | string | no | no | - | Alias for task identifier. |

```bash
bun harness.ts sentinel:watch --role implementer --agent impl_01
```
