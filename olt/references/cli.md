# Pinned Runtime CLI

Every harness operation runs through `olt/scripts/harness.ts` (or the installed
entrypoint `~/.agents/skills/olt/scripts/harness.ts`).

**This file documents no command.** The command surface is generated from the command registry, so
there is exactly one description of every command, its flags, its stdin rule and its exit codes:

| Where                                            | What it is                                                                    |
| :----------------------------------------------- | :---------------------------------------------------------------------------- |
| [`cli-capabilities.md`](cli-capabilities.md)     | The full manifest, rendered from `scripts/src/cli/registry`. Read this.       |
| [`cli-capabilities.json`](cli-capabilities.json) | The same manifest as data, for anything that checks a flag before writing it. |
| `bun harness.ts help`                            | Every command grouped by domain.                                              |
| `bun harness.ts help <command>`                  | One command: summary, flags, stdin rule, exit codes, examples.                |
| `bun harness.ts <command> --help`                | The same page, from the command you were about to run.                        |

A unit test asserts the checked-in manifest is byte-identical to what the registry renders, so the
manifest cannot drift from the code. Hand-written command documentation can, which is why none lives
here. Before writing a command invocation into any document, check the flag exists in
`cli-capabilities.json`.

## Conventions that hold for every command

- Output is a markdown brief of at most 30 lines. `--format json` (or `--format=json`) returns the
  structured result instead. Both forms are stripped before the first bare `--`, so a `--format` in
  a `run:exec` child command reaches the child untouched.
- `--run` takes the capsule root, e.g. `.capsules/<run-id>`. The exception is `plan:init`, which has
  no capsule yet: there `--run` (or `--run-id`) is the run id slug to create under `<repo>/.capsules`.
- Exit codes: `0` success; `3` INVALID_ARGUMENT / INVALID_STATE / INTEGRITY / PATH_SAFETY /
  UNSUPPORTED_PLATFORM, rejected before the capsule changed; `4` LOCK_TIMEOUT; `70` unclassified
  failure. `run:exec` is the exception: it exits `0` whenever the child ran at all and reports the
  child's own status in `exit_code`, which is why `task:review --status pass` reads the recorded
  exit code rather than the CLI's.
- Failures print `{"ok":false,"error":{...}}` on stderr.
