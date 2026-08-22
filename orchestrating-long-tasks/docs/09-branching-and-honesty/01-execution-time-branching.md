# 01. Execution-Time Branching & Collect

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

[⬅ Previous: Stale Worker & Torn Tail Recovery](../08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md) | [Master Table of Contents](../README.md) | [Next: The Agent Grant Ledger ➡](./02-agent-grant-ledger.md)

---

## 🌿 The Problem a Branch Solves

The plan is frozen during execution for a good reason (Chapter 03): if a working agent could rewrite
its own contract, the scheduler's parallelism guarantees would be worthless. But a real implementer
regularly discovers, halfway through a leased task, that the work splits cleanly into pieces:

> _"The parser rewrite and the API change are independent, and doing them in sequence wastes an hour."_

Two bad options existed before branching:

1. **Do it serially anyway.** The agent burns wall-clock time on work that had no reason to be serial.
2. **Renegotiate the plan.** `plan:replan` raises the graph revision, invalidates in-flight contracts,
   and turns a five-minute discovery into a plan-wide event.

A **branch** is the third option. It is an execution-time subdivision of work an agent already holds.
It is deliberately **not** a plan task, so it never touches the graph revision and never fights the
structural freeze.

```text
        [ task-truncate: leased by impl-truncate, status = running ]
                                  │
                                  │ branch:open --reason "..."
                                  ▼
        [ task-truncate: status = branched, lease clock FROZEN ]
                     ┌────────────┴────────────┐
                     ▼                         ▼
        [ S-measure ]                  [ S-ellipsis ]
        scope src/truncate/measure.ts  scope src/truncate/ellipsis.ts
        sub-implementer                sub-implementer
                     │                         │
                     └────────────┬────────────┘
                                  │ branch:collect
                                  ▼
        [ task-truncate: status = running, FRESH lease, git-observed file list ]
```

---

## 🔒 The Four Rules That Make a Branch Safe

### 1. Only a live lease holder may open one

`branch:open` demands the parent's live lease token and refuses any parent that is not `leased` or
`running`. This has a consequence people trip over: **a validator cannot open a branch**, because a
task under validation holds a validation token, not a lease. Verification is widened by dispatching a
sub-validator through `agent:register`, not through the branch ledger.

### 2. Every sub-scope is a _proper_ subset of the parent scope

Not merely "inside" — strictly smaller. A parent holding `src/truncate` may hand down
`src/truncate/measure.ts`, but not `src/truncate` itself:

```text
sub-task S-1 write scope src/truncate.ts is not a proper subset of the parent
scope src/truncate.ts: a branch must hand down strictly less than it holds
```

This is the termination guarantee. Path sets are finite and every hop removes at least one path the
parent could name, so no chain of branches can run forever and no agent can branch sideways into the
scope it already holds.

### 3. Siblings are disjoint

Two sub-tasks may not claim overlapping scopes. The check is the same glob-aware `scopeConflict` the
scheduler uses, so `docs/**` and `docs/concepts/**` collide exactly as they do in a wave.

### 4. Every sub-task carries a nonempty write scope

`branch:open` refuses a sub-task with no `--sub-scope`. There is no "read-only sub-task" the harness
enforces for you: a sub-investigator is handed the narrowest slice that covers what it must read, and
its read-only guarantee is its role contract, not a filesystem permission.

---

## 📤 What `branch:open` Actually Returns

Real output from the tutorial run, opening the branch shown in the diagram above:

```bash
bun harness.ts branch:open --run .capsules/slugger --parent-task task-truncate \
  --agent impl-truncate --token "$TRUNC_TOKEN" \
  --reason "measuring the cut point and choosing the ellipsis are separable and were slowing each other down" \
  --sub-task S-measure  --sub-label S-measure="Cut-point measurement" --sub-scope S-measure=src/truncate/measure.ts \
  --sub-task S-ellipsis --sub-label S-ellipsis="Ellipsis character"   --sub-scope S-ellipsis=src/truncate/ellipsis.ts
```

```text
### Branch Opened: B-1b72a087-53c9-49bd-855e-7d8a7aa4705c
- **Parent**: `task-truncate` held by `impl-truncate` (now branched, lease frozen)
- **Reason**: measuring the cut point and choosing the ellipsis are separable and were slowing each other down
- **Depth**: 1

| Sub-task | Label | Status | Agent | Write Scope |
| :--- | :--- | :--- | :--- | :--- |
| `S-measure` | Cut-point measurement | open | unclaimed | `src/truncate/measure.ts` |
| `S-ellipsis` | Ellipsis character | open | unclaimed | `src/truncate/ellipsis.ts` |

#### Dispatch And Collect:
```

```bash
bun harness.ts branch:claim --run .capsules/slugger --branch B-1b72a087-53c9-49bd-855e-7d8a7aa4705c --sub-task <ID> --agent <AGENT>
bun harness.ts branch:collect --run .capsules/slugger --branch B-1b72a087-53c9-49bd-855e-7d8a7aa4705c --agent impl-truncate --token <PARENT_TOKEN> --summary "<WHAT CAME BACK>"
```

The brief itself hands back the two commands that close the loop — the same "trailing block naming the
exact command that undoes it" convention Chapter 10's tutorial documents for every grant and lease.
Each sub-task starts `open`/`unclaimed`: a branch declares its shape up front, and a sub-agent still has
to be dispatched with `branch:claim` before it can submit anything.

---

## ⏸️ Why the Parent's Lease Clock Freezes

A parent blocked on children is not a dead agent, but it looks exactly like one to a lease reaper: it
stops heartbeating while the sub-agents work. So `branch:open` **suspends** the parent lease — the
expiry stops advancing — and moves the task to the `branched` status.

Consequences worth knowing:

- `recover` never reaps a branched parent. It is blocked on children, not gone.
- A suspended lease still authenticates. That is exactly how the parent proves ownership at collect.
- `task:release` refuses a branched task. Collect or abandon the branch first.

---

## 📥 Collect Is Where Measurement Happens

`branch:submit` records what the sub-agent _says_ it did — a summary, `agent_reported`. Nothing about
the filesystem is measured there, because measuring twice per sub-task would report the same worktree
several times.

`branch:collect` is the single measurement point. It refuses while any sub-task is still live, then:

1. Reads the worktree through the repository Git seam and diffs it against the baseline taken at
   `branch:open`.
2. Records `files_changed` as `harness_observed` — or leaves it **absent** when Git could not be
   observed. An unobservable repository yields no file list, never an empty one.
3. Restores the parent lease with a fresh expiry and returns the task to `running`.

Real output from the tutorial run:

```text
### Branch Collected: B-1b72a087-53c9-49bd-855e-7d8a7aa4705c
- **Parent**: `task-truncate` is now running with a fresh lease
- **Reason It Branched**: measuring the cut point and choosing the ellipsis are separable and were slowing each other down
- **Outcome**: Both halves landed; the parent now composes them.
- **Files Changed**: 2 files (harness_observed)
  - `src/truncate/ellipsis.ts`
  - `src/truncate/measure.ts`
```

`branch:abandon` is the failure path: every non-terminal sub-task is marked abandoned, its lease is
released, and the parent returns to `running` to carry the work itself. The reason is mandatory,
because a branch that ended without one leaves no record of what was tried.

---

## 🧾 The Branch Ledger

Branches live in `state.branches`, never in `state.tasks`:

| Field                                          | Evidence           | Meaning                                                                                      |
| :--------------------------------------------- | :----------------- | :------------------------------------------------------------------------------------------- |
| `id`                                           | harness            | `B-<uuid>`.                                                                                  |
| `parent_task_id`                               | harness            | A plan task, or another branch's sub-task when nesting.                                      |
| `reason`                                       | `agent_reported`   | Why the work had to be subdivided. Required, and shown in the graph.                         |
| `depth`                                        | harness            | 1 at the first level; `max_branch_depth` (default 5) is an escalation tripwire, not a bound. |
| `sub_tasks[]`                                  | mixed              | Id, label, write scope, optional gate, status, lease, summary.                               |
| `status`                                       | harness            | `open` → `collecting` → `collected`, or `abandoned`.                                         |
| `files_changed`                                | `harness_observed` | Present only when Git could be read at collect time.                                         |
| `opened_observation` / `collected_observation` | `harness_observed` | The two worktree readings the diff is computed from.                                         |

Sub-task statuses are `open`, `claimed`, `branched`, `submitted`, `abandoned`. `branched` is the
mirror of the task status: a sub-agent that subdivided again is frozen until its own branch collects.

---

## 🚧 The Depth Cap Is an Escalation, Not a Structural Bound

The proper-subset rule already guarantees termination. `max_branch_depth` exists for a different
reason, and the refusal says so:

```text
branch depth 6 trips the max_branch_depth escalation threshold of 5: subdividing
task-x again means the original scoping was wrong, so escalate to the human
rather than branching deeper
```

Crossing that line is a planning signal, not a capacity problem.

---

## 🔎 Inspecting Branches

```bash
bun harness.ts branch:status --run .capsules/<run-id>
bun harness.ts branch:status --run .capsules/<run-id> --task task-truncate --all
```

Open branches are listed by default with the reason each was opened; `--all` includes collected and
abandoned ones.

---

[⬅ Previous: Stale Worker & Torn Tail Recovery](../08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md) | [Master Table of Contents](../README.md) | [Next: The Agent Grant Ledger ➡](./02-agent-grant-ledger.md)
