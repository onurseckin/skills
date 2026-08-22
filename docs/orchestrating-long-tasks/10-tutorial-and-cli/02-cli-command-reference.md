# 02. CLI Command Reference

[⬅ Previous: End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)

---

## 📖 The Reference Lives Somewhere Else, On Purpose

There is exactly one description of the CLI surface, and it is **generated from the command registry**:

- **[`references/cli-capabilities.md`](../../references/cli-capabilities.md)** — every command, with its
  aliases, flags (type, required, repeatable, default), stdin rule, remainder rule, exit codes and
  runnable examples.
- **[`references/cli-capabilities.json`](../../references/cli-capabilities.json)** — the same content
  as data, for anything that needs to check a command or flag mechanically.

Both are rendered by `scripts/generate-cli-manifest.ts` from `src/cli/registry/`, and a unit test
asserts the checked-in manifest still matches the registry.

That is the whole point. A hand-written copy of a CLI surface is stale the moment a flag changes, so
this chapter deliberately holds none. **Do not add one.** If a command's behaviour is documented
wrongly, it is documented wrongly in the registry, and the fix belongs there.

---

## 🔦 Reading It From the Terminal

```bash
bun harness.ts help                 # every command, grouped by domain
bun harness.ts help task:review     # flags, stdin rules and exit codes for one command
bun harness.ts task:review --help   # the same, via the --help intercept
```

```text
### Harness CLI

`bun harness.ts <command> [--flag value]` prints a markdown brief; `--format json` prints the structured result.

| Domain | Commands |
| :--- | :--- |
| plan | `orchestrate`, `plan:init`, `plan:enhance`, `plan:add`, `plan:audit`, `plan:compile`, `plan:validate-start`, `plan:review`, `plan:replan`, `plan:claim`, `plan:apply`, `plan:status` |
| queue | `queue:next`, `queue:list`, `queue:wave`, `queue:pop` |
| task | `task:claim`, `task:heartbeat`, `task:submit`, `task:validate-start`, `task:review`, `task:probe`, `task:reject`, `task:assign-repairer`, `task:release` |
| run | `run:exec`, `run:status`, `run:complete` |
| critic | `critic:start`, `critic:review`, `critic:reject`, `critic:remediate` |
| summary | `summary:export`, `summary:view` |
| inspection | `finding:get`, `report:get`, `evidence:get`, `evidence:screenshots` |
| orchestrator | `orchestrator:run`, `orchestrator:supervise` |
| branch | `branch:open`, `branch:claim`, `branch:submit`, `branch:collect`, `branch:abandon`, `branch:status` |
| agent | `agent:register`, `agent:report`, `agent:release`, `agent:list` |
| orphan | `orphan:dispose` |
| authority | `authority:decide` |
| install | `install`, `installation-status` |
| diagnostics | `health`, `doctor`, `doctor:repair`, `recover`, `worktree:reclaim` |
| gate | `gate:prove` |
```

This block is the real, current output of `bun harness.ts help` — copy-pasted, not hand-maintained,
for exactly the reason the section above gives. If it and your own terminal's `help` output ever
disagree, trust the terminal; this page can drift, the registry cannot.

---

## 🧭 Conventions That Apply Everywhere

These hold across the whole surface, so they are worth knowing before you open the manifest.

### Output

Every command prints a markdown brief of at most 30 lines. `--format json` returns the structured
result instead — and it must appear **before** any `--`, or it is forwarded to the child process as
an ordinary argument:

```bash
bun harness.ts run:exec --format json --run .capsules/<run-id> --actor val-1 -- bun test tests
```

### Exit codes

| Code | Meaning                                                                                                                            |
| :--- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success.                                                                                                                           |
| `3`  | `INVALID_ARGUMENT` / `INVALID_STATE` / `INTEGRITY` / `PATH_SAFETY` / `UNSUPPORTED_PLATFORM` — rejected before the capsule changed. |
| `4`  | `LOCK_TIMEOUT` — the capsule lock was still held at the deadline.                                                                  |
| `70` | `NOT_IMPLEMENTED`, or an unclassified failure.                                                                                     |

`run:exec` is the one exception: it exits `0` whenever the child ran at all and reports the child's
own status in `exit_code`. A gate that failed is recorded, not hidden — and `task:review --status pass`
refuses while a mandatory gate's recorded exit code is nonzero.

### Identity flags

- `--run` is the capsule root (`.capsules/<run-id>`) for every command except `plan:init`, where it
  is the run _id_ and `--repo` names the repository.
- `plan:init --run`/`--run-id` accepts either a bare run id or the same `.capsules/<run-id>` form
  every other command's `--run` uses — exactly one such prefix is stripped before validating. What it
  never accepts is an actual path: a run id containing an embedded `/` (after that one strip) is
  refused as `run_id must be an identifier, not a path`, whichever platform's path separator it is.
- `--actor` has no default anywhere it is required. The harness records who did something or refuses.
- `--role` on `task:claim` is mandatory and names the capability contract in
  `orchestrating-long-tasks/roles/<role>.md`; `--role plan-validator` on `agent:register` is the same
  idea one level up — a capability contract for reviewing the compiled plan rather than a task.

### Tokens

`task:claim`, `queue:pop`, `task:validate-start`, `plan:validate-start`, `critic:start`, `branch:open`
and `branch:claim` each print a bearer token exactly once. Only its SHA-256 digest is persisted —
reports store digests, never plaintext. A lost token is not recoverable; wait for the lease to expire,
or use `recover`.

---

## 🗺️ Which Command, When

| You want to…                               | Command                                                                                                                  |
| :----------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| Freeze the prompt and open a capsule       | `plan:init`                                                                                                              |
| Record what reading the repo taught you    | `plan:enhance`                                                                                                           |
| Declare a task bound to prompt lines       | `plan:add --requirement-lines`                                                                                           |
| Declare one task per matched file on disk  | `plan:add --auto-partition --gate-template`                                                                              |
| Justify a dependency edge before it seals  | `plan:add --deps --dep-reason`                                                                                           |
| Check the plan's own structural invariants | `plan:audit`                                                                                                             |
| Seal the plan and record the topology      | `plan:compile --completion-gate` (runs `plan:audit` itself; `--accept-audit <id>:<reason>` overrides a blocking finding) |
| Dispatch the plan's own adversary          | `plan:validate-start`, `plan:review --status approved` (or `changes_requested --findings`)                               |
| Prove a compiled gate can actually fail    | `gate:prove --task`                                                                                                      |
| See what's claimable right now             | `queue:wave` (read-only)                                                                                                 |
| Take one task at a time                    | `queue:next`, `queue:pop`                                                                                                |
| Put a subagent in the run's ledger         | `agent:register`                                                                                                         |
| Lease a task under a role                  | `task:claim --role`                                                                                                      |
| Run a gate and record the evidence         | `run:exec … -- <argv>`                                                                                                   |
| Hand work back for validation              | `task:submit --summary`                                                                                                  |
| Declare a submission that changed nothing  | `task:submit --no-op --reason` (refused without one if the scope is byte-identical to claim time)                        |
| Subdivide work you already hold            | `branch:open` … `branch:collect`                                                                                         |
| Demand proof without accusing              | `task:probe --demand`                                                                                                    |
| Record an observed defect                  | `task:reject --severity --remediation`                                                                                   |
| Sign off                                   | `task:review --status pass --resolve <finding>=<command>`                                                                |
| Audit the whole request                    | `critic:start`, `critic:review --proofs-file`                                                                            |
| Seal the run                               | `run:complete`                                                                                                           |
| See who did what                           | `agent:list`, `run:status`, `branch:status`                                                                              |
| Read the artefacts                         | `summary:view`, `summary:export`, `finding:get`, `report:get`, `evidence:get`                                            |
| Clean up after a dead agent                | `task:release`, `recover`                                                                                                |
| Check the capsule                          | `doctor`                                                                                                                 |

---

[⬅ Previous: End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)
