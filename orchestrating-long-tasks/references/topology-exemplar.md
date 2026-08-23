# Topology exemplar — the matched pair, and how the harness derives it for you

`FORENSICS.md` (`docs/planning/coordinator-conformance/`) is a real run: a coordinator compressed a
41-topic curriculum into a monolithic task, then — after being told four times by hand to stop — was
forced to reconstruct the fine-grained plan it should have written from the start. Both graphs are
below, unedited from the evidence. A weak planner imitates the nearest example it has; this is the
nearest example, and it is deliberately not the coarse one.

## Rejected: 3 nodes, 1 real lane

```
task-1-ports ──────┐
(2 minutes)         ├──► task-3-verification
task-2-curriculum ──┘
(23 files, 1 task)
```

`task-2-curriculum` carried all 23 curriculum files as one `write_scope`. `task-1-ports` finished in
two minutes and went idle; every other agent stayed idle behind the one worker auditing 23 files
alone. Three nodes on paper, one working lane in practice — the exact shape
[`references/failure-modes.md`](failure-modes.md) and `plan:audit`'s `A1-granularity` invariant exist
to refuse before it compiles.

## Compiled: 14 nodes, 12 independent roots

```
Tier 0 — 12 independent roots (no --deps on anything, verified against the compiled plan):
  task-0-ports · task-0-types
  d1:lin · d2:calc · d3:stat · d4:ml · d5:dl · d6:tok · d7:attn · d8:serv · d9:prec · d10:dist

Tier 1 — task-index-aggregation
  depends on all ten task-d* roots (reads every domain file's own index contribution)

Tier 2 — task-repo-verification
  depends on task-0-ports, task-0-types, task-index-aggregation
  (the two setup tasks plus the aggregation step — nothing else)
```

Ten domain tasks (`task-d1-linear-algebra` … `task-d10-distributed-scaling`), each one curriculum file,
ran as ten independent lanes alongside `task-0-ports` and `task-0-types` — twelve roots with no edge
between any of them. `task-index-aggregation` and `task-repo-verification` are the only real barriers
— an aggregation step reading every domain's output, and a final repo-wide check depending on both
setup tasks plus that aggregation — and each of the thirteen edges into them has a stated reason, not
an assumed one.

## How the harness gets you here without hand-authoring ten tasks

The planner's job is to declare intent; granularity is the harness's job. Enumerate what a glob
actually matches on disk and register one task per file:

```
PINNED=orchestrating-long-tasks/scripts/harness.ts
RUN=.capsules/<slug>
```

```bash
bun $PINNED plan:add --run $RUN --id task-d --label "Domain bank" --actor coordinator \
  --auto-partition "src/curriculum/mlQuestions/*.ts" \
  --gate-template "bun test {scope}"
```

This registers one task per matched file (`task-d-src-curriculum-mlQuestions-linearAlgebra-ts`, …),
each with `write_scope` set to that one file and a gate built by substituting `{scope}` with that
file's own path — never the identical whole-suite command ten tasks shared in the forensics run.
`--group-by directory` registers one task per directory holding a match instead of one per file, for
a glob whose real unit of work is a folder, not a single file. Neither mode accepts `--scope`, `--gate`,
`--deps` or `--dep-reason`: an auto-partitioned task's scope and gate come from the glob, and it is an
independent root by construction — there is nothing to justify.

## The mandatory topology declaration

A hand-declared dependency still needs a task's own `--scope`/`--gate`, plus one sentence per edge:

```bash
bun $PINNED plan:add --run $RUN --id task-index-aggregation --label "Aggregate domain indices" \
  --scope src/curriculum/index.ts --gate "bun test src/curriculum/index.ts" --actor coordinator \
  --deps task-d1-linear-algebra,task-d2-calculus-opt \
  --dep-reason "task-d1-linear-algebra:reads the question index task-d1 writes" \
  --dep-reason "task-d2-calculus-opt:reads the question index task-d2 writes"
```

`plan:compile` refuses to seal while any `--deps` id has no matching `--dep-reason` — every edge in
the compiled graph above, not only the ones a validator happens to question, carries one. The brief
reports the count: how many tasks needed no edge at all (the independent-root count), and how many
edges were declared and why. Stating the reason is what makes an edge the planner is about to invent
visible to the planner itself, before it becomes an unquestioned barrier ten agents wait behind.

```bash
bun $PINNED plan:compile --run $RUN --actor planner --completion-gate "bun test tests/unit"
```

An edge whose write scopes are provably disjoint is also `plan:audit`'s `A4-false-barrier` — see
[`references/protocol.md`](protocol.md) for the full six-invariant audit and its
`--accept-audit "<id>:<reason>"` override. The two checks are independent: a stated reason satisfies
`plan:compile`'s declaration; a genuinely unrelated scope still needs the audit's own override.

## Generation 5: Automatic Brent Work/Span Dynamic Rebalancing

Generation 5 introduces automatic Work/Span topology rebalancing using Brent's Theorem limits:

- **Work ($W$)**: Total task execution effort ($\sum \text{effort}$).
- **Span ($S$)**: Critical path length along true dependency chains.
- **Parallelism Factor ($P$)**: $P = \lceil W / S \rceil$, defining optimal concurrency headroom without artificial worker limits.
- **Automatic Edge Decoupling**: The harness (`dag:render`, `rebalanceTasksWithBrentLimits`) detects false serialization barriers where write scopes are disjoint and dataflow rationale is absent, automatically decoupling them to restore maximum concurrency lanes ($\le 40$).
- **Live Memory Integration**: Computed metrics ($W, S, P$, efficiency) are persistently recorded in `.capsules/mind/memory.json` for cross-run cognitive planning.
