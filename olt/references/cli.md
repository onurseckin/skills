# Pinned Runtime CLI

Every harness operation runs through `olt/scripts/harness.ts` (or the installed
entrypoint `~/.agents/skills/olt/scripts/harness.ts`).

**This file documents no command.** The command surface is generated from the command registry, so
there is exactly one description of every command, its flags, its stdin rule and its exit codes:

| Where                                                          | What it is                                                                           |
| :------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| [`cli-capabilities.md`](cli-capabilities.md)                   | Index: exit codes, the domain list, and every command's one-line summary. Read this. |
| [`cli-capabilities/domains/`](cli-capabilities/domains/)       | One file per domain with the full detail: flags, stdin rule, examples.               |
| [`cli-capabilities/index.jsonl`](cli-capabilities/index.jsonl) | One compact, self-contained JSON record per command — the fast grep target.          |
| [`cli-capabilities/commands/`](cli-capabilities/commands/)     | One pretty-printed JSON file per command with its complete flag definitions.         |
| `bun harness.ts help`                                          | Every command grouped by domain.                                                     |
| `bun harness.ts help <command>`                                | One command: summary, flags, stdin rule, exit codes, examples.                       |
| `bun harness.ts <command> --help`                              | The same page, from the command you were about to run.                               |

A unit test asserts the checked-in tree is byte-identical to what the registry renders, so it cannot
drift from the code. Hand-written command documentation can, which is why none lives here. Before
writing a command invocation into any document, check the flag exists in
`cli-capabilities/manifest.json` (`grep '"name": "<command>"' cli-capabilities/manifest.json`) or run
`bun harness.ts help <command>`. Never read the whole split tree into context at once — grep the one
record or file you need.

## Conventions that hold for every command

- Output is a markdown brief of at most 30 lines. `--format json` (or `--format=json`) returns the
  structured result instead. Both forms are stripped before the first bare `--`, so a `--format` in
  a `run:exec` child command reaches the child untouched.
- `--run` takes the capsule root, e.g. `.olt/capsules/<run-id>`. The exception is `plan:init`, which has
  no capsule yet: there `--run` (or `--run-id`) is the run id slug to create under `<repo>/.capsules`.
- Exit codes: `0` success; `3` INVALID_ARGUMENT / INVALID_STATE / INTEGRITY / PATH_SAFETY /
  UNSUPPORTED_PLATFORM, rejected before the capsule changed; `4` LOCK_TIMEOUT; `70` unclassified
  failure. `run:exec` is the exception: it exits `0` whenever the child ran at all and reports the
  child's own status in `exit_code`, which is why `task:review --status pass` reads the recorded
  exit code rather than the CLI's.
- Failures print `{"ok":false,"error":{...}}` on stderr.

## Universal flag aliasing and ergonomics

To eliminate agent friction and cognitive overhead across different command families, `execute.ts` enforces universal normalization before argument parsing:

- **Capsule and Run Root Aliasing**: Any command declaring `--run`, `--run-id`, or `--capsule` accepts any of the three interchangeably. For instance, `--capsule .olt/capsules/<id>` is mapped to `--run` cleanly.
- **Actor and Identity Aliasing**: Any command expecting `--actor`, `--agent`, or `--agent-id` accepts any of the three (e.g. `task:check --agent worker-1` is normalized to `--actor worker-1`).
- **Capsule Task Queries (`task:list --run`)**: `task:list` accepts `--run <capsule-path>` (or `--capsule`) to query and inspect capsule-level tasks directly with status, priority, and substring search filters (`--status`, `--search`), rendering both structured JSON and rich terminal markdown tables.
- **Automatic Queue Path Derivation**: When `--run` is supplied to queue commands (such as `task:prune --run <capsule>`), the CLI derives `queue-path` from the capsule's `tasks.jsonl` or falls back to repository `.olt/tasks.jsonl` without requiring explicit path flags.
- **Completeness Critic Auto-Hydration**: `critic:review` and `critic:reject` resolve the authoritative critic assignment and published role packet from capsule state, automatically binding repository evidence commands and verifying cryptographic token digests.
- **Non-Blocking Defect Logging**: Fatal harness contract exceptions and boundary lockouts are logged under flock file lock to `.olt/defects.jsonl` without blocking command completion or parent loop recovery.
