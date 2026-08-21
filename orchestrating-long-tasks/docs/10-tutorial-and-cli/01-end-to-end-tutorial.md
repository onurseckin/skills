# 01. Complete End-to-End Tutorial

[⬅ Previous: Evidence Classes & Honesty](../09-branching-and-honesty/03-evidence-classes-and-honesty.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)

---

## 🎯 What This Tutorial Is

A complete run, start to finish, on a repository you can build in two minutes. Every command below
was executed in order against that repository, and every output block is the real stdout of that
execution — including the failures that teach the most. A handful of steps are marked **🧪 Aside** —
they run against a small, separately-built illustrative capsule so a blocking refusal can be shown
without permanently wrecking the main run; each one says so explicitly.

The run exercises the whole surface that matters: prompt capture, an enhanced plan, a plan audit, an
independent plan-validator round, a compiled topology, a dispatched wave, a gate falsifiability proof,
a branch that splits work at execution time, a genuine rejection and repair, a mandatory adversarial
probe, the completeness critic, and mechanical completion.

> Substitute `bun harness.ts` with the real path to the harness, e.g.
> `bun ~/repos/skills/orchestrating-long-tasks/scripts/harness.ts`.

---

## 🧱 Step 0: Build the Demo Repository

```bash
mkdir -p slugger/tests && cd slugger && git init -q .
printf '.capsules/\n' > .gitignore
printf '{ "name": "slugger", "private": true }\n' > package.json

cat > tests/slug.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { slugify } from "../src/slug.ts";

test("lowercases and hyphenates", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});

test("collapses punctuation instead of leaving empty segments", () => {
  expect(slugify("Ship it, now!")).toBe("ship-it-now");
});
EOF

cat > tests/truncate.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { truncate } from "../src/truncate/index.ts";

test("leaves short input alone", () => {
  expect(truncate("short", 10)).toBe("short");
});

test("adds an ellipsis when it cuts", () => {
  expect(truncate("a much longer string", 6)).toBe("a much…");
});
EOF

printf '%s\n' \
  'Add a slugify helper in src/slug.ts that lowercases text and collapses punctuation into single hyphens.' \
  'Add a truncate helper under src/truncate that appends a single-character ellipsis when it cuts.' \
  > prompt.txt

git add -A && git commit -qm "chore: failing tests for slugify and truncate"
```

Two failing tests, two prompt lines, one task each. `.capsules/` **must** be gitignored before
`plan:init` will touch the repository — the harness refuses to create a capsule that git would track.

---

## 📥 Step 1: Capture the Prompt

```bash
bun harness.ts plan:init --repo . --run slugger --prompt-file prompt.txt --capture-mode file
```

```text
### Capsule Initialized: slugger
- **Capsule Root**: `…/slugger/.capsules/slugger`
- **Prompt SHA-256**: `ba20966731e18c4133cd16a43dd9d2f205c7d57844d58ce2e332cc5e2a91401d` (200 bytes)
- **Assurance**: `source-verified` | Runtime: Bun 1.3.14
- **Runtime Pin**: `<sha256>` (`<N>` files, see `runtime/`).
- **Status**: Ready for task declarations (`plan:add`).
```

The **Runtime Pin** is a hash over the harness scripts themselves, taken automatically unless
`--no-runtime-pin` is passed — it survives even if the global skill is later updated, so a capsule
stays reproducible against the exact code that opened it. The capsule now exists with `prompt.md`
(mode `0444`), `manifest.json`, `state.json`, an empty `events.jsonl`, the generated `README.md`,
`index.json` and `trace.md`, and the `blobs/ commands/ evidence/ planning/ reports/ runtime/`
directories.

`--run slugger` here is a bare **run id**, not a path — `plan:init` is the one command where `--run`
means that. It also accepts the same `.capsules/<run-id>` form every other command uses, stripping
exactly one such prefix before validating: `--run .capsules/slugger` would have worked identically.
What it never accepts is an actual path — a run id is an identifier, never a filesystem location:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"run_id must be an identifier, not a path: \"sub/dir/run\" still contains a path separator after stripping one optional \".capsules/\" prefix","issues":[]}}
```

---

## 🔎 Step 2: Record What Reading the Repository Taught You

`plan:enhance` writes a reviewable plan document. The harness asks no model anything — the agent
reads the repository host-side and reports what it found through flags.

```bash
bun harness.ts plan:enhance --run .capsules/slugger --actor planner \
  --summary "Two independent string helpers; both test files already exist and fail." \
  --observation "tests/slug.test.ts and tests/truncate.test.ts import from src/, which is empty." \
  --observation "tests/truncate.test.ts imports src/truncate/index.ts, so truncate needs a directory." \
  --todo "Implement src/slug.ts against tests/slug.test.ts" \
  --todo "Implement src/truncate/ against tests/truncate.test.ts" \
  --risk "A shared string util would put both tasks in one write scope and serialise them." \
  --open-question "Should the ellipsis be U+2026 or three dots? The test says U+2026." \
  --source tests/slug.test.ts --source tests/truncate.test.ts
```

```text
### Enhanced Plan Recorded: slugger (revision 1)
- **Document**: `planning/enhanced-plan.md` (sha256 `25948ffaa495e16278e4dddd9d22f4ed08736d8ff0d488c379d7038dda9caa10`)
- **Machine Copy**: `planning/enhanced-plan.json`
- **Brief**: reported | **To-dos**: 2 | **Observations**: 2
- **Risks**: 1 | **Open Questions**: 1 | **Sources Read**: 2
- **Evidence**: `agent_reported` throughout — this is the agent's claim about the repository, not a harness measurement.
- **Authority**: `prompt.md` (sha256 `ba20966731e18c4133cd16a43dd9d2f205c7d57844d58ce2e332cc5e2a91401d`) stays the requirement source; this document is derived.
- **Next Step**: Review the document, then declare tasks with `plan:add --requirement-lines`.
```

The document is explicitly derived. `prompt.md` remains the only thing requirements bind to.

---

## 🧩 Step 3: Declare Tasks, Bound to Prompt Lines

```bash
bun harness.ts plan:add --run .capsules/slugger --actor planner --id task-slug \
  --label "Slugify helper" --scope src/slug.ts \
  --gate "bun test tests/slug.test.ts" --requirement-lines 1

bun harness.ts plan:add --run .capsules/slugger --actor planner --id task-truncate \
  --label "Truncate helper" --scope src/truncate \
  --gate "bun test tests/truncate.test.ts" --requirement-lines 2
```

```text
### Task Registered: task-slug
- **Label**: Slugify helper
- **Write Scope**: `src/slug.ts`
- **Mandatory Gate**: `bun test tests/slug.test.ts`
- **Dependencies**: None (Parallel-ready)
- **Prompt Binding**: Declared prompt lines 1
- **Plan Size**: 1 tasks registered. Run `plan:compile` when finished adding tasks.
```

`--requirement-lines` is what binds a task to the obligation it implements. Without it the compiler
glues the task to the next unclaimed non-blank line **by position** and warns you that it did.

`task-truncate` takes a _directory_ scope. That is deliberate: it is what lets the task branch later.

Two tasks with no shared history is the simplest case. A real plan usually needs both a dependency
edge and a repeatable shape — `--dep-reason` and `--auto-partition` cover those, and Step 3B below
demonstrates both against a small separate repository.

---

## 🧪 Step 3B (Aside): Declaring Dependencies and Partitioning a Glob

This step runs against a **separate three-file repository** — `src/curriculum/topics/{algebra,geometry,calculus}.ts`
— purely to show two `plan:add` features the two-task slugger plan never needs.

**`--auto-partition`** enumerates a glob on disk and registers one task per match (or per
`--group-by directory`), each with its own gate derived from `--gate-template`'s `{scope}` placeholder:

```bash
bun harness.ts plan:add --run .capsules/partition-demo --actor planner --id task-topic \
  --label "Topic bank" --auto-partition "src/curriculum/topics/*.ts" --gate-template "bun test {scope}"
```

```text
### Auto-Partitioned: 3 tasks from `src/curriculum/topics/*.ts`
- **Grouping**: one task per file
- **Generated Tasks**: `task-topic-src-curriculum-topics-algebra-ts`, `task-topic-src-curriculum-topics-calculus-ts`, `task-topic-src-curriculum-topics-geometry-ts`
- **Dependencies**: none — auto-partitioned tasks are independent roots by construction
- **Plan Size**: 3 tasks registered. Run `plan:compile` when finished adding tasks.
```

Every generated task id is `<--id prefix>-<slugified scope>`, and `--scope`/`--gate`/`--deps`/`--dep-reason`
are all refused alongside `--auto-partition` — a partitioned task derives its scope and gate from the
glob, never from a hand-typed value.

**`--dep-reason`** is the other half of C6: a dependency edge without a stated reason is never sealed.
Declaring one without a reason is accepted (with a warning) but blocks compilation later:

```bash
bun harness.ts plan:add --run .capsules/partition-demo --actor planner --id task-integration \
  --label "Integration" --scope src/curriculum/index.ts --gate "bun test src/curriculum" \
  --deps task-topic-src-curriculum-topics-algebra-ts
```

```text
> **Unjustified dependency**: task-topic-src-curriculum-topics-algebra-ts has no --dep-reason yet; plan:compile will refuse to seal without one.
```

`plan:compile` refuses this buffer twice over, for two independent reasons — first the plan audit
introduced in the next step (a dependency between two disjoint write scopes has no scope-based
justification, invariant A4), and, even past that, the topology declaration itself:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"dependency edge(s) without a declared justification: task-integration -> task-topic-src-curriculum-topics-algebra-ts. Pass plan:add --dep-reason <dep-id>:\"<why this edge exists>\" for each one before compiling.","issues":[]}}
```

The fix for a real edge is `plan:add --deps <id> --dep-reason "<id>:<why this edge exists>"` at
declaration time — one line stating the read/write relationship, checked against the actual
`--deps` list so a reason can never be attached to an edge that was never declared.

---

## 🔍 Step 3C: Audit The Plan Before It Seals

`plan:audit` runs six structural invariants (A1 granularity, A3 gate-discrimination, A4 false-barrier,
A5 straggler, A6 whole-suite-gate — A2 is deliberately never evaluated, see below) against the current
buffer and records the verdict, whether or not you go on to compile:

```bash
bun harness.ts plan:audit --run .capsules/slugger --actor planner
```

```text
### Plan Audit: slugger (audit revision 1)
- **Findings**: 0 (0 blocking, 0 advisory)
- **Result**: no invariant violations found in the current planning buffer
- ℹ️ [NOT EVALUATED] `A2-parallelism`: A2-parallelism needs a grounded count of distinct entities the prompt names. Deriving that automatically would mean an NLP heuristic guessing a number nobody asked for, which this harness refuses to fabricate; and no explicit, coordinator-declared entity count is collected anywhere in this plan for it to compare against. Not evaluated.
- **Next Step**: `plan:compile` may seal this plan; no blocking invariant is outstanding.
```

`A2-parallelism` is reported `not_evaluated` on **every** run, always with that exact reason — there is
no plan for which it ever becomes a real finding, because nothing in the harness is allowed to guess
how many distinct entities a prompt names.

`plan:compile` runs this identical audit itself, immediately before it seals the plan, and refuses to
proceed on any **blocking** finding. The two independent slugify/truncate tasks trip none — see Step 4.

### 🧪 Aside: A Blocking Finding, and `--accept-audit`

Against a one-task illustrative repository whose gate is `bun run typecheck` (a real verification tool
invocation, but with no path operand — the whole-suite shape A6 exists to catch):

```text
### Plan Audit: audit-demo (audit revision 1)
- **Findings**: 1 (1 blocking, 0 advisory)
- 🛑 [BLOCKING] `A6-whole-suite-gate`: task task-widget's gate `bun run typecheck` runs the whole test suite; a task gate must prove its own scope. The run-wide suite belongs to --completion-gate, which runs once.
```

`plan:compile` refuses outright:

```text
{"ok":false,"error":{"code":"INTEGRITY","message":"plan:audit blocks compilation — A6-whole-suite-gate: task task-widget's gate `bun run typecheck` runs the whole test suite; a task gate must prove its own scope. The run-wide suite belongs to --completion-gate, which runs once.. Fix the plan, or pass --accept-audit <id>:<reason> naming exactly which invariant you are overriding and why.","issues":[]}}
```

Fixing the gate is the real answer, but a genuine one-task repository can also override, once, per
invariant, with a stated reason — never a blanket flag:

```bash
bun harness.ts plan:compile --run .capsules/audit-demo --actor planner --completion-gate "bun test tests" \
  --accept-audit "A6-whole-suite-gate:solo task in this demo repo; the whole suite IS the task's own scope"
```

```text
### Plan Compiled Successfully (Graph Revision 1)
- **Total Tasks**: 1 registered | **Recorded Waves**: 1 (topology revision 1, max_parallel 4)
...
- **Topology Declaration**: 1/1 tasks are independent roots; 0 dependency edge(s), all justified
- ✅ [AUDIT OVERRIDE]: A6-whole-suite-gate accepted — solo task in this demo repo; the whole suite IS the task's own scope
```

Naming an invariant the audit never raised is refused, so an override can never look broader than it is:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"--accept-audit names A1-granularity, which the audit did not raise as blocking; nothing to accept","issues":[]}}
```

---

## 🏗️ Step 4: Compile

```bash
bun harness.ts plan:status --run .capsules/slugger
bun harness.ts plan:compile --run .capsules/slugger --actor planner --completion-gate "bun test tests"
```

```text
### Planning Buffer: slugger (Draft)
| ID | Label | Write Scope | Gate | Dependencies |
| :--- | :--- | :--- | :--- | :--- |
| `task-slug` | Slugify helper | `src/slug.ts` | `bun test tests/slug.test.ts` | None |
| `task-truncate` | Truncate helper | `src/truncate` | `bun test tests/truncate.test.ts` | None |

**Status**: 2 tasks declared. Uncompiled. Run `plan:compile` to seal.
### Plan Compiled Successfully (Graph Revision 1)
- **Total Tasks**: 2 registered | **Recorded Waves**: 1 (topology revision 1, max_parallel 4)
- **Wave 1 (Ready Now)**: `task-slug`, `task-truncate` (2 parallel lanes)
- **Scope Isolation**: Disjoint write scopes verified (0 collisions)
- **Requirements Covered**: 2/2 atomic obligations mapped
- **Topology Declaration**: 2/2 tasks are independent roots; 0 dependency edge(s), all justified
- ℹ️ [AUDIT NOT EVALUATED]: A2-parallelism needs a grounded count of distinct entities the prompt names. Deriving that automatically would mean an NLP heuristic guessing a number nobody asked for, which this harness refuses to fabricate; and no explicit, coordinator-declared entity count is collected anywhere in this plan for it to compare against. Not evaluated.
- **Next Step**: Dispatch the whole ready wave via `bun harness.ts queue:wave --run slugger`
```

`--completion-gate` is mandatory and has no default. It is also checked for substance — a first
attempt with `--completion-gate "bun test"` was refused outright:

```text
{"ok":false,"error":{"code":"INTEGRITY","message":"compiled graph failed validation: gates[2].command must perform substantive verification"}}
```

Gate ids are derived from task ids: `task-slug` → `gate-slug`, plus the run-scope `gate-run-completion`.
The **Topology Declaration** line is C6's other half — every `--deps` edge in the buffer needs its
`--dep-reason`, or this line lists unjustified edges and `plan:compile` refuses (Step 3B). With zero
dependency edges here, both tasks are trivially independent roots and there is nothing to justify.

---

## 🧑‍⚖️ Step 4B: The Plan's Own Adversary

Before any implementer touches a task, an independent **plan-validator** can review the compiled plan
itself — not a task, the plan's own decomposition, dependency edges, gate discrimination and straggler
risk. Dispatching one is optional, but once dispatched its verdict is binding: a recorded
`changes_requested` against the live graph revision is a hard stop `task:claim` enforces directly.

```bash
bun harness.ts agent:register --run .capsules/slugger --agent coordinator-1 \
  --role coordinator --host claude-code

bun harness.ts agent:register --run .capsules/slugger --agent plan-val-1 \
  --role plan-validator --host claude-code --parent-agent coordinator-1

bun harness.ts plan:validate-start --run .capsules/slugger --validator plan-val-1
```

```text
### Plan Validation Opened: .capsules/slugger (Graph Revision 1)
- **Validator**: `plan-val-1`
- **Token**: `cduwJETjnrCWfALDDD-wsEj_2hSechG5Erz0luIl-tc` (bearer credential — never log or persist it)
- **Under Review**: 2 compiled tasks
- **Answer in writing**: does the decomposition match the prompt's entity count; is every dependency edge justified by a read/write relationship; can each gate fail if its task does nothing; will any task's scope leave one agent straggling.
- **Next Step**: `plan:review --status approved` or `--status changes_requested` with the four answers.
```

`$PV_TOKEN` is the `Token` line above, captured the same way `$SLUG_TOKEN` is captured in Step 7 (via
`--format json`, read out of `result.token`). Every verdict — pass or reject — must answer all four
questions in writing; a rubber-stamp approval that skips them is refused just as firmly as a defect
with no remediation would be elsewhere:

```bash
bun harness.ts plan:review --run .capsules/slugger --validator plan-val-1 --token "$PV_TOKEN" \
  --status approved \
  --decomposition-answer "2 tasks match the 2 independent helpers named in the prompt" \
  --dependency-answer "no dependency edges; both tasks are independent roots" \
  --gate-answer "each gate runs only that task's own scoped test file, which fails on an unimplemented src/" \
  --straggler-answer "both tasks carry one helper each; no effort estimate suggests a straggler" \
  --summary "Decomposition matches the two named helpers; both gates are scope-narrow and independent."
```

```text
### Plan Validation Approved: .capsules/slugger (Graph Revision 1)
- **Validator**: `plan-val-1`
- **Summary**: Decomposition matches the two named helpers; both gates are scope-narrow and independent.
- **Dispatch**: implementers and repairers may now claim tasks under this graph revision.
- **Next Step**: proceed to Phase 2 continuous dispatch.
```

### 🧪 Aside: `changes_requested` Hard-Stops Every Claim

Against the one-task illustrative repository from Step 3C — the coordinator overrode the audit's
whole-suite-gate finding without actually narrowing the gate, and the plan-validator catches exactly
that:

```bash
bun harness.ts plan:review --run .capsules/audit-demo --validator plan-val-1 --token "$PV_TOKEN_2" \
  --status changes_requested \
  --decomposition-answer "1 task for 1 named helper; matches" \
  --dependency-answer "n/a, no dependency edges" \
  --gate-answer "the gate runs the whole repo typecheck, which the coordinator overrode via --accept-audit rather than fixing" \
  --straggler-answer "n/a, single task" \
  --summary "Gate breadth override was accepted without narrowing the gate; still not falsifiable evidence this task's own work is what's proven." \
  --findings '[{"id":"PV-1","invariant":"A6-whole-suite-gate","severity":"important","observation":"task-widget gate bun run typecheck still runs the whole repository even after the audit override","remediation":"narrow the gate to a command scoped to src/widget.ts, or prove falsifiability with gate:prove before accepting the override"}]'
```

```text
### Plan Validation Rejected: .capsules/audit-demo (Graph Revision 1)
- **Validator**: `plan-val-1`
- **Summary**: Gate breadth override was accepted without narrowing the gate; still not falsifiable evidence this task's own work is what's proven.
- **Findings**: 1 — every implementer and repairer claim against graph revision 1 is refused until a fresh compile passes plan:review.
- **Next Step**: replan (plan:add / plan:compile) and dispatch a fresh plan-validator against the new revision.
```

Every subsequent `task:claim` — even for a brand-new agent that had nothing to do with the plan — is
refused with the same message, by name, until a fresh compile and a passing review supersede it:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"plan validation rejected this graph revision; replan and record a passing plan:review before any implementer or repairer can claim work","issues":[]}}
```

No plan-validator at all is a different, unpenalized case — most runs never dispatch one, and
`task:claim` only ever blocks on an actual recorded `changes_requested`, never on silence.

---

## 🌊 Step 5: See What's Claimable

```bash
bun harness.ts queue:wave --run .capsules/slugger
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

The brief also prints the claim command it just described, as its own trailing block:

```bash
bun harness.ts task:claim --run slugger --task <TASK_ID> --agent <AGENT_ID> --role implementer
```

`queue:wave` is read-only and reports every task claimable right now, so a coordinator dispatches
each one as an agent frees up instead of waiting for the list to be claimed as a unit. `queue:pop`
hands out one task at a time and is the right tool for filling a single freed slot.

---

## 🪪 Step 6: Register the Implementers

`coordinator-1` is already registered (Step 4B) — every agent from here on hangs off it.

```bash
bun harness.ts agent:register --run .capsules/slugger --agent impl-slug \
  --role implementer --host claude-code --parent-agent coordinator-1 --parent-task task-slug \
  --model claude-opus-4-6 --model-tier l --thinking-level high --tool Read --tool Write --tool Bash

bun harness.ts agent:register --run .capsules/slugger --agent impl-truncate \
  --role implementer --host claude-code --parent-agent coordinator-1 --parent-task task-truncate
```

```text
### Agent Granted: impl-slug (implementer)
- **Under**: `coordinator-1` / task `task-slug`
- **Host**: `claude-code` · **Provider**: unknown
- **Model**: `claude-opus-4-6` (agent_reported) · **Tier**: `l` (agent_reported)
- **Thinking**: `high` (agent_reported) · **Context Window**: unknown
- **Tools Granted**: `Read` (uncategorised), `Write` (uncategorised), `Bash` (uncategorised) (agent_reported)

#### Close The Grant:
```

```bash
bun harness.ts agent:release --run .capsules/slugger --agent impl-slug --reason "<why>"
```

```text
### Agent Granted: impl-truncate (implementer)
- **Under**: `coordinator-1` / task `task-truncate`
- **Host**: `claude-code` · **Provider**: unknown
- **Model**: unknown · **Tier**: unknown
- **Thinking**: unknown · **Context Window**: unknown
- **Tools Granted**: unknown

#### Close The Grant:
```

```bash
bun harness.ts agent:release --run .capsules/slugger --agent impl-truncate --reason "<why>"
```

Every brief that grants or leases something ends the same way: a trailing block naming the exact
command that undoes it — and `agent:release` always fills a literal `--reason "<why>"` placeholder,
because the flag itself is required (invariant B21: closing out an agent's participation is never
recorded silently).

Same machine, same second. The second agent reads `unknown` because nothing was reported for it, and
the harness will not infer a model from the machine it happens to be running on. `(agent_reported)` is
the whole class here, not `(host_reported)`: a plain CLI flag is an unverified claim relayed by
whoever called the harness, not a fact the host itself attested to (see
[Chapter 09 §03](../09-branching-and-honesty/03-evidence-classes-and-honesty.md)). A tool with no
`--tool-extra` category shows `(uncategorised)` rather than being guessed into a familiar one.

---

## 🔐 Step 7: Claim Both Lanes

```bash
bun harness.ts task:claim --run .capsules/slugger --task task-slug \
  --agent impl-slug --role implementer

bun harness.ts task:claim --run .capsules/slugger --task task-truncate \
  --agent impl-truncate --role implementer
```

```text
### Task Leased: task-slug
- **Agent**: `impl-slug`
- **Lease Token**: `gEEHKVc89xPULFtTw02McShgLTw8BoKfbo-WZyMjQII`
- **Duration**: 20 minutes
- **Assigned Write Scope**: `src/slug.ts`
- **Note**: Pass `--token gEEHKVc89xPULFtTw02McShgLTw8BoKfbo-WZyMjQII` to `task:submit`.
```

`--role` is mandatory. It is the capability contract the agent is bound to for the whole lease
(`orchestrating-long-tasks/roles/<role>.md`): `implementer` for fresh work, `repairer` for a task in
`changes_requested`. The token is printed once and only its SHA-256 digest is stored. This is also the
moment `task:claim` measures a content digest of the task's write scope, on disk, right now — the
baseline `task:submit` will compare against later (Step 8B).

Capture it, because every later mutation needs it:

```bash
SLUG_TOKEN=$(bun harness.ts task:claim --format json --run .capsules/slugger \
  --task task-slug --agent impl-slug --role implementer | bun -e '…read result.token…')
```

> `--format json` must appear **before** any `--`, or it is passed to the child process instead of
> being read by the harness.

---

## ✍️ Step 8: Implement, Prove, Submit

The first attempt satisfies the tests without implementing anything — the shape of hallucinated
progress this whole system exists to catch:

```ts
// src/slug.ts — attempt 1
export function slugify(input: string): string {
  if (input === "Hello World") return "hello-world";
  if (input === "Ship it, now!") return "ship-it-now";
  return input;
}
```

```bash
bun harness.ts run:exec --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor impl-slug -- bun test tests/slug.test.ts
```

```text
### Command Executed: `bun test tests/slug.test.ts`
- **Exit Code**: `0` (Success) | **Duration**: 0.88s
- **Output Summary**: Command completed successfully
- **Evidence Recorded**: `.capsules/slugger/commands/C-ea0371f7-62f5-4f32-9c68-dd70d888645d/record.json`
- **Raw Stream Log**: `<absolute-path-to-the-same-record.json>`
```

The gate is green. That alone proves nothing — it would stay green if `slugify` did nothing at all,
which is exactly what attempt 1 is.

---

## 🧨 Step 8B: Prove The Gate Can Actually Fail

`gate:prove` (C3) copies the repository into a throwaway scratch directory, reverts `task-slug`'s
write scope there back to `--base` (default `HEAD`), and runs the compiled gate against that reverted
copy. It never touches the real repository:

```bash
bun harness.ts gate:prove --run .capsules/slugger --task task-slug --actor coordinator-1
```

```text
### Gate Proof: `task-slug`
**PROVEN FALSIFIABLE**: exits 1 once `task-slug`'s write scope is reverted to `HEAD`.
- **Gate**: `bun test tests/slug.test.ts`
- **Write scope**: src/slug.ts
- **Reverted in scratch**: 0 restored, 1 removed, of 6 files copied
- **Duration**: 343ms
- **Prior proof**: none recorded for this exact gate.
```

`src/slug.ts` was never committed to git — only the two failing test files were, back in Step 0 — so
reverting to `HEAD` deletes it entirely from the scratch copy (1 removed) rather than restoring an
older version (0 restored). With the file gone, the test file's own import fails and the gate exits
non-zero: falsifiable. `gate:prove` always exits `0` itself, whether the verdict is falsifiable or
not — a **negative** verdict (the gate still passes with the work reverted) is real information for
`plan:audit`'s A3/A6 checks to act on, never a `gate:prove` failure. The proof is recorded as a
`gate-proved` event and read back by `latestGateProof`, keyed on the task's exact current gate argv
**and** its current write scope — a gate edited afterward, or a scope narrowed afterward, reads as
unproven again rather than trusting a verdict for a command or scope that no longer matches.

Now submit the hollow implementation:

```bash
bun harness.ts task:submit --run .capsules/slugger --task task-slug --agent impl-slug \
  --token "$SLUG_TOKEN" --summary "slugify returns the expected slug for both cases in tests/slug.test.ts."
```

```text
### Submission Accepted: task-slug
- **Agent**: `impl-slug` | Status: `submitted`
- **Write Scope Compliance**: Passed (1 files touched within `src/slug.ts`)
- **Diff Stats**: 1 files touched
- **Report**: `.capsules/slugger/reports/task-slug-submission.json`
- **Next Step**: Dispatch independent validator via `bun harness.ts task:validate-start --run <RUN_ID> --task task-slug --validator <VALIDATOR_ID>`
```

`--summary` is mandatory. The harness substitutes nothing for it, and `files_changed` came from a Git
observation of the worktree narrowed to the write scope, not from a default path. This submission also
passed C4's own check silently: `task:submit` compares a fresh content digest of the write scope
against the one `task:claim` recorded, and `src/slug.ts` genuinely differs (it didn't exist at claim
time) — see Step 12B for what happens when it **doesn't** differ. Every recorded command now lives at
`commands/C-<uuid>/record.json` rather than a flat `evidence/` file; `evidence/` still exists on disk
but only for readable names hardlinked onto `blobs/`, never command records (Chapter 01 §02).

---

## 🌿 Step 9: The Other Lane Branches

`impl-truncate` discovers that measuring the cut point and choosing the ellipsis are independent.

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
```

The parent is now `branched` and its lease clock is frozen. Each sub-scope is a _proper_ subset of
`src/truncate` and disjoint from its sibling; anything else is refused rather than trimmed. See
[Chapter 09 §01](../09-branching-and-honesty/01-execution-time-branching.md) for the four rules that
make this safe and the full "Dispatch And Collect" block the brief hands back.

```bash
bun harness.ts agent:register --run .capsules/slugger --agent sub-measure \
  --role sub-implementer --host claude-code --parent-agent impl-truncate --parent-task S-measure
bun harness.ts branch:claim --run .capsules/slugger --branch "$BRANCH" --sub-task S-measure --agent sub-measure --role sub-implementer
# … the same for S-ellipsis …

bun harness.ts branch:submit --run .capsules/slugger --branch "$BRANCH" --sub-task S-measure \
  --agent sub-measure --token "$MEASURE_TOKEN" \
  --summary "cutAt returns null when the input already fits, else the cut index."
```

```text
### Sub-task Submitted: S-ellipsis
- **Branch**: `B-1b72a087-53c9-49bd-855e-7d8a7aa4705c` on `task-truncate`
- **Still Open**: none - the branch is ready to collect

| Sub-task | Label | Status | Agent | Write Scope |
| :--- | :--- | :--- | :--- | :--- |
| `S-measure` | Cut-point measurement | submitted | `sub-measure` | `src/truncate/measure.ts` |
| `S-ellipsis` | Ellipsis character | submitted | `sub-ellipsis` | `src/truncate/ellipsis.ts` |
```

```bash
bun harness.ts branch:collect --run .capsules/slugger --branch "$BRANCH" \
  --agent impl-truncate --token "$TRUNC_TOKEN" --summary "Both halves landed; the parent now composes them."
```

```text
### Branch Collected: B-1b72a087-53c9-49bd-855e-7d8a7aa4705c
- **Parent**: `task-truncate` is now running with a fresh lease
- **Reason It Branched**: measuring the cut point and choosing the ellipsis are separable and were slowing each other down
- **Outcome**: Both halves landed; the parent now composes them.
- **Files Changed**: 2 files (harness_observed)
  - `src/truncate/ellipsis.ts`
  - `src/truncate/measure.ts`

| Sub-task | Label | Status | Agent | Write Scope |
| :--- | :--- | :--- | :--- | :--- |
| `S-measure` | Cut-point measurement | submitted | `sub-measure` | `src/truncate/measure.ts` |
| `S-ellipsis` | Ellipsis character | submitted | `sub-ellipsis` | `src/truncate/ellipsis.ts` |
```

Collect is the only place the filesystem is measured. The parent then writes `src/truncate/index.ts`,
runs `gate-truncate`, and submits normally.

---

## 🕵️ Step 10: Independent Validation, and a Real Rejection

```bash
bun harness.ts agent:register --run .capsules/slugger --agent val-slug \
  --role validator --host claude-code --parent-agent coordinator-1 --parent-task task-slug

bun harness.ts task:validate-start --run .capsules/slugger --task task-slug --validator val-slug
```

```text
### Validation Leased: task-slug
- **Validator**: `val-slug`
- **Validation Token**: `f21advaFmkYcqX2ork562eqXVwtaryu-VzYf9Y_7ras`
- **Mandatory Gates to Run**:
  1. `bun test tests/slug.test.ts`
- **Before Sign-off**: record 1 adversarial probe(s) with `task:probe`; a pass is refused without them.
```

The validator reruns the gate itself. It passes — and then the validator reads the diff:

```bash
bun harness.ts run:exec --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor val-slug -- bun test tests/slug.test.ts

bun harness.ts task:reject --run .capsules/slugger --task task-slug --validator val-slug \
  --token "$SLUG_VAL" \
  --reason "The gate is green only because both test inputs are hard-coded; slugify implements nothing." \
  --severity critical \
  --remediation "Lowercase the input, collapse every run of non-alphanumeric characters into one hyphen, and trim the edges." \
  --checks "$SLUG_GREEN"
```

```text
### Task Rejected: task-slug
- **Validator**: `val-slug` | Verdict: ❌ REJECTED
- **Finding ID**: `finding-task-slug-reject`
- **Issue**: `The gate is green only because both test inputs are hard-coded; slugify implements nothing.`
- **Action**: Task recorded as `changes_requested`.
```

Two constraints worth internalising:

- **`--severity` and `--remediation` are mandatory.** The harness grades nothing and words nothing on
  a validator's behalf.
- **`--checks` must be the validator's own _successful_ run of every mandatory task gate.** A failing
  gate cannot back a rejection — it is refused with
  `review check command C-… is not successful validator evidence`. That makes `task:reject` the tool
  for defects a green gate does not catch. A red gate is a repair situation, not a verdict.

---

## 🔧 Step 11: Repair Under the Repairer Contract

```bash
bun harness.ts task:claim --run .capsules/slugger --task task-slug --agent impl-slug --role repairer
```

```ts
// src/slug.ts — the actual implementation
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

```bash
bun harness.ts run:exec --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor impl-slug -- bun test tests/slug.test.ts
bun harness.ts task:submit --run .capsules/slugger --task task-slug --agent impl-slug \
  --token "$REPAIR_TOKEN" \
  --summary "Punctuation runs now collapse to a single hyphen and leading/trailing hyphens are trimmed."
```

---

## 🔎 Step 12: A Fresh Validator, a Probe, and the Pass

Reusing `val-slug` fails:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"validator must be independent from implementers"}}
```

A validator may not validate the same task twice. Release it and register a new one:

```bash
bun harness.ts agent:release --run .capsules/slugger --agent val-slug --reason "round 1 verdict recorded"
bun harness.ts agent:register --run .capsules/slugger --agent val-slug-2 \
  --role validator --host claude-code --parent-agent coordinator-1 --parent-task task-slug

bun harness.ts task:validate-start --run .capsules/slugger --task task-slug --validator val-slug-2

bun harness.ts task:probe --run .capsules/slugger --task task-slug --validator val-slug-2 \
  --token "$SLUG_VAL2" \
  --demand "Prove the slug is computed, not matched: the gate must stay green with the hard-coded branches gone." \
  --revalidation "bun test tests/slug.test.ts"
```

```text
### Adversarial Probe Recorded: task-slug
- **Validator**: `val-slug-2` | Verdict: 🔎 PROBE (Round 1)
- **Nature**: Demand for proof, not a defect. Repair round stays 1.
- **Demands**:
  - `probe-task-slug-01-1`: Prove the slug is computed, not matched: …
- **Next Step**: Answer every demand with command evidence, then `task:review --status pass`, or `task:reject` if a demand fails.
```

Now answer the demand with a command, and pass:

```bash
bun harness.ts run:exec --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor val-slug-2 -- bun test tests/slug.test.ts

bun harness.ts task:review --run .capsules/slugger --task task-slug --validator val-slug-2 \
  --token "$SLUG_VAL2" --status pass \
  --summary "The literal branches are gone and the gate still passes, so the slug is computed." \
  --checks "$SLUG_PROOF" \
  --resolve "probe-task-slug-01-1=$SLUG_PROOF" \
  --resolve "finding-task-slug-reject=$SLUG_PROOF"
```

```text
### Task Validated & Satisfied: task-slug
- **Validator**: `val-slug-2` | Verdict: ✅ PASS
- **Adversarial Probes**: 1 answered before sign-off
- **Gate Results**: gate-slug: C-6d28e63a-7e14-4902-b2cb-a161c02c03c1 exited 0
- **Downstream Impact**: None
- **Review Report**: `.capsules/slugger/reports/task-slug-review.json`
```

**`task:review --status pass` never stands on its own.** Every open finding — probe demand _and_
defect — must be answered explicitly. Omitting one is refused by name:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"cannot pass task-slug: 1 open finding(s) unanswered: finding-task-slug-reject; answer each with --resolve <finding-id>=<command-id>"}}
```

`task-truncate` follows the same shape with one probe and no rejection.

---

## 🧪 Step 12B (Aside): A Submission That Genuinely Changed Nothing

Not every task needs the two rounds `task-slug` went through. C4 covers the opposite honest outcome —
an implementer claims a task, investigates, and finds the write scope already does what was asked. A
submission is only accepted for that outcome with an explicit, attributed `--no-op` declaration; the
task record's own content digest is what makes the claim checkable at all. This step runs against a
**separate one-task illustrative capsule** (`noop-demo`) whose single file already satisfies its test
before the implementer ever claims it — slugger's own two tasks never take this path.

```bash
bun harness.ts task:submit --run .capsules/noop-demo --task task-check --agent impl-check \
  --token "$NOOP_TOKEN" --summary "Confirmed src/existing.ts already satisfies the test; nothing to change." \
  --files-changed src/existing.ts
```

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"task task-check write scope (src/existing.ts) is byte-identical to its content at claim; nothing was written. Submit --no-op --reason \"<why>\" if this task legitimately needed no change, or make the change its write scope requires.","issues":[]}}
```

`--no-op --reason` is the only way past it:

```bash
bun harness.ts task:submit --run .capsules/noop-demo --task task-check --agent impl-check \
  --token "$NOOP_TOKEN" --summary "Confirmed src/existing.ts already satisfies tests/existing.test.ts." \
  --no-op --reason "the existing implementation already satisfies tests/existing.test.ts" --evidence C-483eeed5-f73a-4b46-9822-8915f9ddb817
```

```text
### Submission Accepted: task-check
- **Agent**: `impl-check` | Status: `submitted`
- **Write Scope Compliance**: Passed (0 files touched within `src/existing.ts`)
- **Diff Stats**: 0 files touched
- **Report**: `.capsules/noop-demo/reports/task-check-submission.json`
- **Next Step**: Dispatch independent validator via `bun harness.ts task:validate-start --run <RUN_ID> --task task-check --validator <VALIDATOR_ID>`
```

`--reason` without `--no-op`, or `--no-op` without `--reason`, are both refused as a caller mistake
before the digest is ever compared — the pairing is enforced first, honesty second.

---

## 📊 Step 13: Run Status and the Run Gate

```bash
bun harness.ts run:status --run .capsules/slugger
bun harness.ts run:exec --run .capsules/slugger --gate gate-run-completion \
  --actor coordinator-1 -- bun test tests
```

```text
### Run Status: slugger (Phase: Executing)
| Task ID | Label | Write Scope | Status | Agent / Lock |
| :--- | :--- | :--- | :--- | :--- |
| `task-slug` | Slugify helper | `src/slug.ts` | ✅ Satisfied | Validating (val-slug-2) |
| `task-truncate` | Truncate helper | `src/truncate` | ✅ Satisfied | Validating (val-truncate) |

**Progress**: 2/2 Satisfied, 0 Validating, 0 Leased, 0 Blocked.
**Occupancy**: 0/4 occupancy slots in use (gate ceiling 5).
**Capsule**: 6 commands, 0 captures over 0 blobs (0 B), 0 open findings — index current
```

`run:status` reports live occupancy against `default_max_parallel` and a one-line capsule catalogue
summary alongside task progress. It reports against **two independent** ceilings, not one: the
reasoning concurrency ceiling (`default_max_parallel`, here 4) and a separate **gate ceiling** (here 5,
this machine's own core count halved) — occupancy is only ever measured against the first, since the
harness cannot tell a gate-running lease from a reasoning one, but both numbers are surfaced so idle
capacity against either one is visible rather than silently assumed. The two are unrelated axes, not
one nested inside the other — on a repo whose `default_max_parallel` is set low for a small demo like
this one, the machine's own gate ceiling can easily come out higher, exactly as it does here.

---

## 🧑‍⚖️ Step 14: The Completeness Critic

```bash
bun harness.ts agent:register --run .capsules/slugger --agent critic-1 \
  --role completeness-critic --host claude-code --parent-agent coordinator-1

CRITIC_TOKEN=$(bun harness.ts critic:start --format json --run .capsules/slugger \
  --critic critic-1 | bun -e '…read result.token…')
```

`critic:start` hands back a bearer token the same way `task:claim` does — capture it with
`--format json`, the same way `$SLUG_TOKEN` was captured in Step 7. It is used twice: once on
`critic:review` below, and again as `run:complete --auth-token` in Step 15, because the completion
certificate `critic:review --decision approve` issues is bound to that same token.

The critic must then run its **own** commands. Both its independent checks and its requirement proofs
must be commands whose actor is the critic and which are **not bound to a task**:

```bash
bun harness.ts run:exec --run .capsules/slugger --actor critic-1 -- bun test tests/slug.test.ts
bun harness.ts run:exec --run .capsules/slugger --actor critic-1 -- bun test tests/truncate.test.ts
bun harness.ts run:exec --run .capsules/slugger --gate gate-run-completion --actor critic-1 -- bun test tests
```

Skipping this step fails with `critic checks must be nonempty`; citing a validator's command instead
fails with `critic independent check is invalid`.

Write the proofs payload **outside the repository**. `critic:start` binds its authorization to the
repository bytes it inspected, so a scratch file added to the worktree afterwards invalidates it with
`repository bytes changed after critic authorization`.

```jsonc
// "${TMPDIR:-/tmp}/proofs.json" — one entry per requirement, or completion is blocked
[
  {
    "requirement_id": "req-slug",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "C-c0e742e7-22d2-4a51-84f3-617f1886a5da",
        "observation": "the critic ran bun test tests/slug.test.ts itself and it exited 0",
      },
    ],
  },
  {
    "requirement_id": "req-truncate",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "C-4608d219-b075-4357-b225-23adcbbcc755",
        "observation": "the critic ran bun test tests/truncate.test.ts itself over the collected branch output and it exited 0",
      },
    ],
  },
]
```

```bash
bun harness.ts critic:review --run .capsules/slugger --critic critic-1 --token "$CRITIC_TOKEN" \
  --decision approve --proofs-file "${TMPDIR:-/tmp}/proofs.json" \
  --summary "Both prompt lines are implemented and each is bound to a gate run the harness recorded."
```

```text
### Completeness Critic Sign-Off: APPROVED
- **Critic**: `critic-1`
- **Summary**: Both prompt lines are implemented and each is bound to a gate run the harness recorded.
- **Authorization**: Valid completion certificate issued
- **Next Step**: Seal run via `bun harness.ts run:complete --run .capsules/slugger --auth-token …`
```

A requirement with no proof is recorded `unproven` and blocks completion. The critic cannot mint one.

---

## 🔚 Step 15: Close the Grants, Then Seal

Order matters. A completed run is terminal, so release every grant **first**:

```bash
for a in impl-slug impl-truncate sub-measure sub-ellipsis val-slug-2 val-truncate plan-val-1 critic-1 coordinator-1; do
  bun harness.ts agent:release --run .capsules/slugger --agent "$a" --reason "run sealed"
done

bun harness.ts run:complete --run .capsules/slugger --actor coordinator-1 \
  --auth-token "$CRITIC_TOKEN"
```

`--auth-token` is mandatory and is checked against the critic assignment's own token digest, not the
critic's live grant — releasing `critic-1` first does not invalidate it. Omitting the flag is refused
outright: `{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"--auth-token is required"}}`.

```text
### 🎉 Run Completed Successfully: slugger
- **Capsule**: `.capsules/slugger`
- **Summary**: 2 tasks executed, 2 independent validations passed, 1 critic sign-off
- **Total Gates Verified**: 3/3 gates green
- **Run Duration**: unknown
- **Capsule Status**: Sealed & Auditable
```

Releasing afterwards is refused:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"completed runs are terminal and cannot be mutated"}}
```

---

## 🧬 Step 16: Read the Result

```bash
bun harness.ts agent:list --run .capsules/slugger --task task-truncate
bun harness.ts summary:export --run .capsules/slugger
bun harness.ts doctor --run .capsules/slugger
```

```text
### Task Lineage: task-truncate

| Depth | Agent | Role | Under | Status |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `impl-truncate` | implementer | `coordinator-1` | released |
| 0 | `val-truncate` | validator | `coordinator-1` | released |
| 1 | `sub-measure` | sub-implementer | `impl-truncate` ← `coordinator-1` | released |
| 1 | `sub-ellipsis` | sub-implementer | `impl-truncate` ← `coordinator-1` | released |
```

```text
### Summary Suite Exported: `slugger`
- **Capsule Summary Root**: `.capsules/slugger/summary`
- **Artifacts Generated**:
  - `graph.json` (GVUI GraphDataset, 15 nodes, 23 edges)
  - `timeline.json` (102 chronological events)
  - `metrics.json` (2/2 satisfied tasks)
  - `summary.md` (complete run report)
```

```text
### Capsule Doctor: `.capsules/slugger`
- **Healthy**: yes
- **Bun**: 1.3.14 (supported)
- **Gitignored**: yes
- **Issues**: none
```

`graph.json` now carries a plan-validator node (`node-plan-validator-r1`) ahead of every task node —
its own round, its own four written answers, its own `approved` verdict — plus a `gate-proved` event in
the run's own timeline. Neither of those existed in this export before today.

---

## 📋 The Whole Run in One Table

| #   | Command                                                 | What it changed                                                          |
| :-- | :------------------------------------------------------ | :----------------------------------------------------------------------- |
| 1   | `plan:init`                                             | Capsule created, prompt bytes frozen at `0444`.                          |
| 2   | `plan:enhance`                                          | `planning/enhanced-plan.md`, digest in `state.planning`.                 |
| 3   | `plan:add` ×2 (`--auto-partition`/`--dep-reason` aside) | Planning buffer, tasks bound to prompt lines.                            |
| 3C  | `plan:audit`                                            | Structural audit verdict recorded, whether or not it blocks.             |
| 4   | `plan:compile`                                          | Requirements, DAG, revision 1, `state.topology`, topology declaration.   |
| 4B  | `plan:validate-start` / `plan:review`                   | Plan-validator assignment and verdict on the graph revision.             |
| 5   | `queue:wave`                                            | Read-only; the whole conflict-free wave.                                 |
| 6   | `agent:register` ×N                                     | `state.agents` grants and lineage.                                       |
| 7   | `task:claim --role`                                     | Lease + one-time bearer token + write-scope content digest at claim.     |
| 8   | `run:exec`                                              | Command record, log bytes, `trusted_host_observed_v1` evidence.          |
| 8B  | `gate:prove`                                            | Falsifiability verdict on a reverted scratch copy, `gate_proofs` event.  |
| 9   | `task:submit --summary`                                 | Submission report; scope compliance and write-scope digest checked.      |
| 10  | `branch:open` / `claim` / `submit` / `collect`          | `state.branches`; parent frozen, then resumed with a measured file list. |
| 11  | `task:validate-start`                                   | Validation token; independence enforced.                                 |
| 12  | `task:reject`                                           | Defect finding; `changes_requested`; repair round +1.                    |
| 13  | `task:claim --role repairer`                            | Repair lease.                                                            |
| 14  | `task:probe`                                            | Probe demand; probe round +1, repair round untouched.                    |
| 15  | `task:review --status pass --resolve …`                 | Verdict; every open finding answered.                                    |
| 12B | `task:submit --no-op --reason` (aside)                  | Accepted no-op, distinct from an unexplained non-change refusal.         |
| 16  | `critic:start` / `critic:review`                        | Completion certificate with requirement proofs.                          |
| 17  | `agent:release` ×N                                      | Grants closed.                                                           |
| 18  | `run:complete`                                          | Capsule sealed.                                                          |
| 19  | `summary:export` / `doctor`                             | Graph, timeline, metrics, integrity report.                              |

---

[⬅ Previous: Evidence Classes & Honesty](../09-branching-and-honesty/03-evidence-classes-and-honesty.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)
