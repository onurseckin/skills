# Run Playbook — the phases in order

The command sequence a run moves through, phase by phase. This file gives **order and shape**; it is
not a command reference. Flags, stdin rules, exit codes and examples live in the generated
[`cli-capabilities.md`](cli-capabilities.md), and the rules each phase enforces live in
[`protocol.md`](protocol.md). Check a flag there before writing an invocation anywhere.

`orchestrate` is the primary entry point (see SKILL.md) and runs the opening of Phase 1 for you —
capture and opening the capsule — in one call, then hands back the same checklist this file spells
out phase by phase. Reach for `orchestrate` first; read the phases below for what each step in that
checklist actually does, and for everything past the opening (dispatch, branching, validation,
completion), which `orchestrate` does not run on its own.

```text
PINNED=olt/scripts/harness.ts
RUN=.capsules/<slug>
```

Every command prints a markdown brief of at most 30 lines. `--format json` returns the structured
result instead.

---

## Phase 1 — Capture, enhance, plan, compile

```bash
# Exact prompt capture — the bytes are immutable and authoritative from here on
printf "%s" "$PROMPT" | bun $PINNED plan:init --repo . --run <slug> --prompt-stdin

# Read the repository, then write down what you read. Nothing here is invented by the harness.
bun $PINNED plan:enhance --run $RUN --actor coordinator \
  --summary "<what this run is actually about>" \
  --observation "<something found in the repository>" \
  --todo "<one organised step, in order>" \
  --risk "<a risk worth stating>" \
  --open-question "<what could not be answered>" \
  --source <file-actually-read>

# Register modular tasks with disjoint write scopes, bound to the prompt lines they implement
bun $PINNED plan:add --run $RUN --id <task-id> --label "<label>" --scope <path> \
  --gate "<gate-cmd>" --actor coordinator --requirement-lines "3-5" [--deps <dep-id>]

bun $PINNED plan:status --run $RUN
bun $PINNED plan:compile --run $RUN --actor planner --completion-gate "bun test tests/unit"
```

`--completion-gate` is required: it is the command the whole run is finally held to, and the compiler
refuses to invent one. `plan:compile` also records `state.topology` — the waves and the reason each
task landed where it did — which every later reader uses instead of re-deriving parallelism.

Dynamic scope-aware replanning from critic or validator findings:

```bash
bun $PINNED plan:replan --run $RUN --actor coordinator \
  [--findings-file <file> | --findings '<json>'] [--gate "<revalidation-gate>"] [--round <n>]
```

---

## Phase 2 — Continuous dispatch

```bash
bun $PINNED queue:wave --run $RUN [--max-parallel 4]   # everything claimable right now
bun $PINNED queue:next --run $RUN                      # the single highest-priority ready task
bun $PINNED queue:list --run $RUN                      # everything, grouped by status
bun $PINNED queue:pop  --run $RUN --agent <worker-id> --lease-seconds 1800
```

`queue:wave` is a read-only readiness query: every task whose dependencies are done and whose write
scope collides with nothing currently leased, capped at `default_max_parallel`. It is not a batch to
wait on — re-run it the instant a slot frees. `queue:pop` claims one task atomically and is the right
tool for filling a single freed slot; looping it alone is what turns a graph into a waterfall.

Dispatch each claimable task as a pair — one implementer and its own independent validator, never an
implementer alone. One host call may carry several pairs when several tasks are claimable at once,
but nothing waits for the call's other pairs: a validator becomes eligible the instant its own
implementer submits. The Triad Floor and the Pairing Invariant are stated in
[`protocol.md`](protocol.md).

Whatever the host, dispatching one agent means the same abstract contract: start it with a role, a
scope and a packet; learn its id so `agent:register` can bind the grant; and know when it finishes and
what it returned. The concrete call — its name, shape and argument fields — is a per-host fact, never a
rule: read [`host-adapters.md`](host-adapters.md)'s adapter table for the one your host actually
exposes before dispatching anything.

Register every dispatched agent before it starts work. The grant is what later ties an event actor to
a role, a parent and a task, so the graph can say who did what without guessing:

```bash
bun $PINNED agent:register --run $RUN --agent val-1 --role validator --host claude-code \
  --parent-agent coordinator-1 --parent-task T-01 --model <host-reported-model> --thinking-level high
bun $PINNED agent:report   --run $RUN --agent val-1 --tool Read --tool Bash --tokens-in 18000 --tokens-out 2400
bun $PINNED agent:release  --run $RUN --agent val-1 --reason "T-01 signed off"
bun $PINNED agent:list     --run $RUN --task T-01     # who worked this task, and under whom
```

The parent must already hold a grant, so lineage is a chain rather than a claim. Model, tier,
thinking level and token counts are recorded **only** when the host reports them; `--tokens-estimated`
marks counts as derived estimates instead of measurements. Anything the host never reported stays
absent and renders as "unknown".

---

## Phase 3 — Implementation

```bash
# Claim under an explicit role: implementer for new work, repairer for changes_requested
bun $PINNED task:claim --run $RUN --task <task-id> --agent <worker-id> --role implementer

bun $PINNED task:heartbeat --run $RUN --task <task-id> --agent <worker-id> --token <token>

# --summary is mandatory: there is no honest stand-in for the agent's own account
bun $PINNED task:submit --run $RUN --task <task-id> --agent <worker-id> --token <token> \
  --summary "<what changed>" [--files-changed <path>] [--evidence <cmd-id>]

# Hand a lease back voluntarily instead of letting it rot
bun $PINNED task:release --run $RUN --task <task-id> --agent <worker-id> --token <token>
```

---

## Phase 4 — Branch and collect (execution time only)

A branch is a subdivision discovered by the agent doing the work, never a plan task. `branch:open`
requires the parent task's live **lease** token, so a validator holding a validation token cannot
subdivide the task under review. The scope and termination rules are in [`protocol.md`](protocol.md).

```bash
# 1. The working agent subdivides, with its live lease token and a reason that is recorded
bun $PINNED branch:open --run $RUN --parent-task T-01 --agent worker-1 --token <token> \
  --reason "parser rewrite blocks the API change and the two touch disjoint trees" \
  --sub-task S-1 --sub-label S-1="Fix the parser"    --sub-scope S-1=src/store/parser \
  --sub-task S-2 --sub-label S-2="Adapt the API"     --sub-scope S-2=src/api \
  --sub-gate S-1="bun test tests/unit/store/parser.test.ts"

# 2. Register and dispatch one sub-agent per sub-task, then each claims exactly one
bun $PINNED agent:register --run $RUN --agent sub-1 --role sub-implementer --host claude-code \
  --parent-agent worker-1 --parent-task S-1
bun $PINNED branch:claim  --run $RUN --branch <B-id> --sub-task S-1 --agent sub-1 --role sub-implementer

# 3. Each sub-agent hands its piece back
bun $PINNED branch:submit --run $RUN --branch <B-id> --sub-task S-1 --agent sub-1 --token <sub-token> \
  --summary "Parser accepts the new grammar and rejects the empty payload"

# 4. The parent takes the branch back and resumes its own task
bun $PINNED branch:collect --run $RUN --branch <B-id> --agent worker-1 --token <token> \
  --summary "Parser fixed; API change unblocked"

# Failure path, and what is still outstanding
bun $PINNED branch:abandon --run $RUN --branch <B-id> --agent worker-1 --token <token> --reason "<why>"
bun $PINNED branch:status  --run $RUN --all
```

---

## Phase 5 — Independent validation

```bash
bun $PINNED task:validate-start --run $RUN --task <task-id> --validator <val-agent>

# Gate proof under monitoring; the recorded exit code is what a pass is judged on
bun $PINNED run:exec --run $RUN --task <task-id> --gate <gate-id> --actor <val-agent> -- <gate-argv...>
bun $PINNED run:exec --run $RUN --task <task-id> --gate gate-ui-visual --actor <val-agent> -- bun test tests/visual

bun $PINNED evidence:get --run $RUN --task <task-id> --screenshots
bun $PINNED report:get   --run $RUN --task <task-id> --screenshots
bun $PINNED evidence:screenshots --run $RUN

# Round 1: demand proof (not a rejection, no repair budget consumed)
bun $PINNED task:probe --run $RUN --task <task-id> --validator <val-agent> --token <token> \
  --demand "Prove the parser rejects an empty payload" \
  --demand "Prove the 1280px layout has no horizontal overflow"

# Genuine defect: the validator's own severity and remediation
bun $PINNED task:reject --run $RUN --task <task-id> --validator <val-agent> --token <token> \
  --reason "<what is defective>" --severity critical --remediation "<what would fix it>" [--evidence <cmd-id>]

# Sign-off: every open finding answered, every gate green
bun $PINNED task:review --run $RUN --task <task-id> --validator <val-agent> --token <token> \
  --status pass --checks C-201,C-202 \
  --resolve probe-<task-id>-01-1=C-201 --resolve probe-<task-id>-01-2=C-202 \
  --summary "Both demands answered by fresh runs; all gates green"
```

`run:exec` exits 0 whenever the child ran at all, so read `exit_code` from the record, never the
CLI's own status.

---

## Phase 6 — Completeness critic and sealing

```bash
bun $PINNED run:exec --run $RUN --gate <run-gate-id> --actor coordinator -- <completion-gate-argv...>

bun $PINNED critic:start --run $RUN --critic <critic-id>

# Approve: requirement proofs are required, and an unproven requirement blocks completion
bun $PINNED critic:review --run $RUN --critic <critic-id> --token <token> --decision approve \
  --summary "<verdict>" --proofs-file <proofs.json>

# Or reject with structured findings, which triggers fan-back replanning via plan:replan
bun $PINNED critic:reject --run $RUN --critic <critic-id> --token <token> \
  --summary "<what is missing>" --findings-file <findings.json>

bun $PINNED run:complete --run $RUN --actor coordinator --auth-token <token-from-critic:review>
bun $PINNED run:status --run $RUN --detailed
```

---

## Phase 7 — Recovery, diagnostics and reporting

```bash
bun $PINNED recover --run $RUN --actor coordinator [--grace-seconds 30]
bun $PINNED doctor  --run $RUN
bun $PINNED agent:list --run $RUN

bun $PINNED summary:export --run $RUN [--out <viewer-registry-dir>]
bun $PINNED summary:view --run $RUN
```

`summary:export` writes `graph.json`, `timeline.json`, `metrics.json` and `summary.md` under
`<run>/summary`; `--out` additionally writes a registry export for the graph viewer.

---

## Phase 8 — Generation 5: Cognitive Telemetry, Brent Scaling & Blunder Auditing

```bash
# Render topological Sugiyama DAG with Work/Span metrics and decoupled artificial edges
bun $PINNED dag:render --run $RUN --detailed

# Real-time supervisory telemetry with Work/Span metrics and active [W<wave>:L<lane>] badges
bun $PINNED mind:pulse --run $RUN

# Blunder audit, deduplication, and candidate auto-admission
bun $PINNED blunder:audit --run $RUN --filter-status open
bun $PINNED blunder:audit --run $RUN --auto-admit --actor coordinator

# Role boundary watchdog verification across active monitors
bun $PINNED watchdog:verify --generation 1 --all
bun $PINNED watchdog:probe --run $RUN
```
