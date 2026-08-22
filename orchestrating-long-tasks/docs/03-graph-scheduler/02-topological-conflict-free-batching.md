# 02. Topological Conflict-Free Batching & The Recorded Topology

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

[⬅ Previous: Dependency Graph Theory](./01-dependency-graph-theory.md) | [Master Table of Contents](../README.md) | [Next: Plan Revision & Freezing ➡](./03-plan-revision-and-freezing.md)

---

## ⚡ One Authority for "What May Run Together"

When several coding agents run at once, chaos follows if two of them edit overlapping paths. There is
exactly **one** function that decides which tasks may run together — `proposeBatch` — and every
command that answers a scheduling question calls it: `queue:next`, `queue:list`, `queue:wave`,
`queue:pop`, and the topology recorder inside `plan:compile`.

That single authority is the point. A second, divergent derivation of "which wave is this task in"
was exactly how a plan and its summary could disagree about the same run.

---

## 🧮 The Algorithm, Exactly

```text
[ state.graph + state.tasks ]
          │
          ▼
1. Reject outright unless a plan has been applied
   → "a plan must be applied before scheduling"
          │
          ▼
2. Candidate filter. A task is eligible when ALL of:
     • status ∈ { proposed, ready, retry_ready }
     • its requirements are executable (no ungranted authority gate)
     • it conflicts with no task that currently OCCUPIES a scope
     • every dependency is done
          │
          ▼
3. Rank the eligible set with the 6-factor comparator
          │
          ▼
4. Greedy pack: walk the ranked list, take a task only if it conflicts
   with nothing already selected
          │
          ▼
5. Clamp to maxParallel (config default_max_parallel, default 4)
          │
          ▼
[ the wave ]
```

### Who "occupies" a scope

A task occupies its write scope when it holds active ownership _and_ is not itself dispatchable —
that is, anything outside `proposed`, `ready`, `done`, `cancelled`, `blocked`, `escalated`, `stale`,
minus the dispatchable states. `retry_ready` is deliberately excluded: a released task holds no lease
and no agent, so counting it as an occupant would let two conflicting released tasks veto each other
and leave the wave permanently empty. Conflicts _between_ candidates are resolved by the packing loop
instead.

---

## 🥇 The 6-Factor Deterministic Ranking

Ties fall through to the next factor; the last factor is total, so the order is fully deterministic.

| Rank | Property        | Direction  | Rationale                                                    |
| :--- | :-------------- | :--------- | :----------------------------------------------------------- |
| 1    | `priority`      | Descending | Explicit importance declared in `plan:add --priority`.       |
| 2    | `criticalDepth` | Descending | Longest downstream dependency chain; unblocks the most work. |
| 3    | `descendants`   | Descending | Distinct downstream tasks waiting on this one.               |
| 4    | `created_order` | Ascending  | FIFO fairness by authoring order.                            |
| 5    | `effort`        | Ascending  | Shortest job first, to clear bandwidth.                      |
| 6    | `id`            | Ascending  | Total tie-break; eliminates nondeterministic sorting.        |

---

## 🛡️ Scope Conflict Is Glob-Aware

Two scopes conflict when they can name the same literal path. That is a broader test than string
prefixing, and it has to be:

| Left       | Right              | Conflict? | Why                                                   |
| :--------- | :----------------- | :-------- | :---------------------------------------------------- |
| `src/auth` | `src/auth`         | yes       | Identical.                                            |
| `src`      | `src/auth`         | yes       | A scope owns everything beneath it.                   |
| `docs/**`  | `docs/concepts/**` | **yes**   | `**` absorbs any number of remaining segments.        |
| `src/*.ts` | `src/index.ts`     | **yes**   | `*` matches any run of characters inside one segment. |
| `src/auth` | `src/database`     | no        | Genuinely disjoint.                                   |

The matcher runs a segment-by-segment reachability table, so a `**` on either side branches between
absorbing a segment and matching nothing, and `*` inside a segment is compared against the other
side's characters rather than as an opaque string. A missed collision hands two agents the same file,
so the test errs toward conflict.

The same function guards branch sub-scopes ([Chapter 09 §01](../09-branching-and-honesty/01-execution-time-branching.md)),
so sibling sub-agents cannot overlap either.

Alongside write scopes, `resource_scope` conflicts on plain set intersection: two tasks that both
declare `port:5432` are serialised even though they touch different files.

---

## 🌊 Ask What Is Claimable Now

```bash
bun harness.ts queue:wave --run .capsules/<run-id> --max-parallel 4
```

```text
### Claimable Now: 2/4 conflict-free tasks
| Task | Label | Priority | Write Scope | Planned Wave |
| :--- | :--- | :--- | :--- | :--- |
| `task-slug` | Slugify helper | 50 | `src/slug.ts` | 1 |
| `task-truncate` | Truncate helper | 50 | `src/truncate` | 1 |

- **Topology**: recorded at graph revision 1
- **Dispatch**: each row is independently claimable now — claim it the moment an agent is free; do not wait for the rest of this list before claiming the next one.
```

`queue:wave` is **read-only**. It reports what is claimable right now, annotated with the wave
`plan:compile` recorded — a display annotation, never an instruction to wait for the rest of the
list — or states that the topology is absent, rather than inventing one. Claim each row the moment
an agent is free, with `task:claim --role`, and re-run the query whenever a slot frees.

`queue:pop` still exists and still leases exactly one task. Using it in a loop is what turns a
parallel graph into a waterfall; reach for it when you genuinely want one worker.

`--max-parallel` overrides the cap for one call; without it the configured `default_max_parallel`
applies. No formatter hardcodes a parallelism number any more — the brief above says "2/4" because
the config says 4.

---

## 🗺️ The Recorded Topology

`plan:compile` persists its scheduling decision in `state.topology` so nothing downstream has to
re-derive it:

```json
{
  "revision": 1,
  "max_parallel": 4,
  "waves": [{ "wave": 1, "task_ids": ["task-slug", "task-truncate"] }],
  "decisions": [
    {
      "task_id": "task-slug",
      "wave": 1,
      "parallel_with": ["task-truncate"],
      "serialized_after": [],
      "reason": "priority_capacity",
      "rationale": "wave 1: no dependency or scope conflict; ranked into a slot of max_parallel 4",
      "evidence_class": "derived"
    }
  ]
}
```

Three `reason` values exist: `dependency`, `write_scope_conflict`, `priority_capacity`. The
`rationale` is `agent_reported` only when a coordinator supplied the sentence; the harness's own
explanation is `derived`. There is no third source, so a decision never carries prose nobody wrote.

`summary/step-calculator.ts` reads this record instead of re-deriving waves, which is what keeps the
executive brief and the scheduler telling the same story. A capsule written before topology existed
simply has none, and readers must see that absence rather than a default.

---

## 🔬 Worked Example

Four ready tasks, `default_max_parallel: 3`:

- **Task 1** priority 100, `write_scope: ["src/auth"]`
- **Task 2** priority 95, `write_scope: ["src/auth/session"]`
- **Task 3** priority 90, `write_scope: ["src/database"]`
- **Task 4** priority 85, `write_scope: ["src/api"]`

Ranking gives `[1, 2, 3, 4]`. The packing loop takes Task 1, skips Task 2 (`src/auth` owns
`src/auth/session`), takes Task 3, takes Task 4, and stops at the cap.

**Wave:** `[Task 1, Task 3, Task 4]`. Task 2's decision is recorded with
`reason: "write_scope_conflict"` and `serialized_after: ["task-1"]`, so the plan states plainly why it
waited rather than leaving a reader to guess.

---

[⬅ Previous: Dependency Graph Theory](./01-dependency-graph-theory.md) | [Master Table of Contents](../README.md) | [Next: Plan Revision & Freezing ➡](./03-plan-revision-and-freezing.md)
