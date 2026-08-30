# CLI Capability Manifest — run

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `run:init`

Initialize a capsule run root and write its initial manifest.

Deterministic auto-initialization ensuring .olt/capsules/<run_id>/ exists on disk before any subagent work.

- **Aliases**: none
- **Stdin**: reads stdin when `--prompt-stdin` is set
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root or run ID. |
| `--run-id` | string | no | no | - | Alias of --run. |
| `--repo` | string | no | no | `.` | Repository root. |
| `--prompt` | string | no | no | - | Prompt string for run initialization. |
| `--mode` | string | no | no | - | Capsule mode (feature, bugfix, investigation, etc.). |
| `--actor` | string | no | no | - | Agent or actor initializing the run. |
| `--capture-mode` | string | no | no | - | Capture mode (file, stdin, argv). |
| `--source-verified` | bool | no | no | - | Whether source is verified. |
| `--no-runtime-pin` | bool | no | no | - | Do not pin runtime code. |
| `--runtime-source` | string | no | no | - | Runtime source directory to pin. |
| `--allow-existing` | bool | no | no | `true` | Allow initializing an already existing run. |

```bash
bun harness.ts run:init --run <run-id>
```

### `run:exec`

Run a gate command under process isolation and record the evidence.

Captures argv, cwd, timestamps, exit code and log bytes into the capsule, then ingests any screenshots, visual report and browser run metadata the command produced.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: forwarded to the child process

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | no | no | - | Task the command belongs to. |
| `--gate` | string | no | no | - | Gate id the command proves. |
| `--cwd` | string | no | no | - | Working directory; falls back to the repository root. |
| `--actor` | string | yes | no | - | Who is running the command. Recorded on the command and its event; there is no default actor. |
| `--tool-category` | string | no | no | - | Generic category of the tool, e.g. browser-automation, build, database, documentation, file-edit, formatter, http-client, linter, package-manager, search, shell, test-runner, type-checker, version-control. Any other value is recorded as given. |
| `--tool` | string | no | no | - | The tool this command invoked, named as you name it. |
| `--tool-extra` | string | no | yes | - | One tool-specific fact about this command as <key>=<value>, kept verbatim under the reported name. |

```bash
bun harness.ts run:exec --run .olt/capsules/<run-id> --task task-1 --gate gate-1 --actor val-1 --tool-category test-runner --tool bun-test -- bun test tests/unit/auth.test.ts
```

### `run:status`

Show phase, per-task status and progress for the run.

Reads the capsule without mutating it and renders the execution table.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. Defaults to current repository .olt/capsules/ when omitted. |
| `--run-id` | string | no | no | - | Alias of --run. |
| `--repo` | string | no | no | `.` | Repository root to search for .olt/capsules/. |
| `--detailed` | bool | no | no | - | Include the raw state in the JSON result. |

```bash
bun harness.ts run:status --run .olt/capsules/<run-id>
```

### `run:complete`

Seal the capsule after verifying every completion artifact.

Re-verifies the recorded command evidence and the live repository binding, then commits terminal completion and regenerates the summary suite.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is completing the run. Recorded on the completion event; there is no default actor. |
| `--auth-token` | string | yes | no | - | The token critic:review handed back on approval; verified against the completeness critic's own record before the run can be sealed. |

```bash
bun harness.ts run:complete --run .olt/capsules/<run-id> --actor coordinator --auth-token <token-from-critic:review>
```

### `shell`

Execute direct non-interactive CLI commands under mechanical RBAC policy with signed evidence.

Validates actor role capabilities against repository policy (blocking un-targeted whole-suite runs and cognitive validator commands) and emits cryptographic receipts into evidence/ and telemetry.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: forwarded to the child process

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | yes | no | - | Who is executing the command. |
| `--run` | string | no | no | - | Capsule run root (optional if running standalone). |
| `--run-id` | string | no | no | - | Alias for --run. |
| `--task` | string | no | no | - | Task id this command belongs to. |
| `--gate` | string | no | no | - | Gate id proven by this command. |
| `--cwd` | string | no | no | - | Working directory for the execution. |
| `--role` | string | no | no | - | Explicit role override if actor metadata is not initialized on disk. |

```bash
bun harness.ts shell --actor imp-1 -- bun test tests/unit/auth.test.ts
bun harness.ts shell --actor val-1 -- git status
bun harness.ts shell --actor imp-1 --run .olt/capsules/<run-id> --task task-1 -- bun test tests/unit/parser.test.ts
```
