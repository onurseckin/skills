# 03. The Lifecycle Walkthrough

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)

---

## 🧭 The End-to-End Orchestration Lifecycle

A complex request moves through ten deterministic stages, plus one optional adversarial check between
Compile and Dispatch. Each has defined inputs, recorded outputs, and a transition the harness will
refuse to make without evidence.

```text
  1. CAPTURE          2. ENHANCE          3. DECLARE           4. COMPILE
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ prompt.md   │ ──> │ Agent's     │ ──> │ Tasks bound │ ──> │ Requirements│
│ (SHA-256)   │     │ repo reading│     │ to lines    │     │ DAG + waves │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │ *
                                                                    ▼
  8. PROBE & REPAIR    7. VALIDATE         6. EXECUTE          5. DISPATCH
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Probe demand│ <── │ Independent │ <── │ Lease, edit,│ <── │ Ready now,  │
│ or defect   │     │ validator   │     │ branch, gate│     │ registered  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
  9. GATES & CRITIC   10. COMPLETE
┌─────────────┐     ┌─────────────┐
│ Run gate +  │ ──> │ Mechanical  │
│ sign-off    │     │ terminal OK │
└─────────────┘     └─────────────┘
```

`*` Between Compile and Dispatch sits an optional eleventh stage the diagram above has no numbered
box for, because it is an adversary the coordinator opts into rather than a step every run takes:
**Stage 4½, Plan Review** (`plan:validate-start` / `plan:review`). See below.

---

## 🔍 The Ten Stages

### Stage 1: Capture (`plan:init`)

```bash
printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <slug> --prompt-stdin
bun harness.ts plan:init --repo . --run <slug> --prompt-file prompt.txt --capture-mode file
```

Creates `.capsules/<run-id>/` with `prompt.md` at mode `0444`, `manifest.json` bound to its SHA-256,
an empty `events.jsonl` and `state.json`. Assurance is `source-verified` for a direct stream or file
read, `recorded-unverified` for a transcribed copy. The command refuses if `.capsules` is not
gitignored. `--run` here is a **bare run id** — never `.capsules/<run-id>` — because this is the one
command that builds that path; see [Chapter 01 §02](./02-capsule-and-storage-model.md), under
"Run-Id Typing," for exactly what is and isn't accepted, and why every other stage below takes the
full capsule root instead.

There is a second, equivalent entry point: `orchestrate` takes the user's entire message as free
text — `bun harness.ts orchestrate Add a slugify helper...`, or a piped stdin with no flags at all —
captures it byte-for-byte with the identical guarantee as `plan:init`, and opens the capsule in one
call. It cannot run Stage 2 for you: deciding what the repository actually contains needs a model's
judgment, and the harness never calls one on its own. What it hands back instead is the fixed
checklist for everything that comes after, bound to the run it just opened, so the calling agent
never has to reconstruct that sequence from memory. A registered flag such as `--repo` or `--run`,
if it appears _after_ the free-text prompt on the command line, is refused outright rather than
silently folded into the captured bytes — a concrete, previously-real bug this guard exists to
close: `orchestrate fix the bug --repo /other` used to corrupt the prompt capture with flag syntax
the user never meant as prose, while silently discarding `--repo`'s actual effect.

### Stage 2: Enhance (`plan:enhance`)

```bash
bun harness.ts plan:enhance --run .capsules/<slug> --actor planner \
  --summary "<what this run is about>" --observation "<what the repo actually contains>" \
  --todo "<one organised step>" --risk "<what could go wrong>" --source <file-actually-read>
```

Writes `planning/enhanced-plan.md` and `.json` read-only and records their digests in
`state.planning`. Everything in it is `agent_reported`: the harness asks no model anything, and the
document is explicitly derived. `prompt.md` stays the requirement source.

### Stage 3: Declare (`plan:add`)

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor planner --id <task-id> \
  --label "<label>" --scope <path> --gate "<gate-cmd>" --requirement-lines "3-5" [--deps <dep-id>]
```

`--requirement-lines` binds the task to the prompt lines it implements. Without it the compiler glues
the task to the next unclaimed non-blank line by position and warns. Every `--deps <id>` also needs
its own `--dep-reason <id>:"<why this edge exists>"` — `plan:compile` will not seal the plan while any
edge lacks one — and a whole batch of tasks can be declared in a single call with
`--auto-partition <glob> --gate-template "<cmd with {scope}>"` instead of one `plan:add` per task; see
[Chapter 02 §02](../02-requirements/02-line-disposition-algorithm.md) for both in full.

### Stage 4: Compile (`plan:compile`)

```bash
bun harness.ts plan:compile --run .capsules/<slug> --actor planner --completion-gate "bun test tests"
```

Before anything else, this command runs the same six-invariant structural audit `plan:audit` runs
standalone (compressed decomposition, non-discriminating shared gates, false dependency barriers,
wave stragglers, whole-suite task gates) and **refuses to seal the plan** on any blocking finding
unless it was explicitly accepted with `--accept-audit "<invariant-id>:<reason>"`, once per finding —
there is no blanket override. It then refuses separately if any dependency edge in the buffer still
lacks its `--dep-reason` justification. Only once both checks clear does it derive one requirement
per task, dispose every non-blank prompt line, check scope independence, build the graph at revision
1, and record `state.topology` — the waves and the per-task scheduling decision that produced them.
`--completion-gate` is mandatory and has no default. See [Chapter 02 §02](../02-requirements/02-line-disposition-algorithm.md),
under "Two Checks Before a Plan Can Be Sealed," for the full mechanics of both checks, including
exactly what each of the six invariants looks for.

### Stage 4½: Plan Review (`plan:validate-start`, `plan:review`) — optional

```bash
bun harness.ts plan:validate-start --run .capsules/<slug> --validator plan-val-1
bun harness.ts plan:review --run .capsules/<slug> --validator plan-val-1 --token <token> \
  --status approved --decomposition-answer "..." --dependency-answer "..." \
  --gate-answer "..." --straggler-answer "..." \
  --dependency-edges-reviewed "..." --gate-ids-reviewed "..." --summary "<verdict>"
```

The structural audit in Stage 4 is mechanical — it can only check what a static heuristic can see.
This stage adds a second, genuinely independent check: a plan-validator agent (never the coordinator
or planner that produced the plan) reads the compiled graph and answers, in writing, the same four
questions every time, pass or reject — decomposition, dependency justification, gate discrimination,
straggler risk. Unlike every other adversary in this lifecycle, it judges the _plan_, never the code,
because there is no code yet. It is **optional**: most runs never dispatch one, and `state.json`
simply has no `plan_validation` key when none was. But once one _is_ dispatched, its verdict is not
advisory — a recorded `changes_requested` against the live graph revision is a hard stop
`task:claim` enforces directly, refusing every implementer and repairer claim until a fresh compile
brings back a passing review. See [Chapter 02 §03](../02-requirements/03-authority-decisions-and-dispositions.md),
under "A Second, Independent Gate," for the full protocol.

### Stage 5: Dispatch (`queue:wave`, `agent:register`, `task:claim`)

```bash
bun harness.ts queue:wave --run .capsules/<slug>
bun harness.ts agent:register --run .capsules/<slug> --agent <id> --role implementer \
  --host <host> --parent-agent <coordinator> --parent-task <task-id>
bun harness.ts task:claim --run .capsules/<slug> --task <task-id> --agent <id> --role implementer
```

`queue:wave` reports every task claimable right now, so each one is dispatched as an agent frees up
rather than as a batch to wait on. `queue:pop` claims a single task atomically and fills one freed
slot. `task:claim`
demands an explicit `--role` and returns a one-time bearer token; only its digest is persisted.

### Stage 6: Execute (`run:exec`, `branch:*`, `task:submit`)

```bash
bun harness.ts run:exec --run .capsules/<slug> --task <task-id> --gate <gate-id> \
  --actor <agent> -- <gate-argv...>
bun harness.ts task:submit --run .capsules/<slug> --task <task-id> --agent <agent> \
  --token <token> --summary "<what changed>"
```

The agent writes only inside its leased scope and heartbeats with `task:heartbeat`. If the work turns
out to split, `branch:open` subdivides it at execution time without touching the plan revision; the
parent's lease clock freezes until `branch:collect` or `branch:abandon`. `--summary` is mandatory on
submit, and `files_changed` comes from a Git observation narrowed to the write scope.

`task:claim` and `task:submit` each compute a sha256 content digest of every file the write scope
currently holds on disk — not by timestamp, since a Git checkout or rebase can rewrite mtimes on
files nobody touched, which would misreport as work that never happened. If the two digests are
byte-identical, `task:submit` refuses the submission outright: `--no-op --reason "<why this
legitimately needed no change>"` is the one way past that refusal, and it is only accepted when the
scope genuinely didn't change; declaring `--no-op` against a scope that _did_ change is refused just
as firmly, the other way round. An unexplained no-change submission is always an error, never
silently inferred as intentional.

### Stage 7: Validate (`task:validate-start`)

```bash
bun harness.ts task:validate-start --run .capsules/<slug> --task <task-id> --validator <val-agent>
bun harness.ts run:exec --run .capsules/<slug> --task <task-id> --gate <gate-id> \
  --actor <val-agent> -- <gate-argv...>
```

A fresh, independent validator is assigned and receives allowlisted context stripped of implementer
prose. It must be independent of the implementers **and** of every previous validation of this task —
a repair round needs a new validator.

### Stage 8: Probe and Repair (`task:probe`, `task:reject`, `task:claim --role repairer`)

```bash
bun harness.ts task:probe --run .capsules/<slug> --task <task-id> --validator <val-agent> \
  --token <token> --demand "Prove <property>"

bun harness.ts task:reject --run .capsules/<slug> --task <task-id> --validator <val-agent> \
  --token <token> --reason "<observed defect>" --severity critical --remediation "<what fixes it>"
```

These are different acts. A **probe** demands proof, leaves `repair_round` untouched, keeps the task
`validating`, and is mandatory at least `min_adversarial_probes` (default 1) times before a pass. A
**rejection** asserts an observed defect, moves the task to `changes_requested`, and consumes one of
`max_repair_rounds` (default 6). On the sixth the task becomes `escalated`.

### Stage 9: Sign-off, Run Gate and Critic

```bash
bun harness.ts task:review --run .capsules/<slug> --task <task-id> --validator <val-agent> \
  --token <token> --status pass --checks <command-id> --resolve <finding-id>=<command-id>

bun harness.ts run:exec --run .capsules/<slug> --gate gate-run-completion \
  --actor coordinator -- bun test tests
bun harness.ts critic:start --run .capsules/<slug> --critic critic-lead
bun harness.ts critic:review --run .capsules/<slug> --critic critic-lead --token <token> \
  --decision approve --proofs-file proofs.json --summary "<verdict>"
```

A pass requires one `--resolve` per open finding, probe demands and defects alike, and is refused
while a mandatory gate's recorded run exited nonzero. The critic must prove every requirement with
commands it ran itself; a requirement with no proof is recorded `unproven` and blocks completion.

### Stage 10: Complete (`agent:release`, `run:complete`)

```bash
bun harness.ts agent:release --run .capsules/<slug> --agent <id> --reason "<why>"
bun harness.ts run:complete --run .capsules/<slug> --actor coordinator \
  --auth-token <token-from-critic:start>
bun harness.ts run:status --run .capsules/<slug>
```

Close every grant first — a completed run is terminal and refuses further mutation. `--auth-token` is
mandatory: it is the same bearer token `critic:start` minted for the critic, checked against that
assignment's own token digest rather than the critic's live grant — `critic:review` never mints or
returns a token of its own. Completion passes if and only if:

1. Zero integrity or traceability issues exist.
2. Every prompt line is disposed and every requirement is proven with command evidence.
3. All tasks are `done`, with zero active leases and zero open findings.
4. All mandatory gates succeeded and still match the live repository binding.
5. The completeness critic issued a clean approval.

---

## 🔄 The Formal Task State Machine

```text
                     ┌───────────┐
                     │ proposed  │
                     └─────┬─────┘
                           │ (all dependencies are 'done')
                           ▼
                     ┌───────────┐
       ┌────────────>│   ready   │<──────────── retry_ready ◀── recover / task:release
       │             └─────┬─────┘
       │ (lease expiry)    │ (queue:pop / task:claim --role + bearer token)
       │                   ▼
       │             ┌───────────┐
       ├─────────────┤  leased   │
       │             └─────┬─────┘
       │                   │ (work begins; task:heartbeat)
       │                   ▼
       │             ┌───────────┐   branch:open   ┌───────────┐
       ├─────────────┤  running  ├────────────────>│ branched  │
       │             └─────┬─────┘<────────────────┤ (lease    │
       │                   │      branch:collect / │  frozen)  │
       │                   │      branch:abandon   └───────────┘
       │                   │ (task:submit --summary)
       │                   ▼
       │             ┌───────────┐
       │             │ submitted │
       │             └─────┬─────┘
       │                   │ (task:validate-start, fresh validator)
       │                   ▼
       │             ┌────────────┐  task:probe   ┐
       │             │ validating │<──────────────┘ stays validating,
       │             └─────┬──────┘                 probe_round +1
       │                   │
       │         ┌─────────┴─────────┐
       │         │ (task:review pass │ (task:reject)
       │         │  + --resolve all) │
       │         ▼                   ▼
       │   ┌───────────┐       ┌───────────────────┐
       │   │ validated │       │ changes_requested │
       │   └─────┬─────┘       └─────────┬─────────┘
       │         │ (run:exec task gates) │ (task:claim --role repairer)
       │         ▼                       │
       │   ┌───────────┐                 │  after max_repair_rounds (6)
       │   │  gating   │                 ▼
       │   └─────┬─────┘           ┌───────────┐
       │         │ (all gates pass)│ escalated │
       │         ▼                 └───────────┘
       │   ┌───────────┐
       │   │   done    │
       │   └───────────┘
       │
       └─> [ recover ] ──> retry_ready
```

---

## 📊 Summary of Task States

| State                   | Meaning                                                                               | Permitted next actions                                  |
| :---------------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------ |
| **`proposed`**          | In the plan, waiting on prerequisites.                                                | Becomes `ready` when dependencies are `done`.           |
| **`ready`**             | Unblocked and eligible for a wave.                                                    | `queue:wave` then `task:claim`, or `queue:pop`.         |
| **`retry_ready`**       | Released or recovered; holds no lease but is claimable.                               | `task:claim`.                                           |
| **`leased`**            | Claimed; one-time bearer token issued; timer running.                                 | `task:heartbeat`, `run:exec`, `task:submit`.            |
| **`running`**           | Active work with recorded progress.                                                   | `task:submit`, `branch:open`, `task:release`.           |
| **`branched`**          | Subdivided at execution time; **lease clock frozen**, never reaped as stale.          | `branch:collect` or `branch:abandon`.                   |
| **`submitted`**         | Report recorded; write lease closed.                                                  | `task:validate-start` with a fresh validator.           |
| **`validating`**        | An independent validator holds the validation token.                                  | `run:exec`, `task:probe`, `task:review`, `task:reject`. |
| **`validated`**         | Passed with validator-owned command evidence.                                         | Mandatory task gates via `run:exec`.                    |
| **`gating`**            | Task gates running under the watchdog.                                                | `done` when every gate exits 0.                         |
| **`changes_requested`** | A defect finding is open.                                                             | `task:claim --role repairer`, fix, `task:submit`.       |
| **`done`**              | Terminal success. Unblocks dependants.                                                | None.                                                   |
| **`blocked`**           | Held back by something outside the repair loop, e.g. an ungranted authority decision. | Whatever removes the block, then `ready`.               |
| **`escalated`**         | Repair budget spent (6 rounds) or an unresolvable blocker.                            | Human intervention or a plan revision.                  |
| **`cancelled`**         | Requirements disposed out of scope.                                                   | None.                                                   |
| **`stale`**             | Lease expired and not yet recovered.                                                  | `recover`.                                              |

---

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)
