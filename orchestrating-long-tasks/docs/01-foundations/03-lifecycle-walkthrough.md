# 03. The Lifecycle Walkthrough

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)

---

## 🧭 The End-to-End Orchestration Lifecycle

A complex request moves through ten deterministic stages. Each has defined inputs, recorded outputs,
and a transition the harness will refuse to make without evidence.

```text
  1. CAPTURE          2. ENHANCE          3. DECLARE           4. COMPILE
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ prompt.md   │ ──> │ Agent's     │ ──> │ Tasks bound │ ──> │ Requirements│
│ (SHA-256)   │     │ repo reading│     │ to lines    │     │ DAG + waves │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
                                                                   ▼
  8. PROBE & REPAIR    7. VALIDATE         6. EXECUTE          5. DISPATCH
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Probe demand│ <── │ Independent │ <── │ Lease, edit,│ <── │ Whole wave, │
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
gitignored.

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
the task to the next unclaimed non-blank line by position and warns.

### Stage 4: Compile (`plan:compile`)

```bash
bun harness.ts plan:compile --run .capsules/<slug> --actor planner --completion-gate "bun test tests"
```

Derives one requirement per task, disposes every non-blank prompt line, checks scope independence,
builds the graph at revision 1, and records `state.topology` — the waves and the per-task scheduling
decision that produced them. `--completion-gate` is mandatory and has no default.

### Stage 5: Dispatch (`queue:wave`, `agent:register`, `task:claim`)

```bash
bun harness.ts queue:wave --run .capsules/<slug>
bun harness.ts agent:register --run .capsules/<slug> --agent <id> --role implementer \
  --host <host> --parent-agent <coordinator> --parent-task <task-id>
bun harness.ts task:claim --run .capsules/<slug> --task <task-id> --agent <id> --role implementer
```

`queue:wave` returns the entire conflict-free wave so N agents launch in one batch. `queue:pop` still
exists for one-at-a-time dispatch and is what serialises an otherwise parallel graph. `task:claim`
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
bun harness.ts run:complete --run .capsules/<slug> --actor coordinator
bun harness.ts run:status --run .capsules/<slug>
```

Close every grant first — a completed run is terminal and refuses further mutation. Completion
passes if and only if:

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
