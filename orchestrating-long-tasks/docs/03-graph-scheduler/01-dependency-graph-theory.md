# 01. Dependency Graph Theory & Schema

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

[⬅ Previous: Authority Decisions](../02-requirements/03-authority-decisions-and-dispositions.md) | [Master Table of Contents](../README.md) | [Next: Topological Conflict-Free Batching ➡](./02-topological-conflict-free-batching.md)

---

## 🕸️ Why a Formal Graph?

Complex engineering projects cannot be represented as simple linear "to-do lists." In any non-trivial codebase:

- Task D depends on Task A and Task B.
- Task C can run completely in parallel with Task A.
- Task E produces an artifact consumed by Task F.
- Multiple tasks might relate to the same semantic topic or feature requirement.

To model these multi-dimensional relationships deterministically, `orchestrating-long-tasks` compiles a **Strict Relational Dependency Graph** through `plan:add` and `plan:compile`.

> **Two graphs, two vocabularies.** The _plan graph_ in `state.graph` is what the scheduler reasons
> over: 8 node types, 10 edge types, cycle-free on `depends_on`. The _narrative graph_ written by
> `summary:export` is a different artifact with its own richer vocabulary — 19 edge kinds, sections,
> per-node evidence — built for a human reading the run afterwards. This chapter describes the first;
> [Chapter 09 §03](../09-branching-and-honesty/03-evidence-classes-and-honesty.md) describes the second.

---

## 🏷️ The 8 Node Types

The graph schema recognizes exactly eight formal node types:

```text
+-----------------------------------------------------------------------------------------------+
|                                      THE 8 GRAPH NODE TYPES                                   |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  1. requirement  ---> An atomic, testable obligation decomposed from the prompt.              |
|  2. task         ---> An executable unit of work with exclusive write scopes and gates.       |
|  3. artifact     ---> A concrete deliverable or file collection produced by a task.          |
|  4. gate         ---> A literal, non-interactive command contract proving task acceptance.    |
|  5. agent        ---> A named identity leased to execute, validate, or criticize.            |
|  6. finding      ---> A structured defect report issued by an independent validator.          |
|  7. decision     ---> An audited user authority decision (grant/decline) or architectural choice|
|  8. topic        ---> A high-level semantic grouping or domain concept.                      |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## 🔗 The 10 Edge Types & Directionality

Edges represent typed relationships between nodes. The vocabulary is strictly closed to prevent ambiguity:

| Edge Type             | Valid Source Node         | Valid Target Node      | Meaning                                                                              |
| :-------------------- | :------------------------ | :--------------------- | :----------------------------------------------------------------------------------- |
| **`depends_on`**      | `task`                    | `task` (Prerequisite)  | **Directional execution prerequisite.** Target must be `done` before Source can run. |
| **`implements`**      | `task`                    | `requirement`          | Declares which atomic requirements the task fulfills.                                |
| **`produces`**        | `task`                    | `artifact`             | Declares the deliverables created by this task.                                      |
| **`validates`**       | `gate` / `agent`          | `task` / `requirement` | Binds verification evidence to work.                                                 |
| **`evidenced_by`**    | `requirement` / `finding` | `gate` / `command`     | Points to command execution receipts.                                                |
| **`assigned_to`**     | `task`                    | `agent`                | Records worker leasing.                                                              |
| **`discovered_from`** | `finding`                 | `task` / `gate`        | Traces defect origin.                                                                |
| **`supersedes`**      | `task` / `artifact`       | `task` / `artifact`    | Versioning and replacement links.                                                    |
| **`blocks`**          | `finding`                 | `task`                 | Prevents task completion.                                                            |
| **`relates_to`**      | Any                       | Any                    | General semantic relation (can form cycles).                                         |

---

## 🔄 Execution DAG vs. Relational Cycles

The harness makes a critical distinction between **Execution Dependencies** and **Semantic Relations**:

1. **`depends_on` (Execution Graph): MUST BE A DAG (Directed Acyclic Graph)**
   - Cyclic dependencies (`Task A -> Task B -> Task A`) represent deadlock and are **strictly rejected** during `plan:compile`.
   - The graph engine runs a topological cycle-detection algorithm on all `depends_on` edges before compiling the execution plan.

2. **`relates_to` (Semantic Graph): CYCLES PERMITTED**
   - Topic nodes and semantic concepts (e.g. `Auth System` $\leftrightarrow$ `Database Layer`) can have bidirectional or cyclic relations without affecting task execution.

---

## 📜 Declarative CLI Assembly

Tasks and gates are declared and compiled using the zero-JSON colon commands:

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor planner --id task-auth \
  --label "Implement Authentication" --scope src/auth \
  --gate "bun test tests/auth.test.ts" --requirement-lines 3

bun harness.ts plan:compile --run .capsules/<slug> --actor planner \
  --completion-gate "bun test tests/unit"
```

`plan:compile` writes three things at once: the requirements document, the graph at revision 1, and
`state.topology` — the wave assignment and the reason each task landed where it did. The gate ids it
derives follow the task ids: `task-auth` yields `gate-auth`, and the run-scope gate declared by
`--completion-gate` is always `gate-run-completion`.

---

## 🤖 Deriving Tasks From a Glob: `--auto-partition`

Hand-declaring one `plan:add` call per file is how a coordinator's incentives quietly drift toward
fewer, bigger tasks — a documented incident had a coordinator hand-roll one task per curriculum file
instead of letting the harness derive the partition, and the plan compressed into something far more
monolithic than the prompt actually named. `--auto-partition` is the countermeasure: the planner
declares a glob, and the harness enumerates what actually exists on disk and derives one task per
match, so "fewer tasks means less bookkeeping" stops being the path of least resistance.

```bash
bun harness.ts plan:add --run .capsules/<slug> --id task-topic --label "Topic bank" --actor coordinator \
  --auto-partition "src/curriculum/mlQuestions/*.ts" --gate-template "bun test {scope}"
```

- **`--auto-partition <glob>`** is mutually exclusive with `--scope`, `--gate`, `--deps` and
  `--dep-reason` — auto-partitioned tasks derive their scope and gate from the glob and are
  independent roots by construction (no dependency edges, so nothing to justify).
- **`--gate-template`** must contain the literal placeholder `{scope}`, substituted per generated
  task with that task's own matched file (or directory) path.
- **`--group-by file`** (the default) emits one task per matched file. **`--group-by directory`**
  emits one task per directory that holds at least one match, with that task's write scope set to
  the directory and every match inside it as its files.
- Every generated task id is `<id-prefix>-<slugified-scope>` and every generated label is
  `<label-prefix>: <scope>` — the glob author never hand-picks which files land in which task; the
  harness derives granularity from what actually exists on disk.
- The glob matcher is a pragmatic, non-POSIX translator: `*` and `?` never cross a `/`, and a bare
  `**` segment matches zero or more whole path segments — `src/**/*.ts` also matches `src/a.ts`
  directly. It walks the real repository tree, skipping `.git`, `.capsules`, `node_modules`, `.bun`,
  `.cache`, `coverage`, `__pycache__` and any symlink, and throws rather than silently registering
  nothing if the glob matches zero files.

---

## 📋 The Mandatory Topology Declaration (C6)

Every dependency edge a coordinator declares by hand must carry the one-line reason it exists:

```bash
bun harness.ts plan:add --run .capsules/<slug> --id task-integration --label "Integration" \
  --scope src/integration --gate "bun test tests/integration" --actor coordinator \
  --deps task-db,task-cli \
  --dep-reason "task-db:reads the schema task-db writes" \
  --dep-reason "task-cli:reads the CLI wiring task-cli writes"
```

`plan:compile` refuses to seal the plan while any `--deps` id lacks a matching `--dep-reason` — there
is no default and no way to declare an edge silently. The design principle is that stating _why_ an
edge exists is what makes an unjustified barrier visible to the coordinator that just drew it; a false
barrier can look scope-disjoint and still slip past every structural check if nothing forces the
coordinator to say why they drew it. `plan:compile`'s brief reports the independent-root count and
every justified edge (`"Topology Declaration": 3/5 tasks are independent roots; 2 dependency edge(s),
all justified`). This check runs strictly after the six-invariant plan audit (`plan:compile` runs the
audit first, then this declaration check, then builds the graph) — see [Chapter 03
§03](./03-plan-revision-and-freezing.md) for the audit and for the plan-validator, the second,
independent adversary that reviews the plan once it's compiled.

---

[⬅ Previous: Authority Decisions](../02-requirements/03-authority-decisions-and-dispositions.md) | [Master Table of Contents](../README.md) | [Next: Topological Conflict-Free Batching ➡](./02-topological-conflict-free-batching.md)
