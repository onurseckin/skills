# CLI Capability Manifest — plan (authoring)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `plan:brainstorm`

Expand a prompt against the 8 Socratic vectors across iterative rounds.

Runs Socratic 8-vector brainstorming matrix expansion on prompt.md (or provided prompt), saving brainstorming.json and recording plan-brainstormed event.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root or run ID. |
| `--run-id` | string | no | no | - | Run id; interchangeable with --run. |
| `--prompt` | string | no | no | - | Verbatim prompt text override. |
| `--rounds` | int | no | no | `3` | Number of iterative brainstorming rounds to execute (default: 3). |
| `--save` | bool | no | no | `true` | Persist brainstorming.json to capsule root (default: true). |
| `--actor` | string | no | no | `planner` | Actor recorded on the event. |

```bash
bun harness.ts plan:brainstorm --run .olt/capsules/<run-id>
bun harness.ts plan:brainstorm --prompt "Build a fault-tolerant distributed queue" --rounds 3
```

### `orchestrate`

The primary entry point: the user's entire prompt in, a running orchestration out.

Takes the user's whole message as free text and captures it byte-for-byte as the immutable prompt (identical guarantee to plan:init), then opens the capsule. No flags to learn: everything typed after `orchestrate` is the prompt, and a piped stdin with no flags at all is read automatically (detected the way `cat`/`grep` do it, by checking whether stdin is actually a pipe, never by blocking an interactive terminal). --prompt-stdin and --prompt-file still work exactly as before, for a caller that wants to be explicit or that also needs --repo/--run alongside a real file or pipe. A registered flag such as --repo or --run typed AFTER the inline free text is refused rather than folded into the prompt, so it can never silently lose its effect or pollute the captured bytes — use --prompt-file or piped stdin instead of mixing flags into inline text. Returns the fixed checklist for what happens next — plan:enhance, plan:add, plan:compile, queue:wave — bound to the run it just opened, so the calling agent never has to assemble that sequence by hand. It cannot run plan:enhance itself: reading the repository and deciding what the run is actually about needs a model's judgment, and the harness never calls one. --run is optional; omitted, a run id is derived from today's date and the first few words of the prompt.

- **Aliases**: none
- **Stdin**: reads stdin when `--prompt-stdin` is set
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | `.` | Repository root that owns the capsule. |
| `--run` | string | no | no | - | Run id; interchangeable with --run-id. Derived from the prompt when omitted. |
| `--run-id` | string | no | no | - | Run id; interchangeable with --run. Derived from the prompt when omitted. |
| `--prompt-file` | string | no | no | - | File holding the verbatim prompt bytes. |
| `--prompt-stdin` | bool | no | no | - | Read the verbatim prompt bytes from stdin explicitly. Not required for a real pipe: a bare `orchestrate` with nothing else after it already reads stdin when it is not an interactive terminal. This flag exists for a caller that wants the read to fail loudly instead of silently falling through when stdin turns out not to be piped. |
| `--capture-mode` | string | no | no | - | How the prompt was captured; defaults to argv, file or stdin, whichever was actually used. |
| `--source-verified` | bool | no | no | - | Assert the prompt source was verified by the caller. |
| `--runtime-source` | string | no | no | - | Directory to pin as this run's runtime, verified and copied into runtime/. Defaults to the directory containing the currently running harness.ts. |
| `--no-runtime-pin` | bool | no | no | - | Skip pinning a runtime even when one is available by default. |

```bash
bun harness.ts orchestrate Add a slugify helper that lowercases text and collapses punctuation.
printf "%s" "$PROMPT" | bun harness.ts orchestrate
bun harness.ts orchestrate --repo . --run my-feature --prompt-file prompt.txt
```

### `plan:init`

Create a run capsule and capture the prompt bytes immutably.

Initialises <repo>/.olt/capsules/<run-id>, records the verbatim prompt with its sha256, and ensures the capsule is gitignored.

- **Aliases**: `plan-init`, `init-plan`
- **Stdin**: reads stdin when `--prompt-stdin` is set
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Run id; interchangeable with --run-id. |
| `--run-id` | string | no | no | - | Run id; interchangeable with --run. |
| `--repo` | string | no | no | `.` | Repository root that owns the capsule. |
| `--prompt-file` | string | no | no | - | File holding the verbatim prompt bytes. |
| `--prompt-stdin` | bool | no | no | - | Read the verbatim prompt bytes from stdin. |
| `--capture-mode` | string | no | no | - | How the prompt was captured; defaults to the source used. |
| `--source-verified` | bool | no | no | - | Assert the prompt source was verified by the caller. |
| `--runtime-source` | string | no | no | - | Directory to pin as this run's runtime, verified and copied into runtime/. Defaults to the directory containing the currently running harness.ts. |
| `--no-runtime-pin` | bool | no | no | - | Skip pinning a runtime even when one is available by default. |

```bash
printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <run-id> --prompt-stdin
bun harness.ts plan:init --repo . --run-id <run-id> --prompt-file prompt.txt --capture-mode file
```

### `plan:enhance`

Record the agent's reading of the repository as a reviewable plan document.

Writes planning/enhanced-plan.md and planning/enhanced-plan.json read-only and records their digests in state.planning.enhanced_plan. The agent reads the repository host-side and reports what it found; the harness asks no model anything and invents no entry, so everything recorded carries evidence_class agent_reported. The document is derived: prompt.md stays the requirement source. Needs at least one of --summary, --observation, --todo, --risk or --open-question.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--summary` | string | no | no | - | The enhanced brief: what this run is actually about. |
| `--observation` | string | no | yes | - | Something the agent found in the repository. |
| `--todo` | string | no | yes | - | One organised to-do item, in the order to do it. |
| `--risk` | string | no | yes | - | A risk the agent identified. |
| `--open-question` | string | no | yes | - | A question the agent could not answer. |
| `--source` | string | no | yes | - | A file the agent actually read. |

```bash
bun harness.ts plan:enhance --run .olt/capsules/<run-id> --actor planner --summary "Wire the drawer to the graph store" --todo "Add the state machine tab" --todo "Delete the legacy asset writes" --risk "Fixture dataset predates the new schema" --source src/graph/store.ts
```

### `plan:add`

Register a task declaration in the planning buffer.

Appends one task to the uncompiled planning buffer. Rejected once the plan has been compiled. --scope and --gate are required for a single task declaration; omit both and pass --auto-partition instead to have the harness enumerate a glob on disk and register one task per match (or per --group-by directory) in one call, each with its own gate derived from --gate-template. Every declared --deps id needs a matching --dep-reason before plan:compile will seal the plan (C6's mandatory edge justification).

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--id` | string | yes | no | - | Task id, unique within the buffer. In --auto-partition mode this is the id prefix every generated task id is built from. |
| `--label` | string | yes | no | - | Human label for the task. In --auto-partition mode this is the label prefix for every generated task. |
| `--scope` | string | no | no | - | Comma-separated write scope paths. Required unless --auto-partition is set; refused together with it. |
| `--gate` | string | no | no | - | Verification command that proves the task. Required unless --auto-partition is set; refused together with it. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--deps` | string | no | no | - | Comma-separated ids this task depends on. Refused together with --auto-partition. |
| `--dep-reason` | string | no | yes | - | One dependency's justification as "<dep-id>:<why this edge exists>". plan:compile refuses to seal while any --deps id lacks a matching --dep-reason. Refused together with --auto-partition. |
| `--goal` | string | no | no | - | Goal statement for the task. |
| `--criteria` | string | no | no | - | Semicolon-separated acceptance criteria. |
| `--priority` | int | no | no | - | Scheduling priority; higher runs earlier. |
| `--effort` | int | no | no | - | Relative effort estimate. |
| `--requirement-lines` | string | no | no | - | Prompt lines this task implements, e.g. "3-5,8". Without it the compiler glues the task to a prompt line by position and warns. |
| `--auto-partition` | string | no | no | - | A glob the harness enumerates on disk (relative to the repository root); emits one task per matched file, or per --group-by directory. Mutually exclusive with --scope, --gate, --deps and --dep-reason. |
| `--gate-template` | string | no | no | - | Command template for --auto-partition; must contain the literal placeholder {scope}, substituted per generated task with that task's own file or directory path. Required together with --auto-partition. |
| `--group-by` | string | no | no | `file` | file (default) or directory: whether --auto-partition emits one task per matched file or one task per directory holding matches. |

```bash
bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-1 --label "Database schema" --scope "src/db" --gate "bun test tests/db.test.ts" --actor coordinator
bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-2 --label "CLI wiring" --scope "src/cli" --gate "bun test tests/unit/cli" --actor coordinator --requirement-lines "3-5"
bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-3 --label "Integration" --scope "src/integration" --gate "bun test tests/integration" --actor coordinator --deps task-1,task-2 --dep-reason "task-1:reads the schema task-1 writes" --dep-reason "task-2:reads the CLI wiring task-2 writes"
bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-topic --label "Topic bank" --actor coordinator --auto-partition "src/curriculum/mlQuestions/*.ts" --gate-template "bun test {scope}"
```

### `plan:compile`

Compile the planning buffer into requirements, the DAG, and revision 1.

Checks scope independence, derives requirements from the prompt lines, builds the graph, and commits graph revision 1. The mandatory run-completion gate is whatever --completion-gate declares; the compiler has no default for it and refuses to invent one. Also refuses to seal while any dependency edge in the buffer lacks the one-line justification `plan:add --dep-reason` records for it (C6's topology declaration) — the independent-root count and every justified edge are reported on the brief. Before any of that, runs plan:audit's six invariants and refuses to seal on any blocking finding: pass --accept-audit "<invariant-id>:<reason>" once per blocking invariant to record an explicit, attributed override and proceed anyway. There is no blanket override — every blocking invariant needs its own acceptance naming who accepted it and why.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--completion-gate` | string | yes | no | - | Command the whole run is finally held to, e.g. "bun test tests/unit". Recorded as the mandatory run-scope gate; there is no default. |
| `--accept-audit` | string | no | yes | - | Accept one blocking plan:audit invariant so compilation may proceed: "<invariant-id>:<reason>". Repeatable; every blocking invariant needs its own acceptance, and an invariant the audit did not raise as blocking is refused rather than silently accepted. Never a blanket override. |

```bash
bun harness.ts plan:compile --run .olt/capsules/<run-id> --actor planner --completion-gate "bun test tests/unit"
bun harness.ts plan:compile --run .olt/capsules/<run-id> --actor planner --completion-gate "bun test tests/unit" --accept-audit "A3-gate-discrimination:task-a and task-b legitimately share the shared-fixture regression test"
```

### `plan:status`

Show the planning buffer or the compiled plan summary.

Reports every buffered task with its scope, gate and dependencies.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts plan:status --run .olt/capsules/<run-id>
```
