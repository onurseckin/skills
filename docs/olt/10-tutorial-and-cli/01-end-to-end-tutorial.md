# 01. Complete End-to-End Tutorial

[⬅ Previous: Evidence Classes & Honesty](../09-branching-and-honesty/03-evidence-classes-and-honesty.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)

---

## 🎯 Tutorial Overview & Learning Objectives

This tutorial provides a complete, hands-on, reproducible walkthrough of the entire `olt` lifecycle on a real repository you can build in two minutes.

By completing this tutorial, you will master:

1. **Prompt Capture & Cryptographic Sealing**: Initializing a capsule and freezing prompt bytes.
2. **Repository Enhancement & Task Decomposition**: Mapping atomic obligations to isolated write scopes.
3. **Plan Auditing & Adversarial Plan Validation**: Enforcing structural invariants and deploying a plan-validator.
4. **Topological Wave Scheduling**: Inspecting ready lanes with `queue:wave` and visualizing DAGs with `dag:render`.
5. **Parallel Agent Execution & Bearer Security**: Leasing tasks under strict role contracts with one-time tokens.
6. **Dynamic Execution Branching**: Subdividing work at runtime using `branch:open` and `branch:collect`.
7. **Gate Falsifiability & Adversarial Probing**: Proving gates can fail via `gate:prove` and issuing `task:probe` demands.
8. **Bounded Repair Cycles**: Handling validator rejections under `--role repairer`.
9. **Completeness Critic Certification**: Proving 100% prompt satisfaction with independent receipts.
10. **Mechanical Completion & Integrity Export**: Sealing the capsule and generating audit summaries.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE 3-PHASE TUTORIAL WORKFLOW                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ PHASE 1: PLANNING, AUDIT & VALIDATION ]                                  │
│    Step 0: Initialize Demo Repository                                       │
│    Step 1: Capture & Hash-Seal Prompt (plan:init)                           │
│    Step 2: Inspect Repository & Enhance Plan (plan:enhance)                 │
│    Step 3: Declare Granular Tasks & Scopes (plan:add)                       │
│    Step 4: Audit & Compile Graph (plan:audit, plan:compile)                 │
│    Step 5: Independent Adversarial Plan Review (plan:validate-start/review) │
│                                  │                                          │
│                                  ▼                                          │
│  [ PHASE 2: CONTINUOUS PARALLEL EXECUTION & REPAIR ]                        │
│    Step 6: Inspect Conflict-Free Waves (queue:wave, dag:render)             │
│    Step 7: Register Multi-Agent Workforce (agent:register)                  │
│    Step 8: Lease Parallel Lanes with Bearer Tokens (task:claim)             │
│    Step 9: Parallel Execution, gate:prove, & Execution Branching            │
│    Step 10: Adversarial Validation, task:probe, & Defect Rejection          │
│    Step 11: Bounded Repair Execution under Repairer Contract                │
│    Step 12: Fresh Validator Re-Validation & Final Sign-Off                 │
│                                  │                                          │
│                                  ▼                                          │
│  [ PHASE 3: CRITIC CERTIFICATION & TERMINAL SEAL ]                          │
│    Step 13: Run-Wide Completion Gate Execution (run:exec)                   │
│    Step 14: Independent Completeness Critic Certification (critic:review)   │
│    Step 15: Teardown Grants & Mechanical Seal (agent:release, run:complete) │
│    Step 16: Living Dynamic DAG Trace & Summary Export (dag:trace, doctor)   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 Step 0: Build the Demo Repository

Create an isolated directory structure with two failing tests and a raw user prompt:

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

git add -A && git commit -qm "chore: initial failing test fixtures and prompt"
```

> **Invariant Check**: `.capsules/` **must** be listed in `.gitignore` before `plan:init` touches the repository. The harness strictly refuses to create a capsule that git would track.

---

## 📥 Step 1: Capture & Hash-Seal the Prompt

Capture the raw prompt into an immutable capsule container:

```bash
bun harness.ts plan:init --repo . --run slugger --prompt-file prompt.txt --capture-mode file
```

```text
### Capsule Initialized: slugger
- **Capsule Root**: `.capsules/slugger`
- **Prompt SHA-256**: `ba20966731e18c4133cd16a43dd9d2f205c7d57844d58ce2e332cc5e2a91401d` (200 bytes)
- **Assurance**: `source-verified` | Runtime: Bun 1.3.14
- **Runtime Pin**: `a18f4...` (recorded in runtime/manifest.json)
- **Status**: Ready for task declarations (`plan:add`).
```

The prompt is written to `prompt.md` with read-only file permissions (`0444`) and permanently bound in `manifest.json`.

---

## 🔎 Step 2: Inspect Repository & Enhance Plan

Record what reading the repository taught you. The planner agent inspects the code host-side and records observations, to-dos, and risks:

```bash
bun harness.ts plan:enhance --run .capsules/slugger --actor planner \
  --summary "Two independent string utilities; test files already exist and fail." \
  --observation "tests/slug.test.ts and tests/truncate.test.ts import from src/, which is empty." \
  --observation "tests/truncate.test.ts imports src/truncate/index.ts, requiring a directory." \
  --todo "Implement src/slug.ts against tests/slug.test.ts" \
  --todo "Implement src/truncate/ against tests/truncate.test.ts" \
  --risk "A shared string util would place both tasks in one write scope and serialize them." \
  --open-question "Should ellipsis be U+2026 or three dots? The test requires U+2026." \
  --source tests/slug.test.ts --source tests/truncate.test.ts
```

```text
### Enhanced Plan Recorded: slugger (Revision 1)
- **Document**: `planning/enhanced-plan.md`
- **Observations**: 2 recorded | **To-dos**: 2 recorded | **Risks**: 1 identified
- **Evidence Class**: `agent_reported`
- **Authority**: `prompt.md` remains the binding authority; enhanced plan is derived.
```

---

## 🧩 Step 3: Declare Granular Tasks Bound to Prompt Lines

Declare granular tasks bound explicitly to prompt line numbers:

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
- **Prompt Binding**: Prompt line 1
- **Plan Size**: 2 tasks registered.
```

---

## 🔍 Step 4: Audit & Compile the Plan

Audit structural invariants with `plan:audit` and compile the execution DAG:

```bash
bun harness.ts plan:audit --run .capsules/slugger --actor planner
bun harness.ts plan:compile --run .capsules/slugger --actor planner --completion-gate "bun test tests"
```

```text
### Plan Audit: slugger (Audit Revision 1)
- **Findings**: 0 (0 blocking, 0 advisory)
- **Result**: PASSED ✅ (No structural invariant violations found)

### Plan Compiled Successfully (Graph Revision 1)
- **Total Tasks**: 2 registered | **Recorded Waves**: 1 (Topology Revision 1, max_parallel 4)
- **Wave 1 (Ready Now)**: `task-slug`, `task-truncate` (2 parallel lanes)
- **Scope Isolation**: Disjoint write scopes verified (0 collisions)
- **Requirements Covered**: 2/2 atomic obligations mapped
- **Work/Span Concurrency**: Total Work W=2, Span S=1, Parallelism P=2.00x
```

---

## 🧑‍⚖️ Step 5: Independent Adversarial Plan Review

Register an independent `plan-validator` to evaluate prompt decomposition and gate precision before any implementer claims work:

```bash
bun harness.ts agent:register --run .capsules/slugger --agent coordinator-1 \
  --role coordinator --host claude-code

bun harness.ts agent:register --run .capsules/slugger --agent plan-val-1 \
  --role plan-validator --host claude-code --parent-agent coordinator-1

PV_TOKEN=$(bun harness.ts plan:validate-start --format json --run .capsules/slugger \
  --validator plan-val-1 | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')

bun harness.ts plan:review --run .capsules/slugger --validator plan-val-1 --token "$PV_TOKEN" \
  --status approved \
  --decomposition-answer "2 tasks match the 2 independent helpers specified in prompt" \
  --dependency-answer "No dependencies; both tasks are disjoint parallel roots" \
  --gate-answer "Each gate tests only its task's write scope" \
  --straggler-answer "Both tasks carry identical single-file effort estimates" \
  --dependency-edges-reviewed "" --gate-ids-reviewed "gate-slug,gate-truncate" \
  --summary "Decomposition is sound, gates are scope-narrow, and lanes are parallel."
```

```text
### Plan Validation Approved: slugger (Graph Revision 1)
- **Validator**: `plan-val-1`
- **Summary**: Decomposition matches prompt; gates are scope-narrow and independent.
- **Dispatch**: Implementers and repairers may now claim tasks under Revision 1.
```

---

## 🌊 Step 6: Inspect Ready Waves & Render Sugiyama Layout

Inspect claimable tasks and render the visual DAG:

```bash
bun harness.ts queue:wave --run .capsules/slugger
bun harness.ts dag:render --run .capsules/slugger --box-style rounded
```

```text
### Claimable Now: 2/4 conflict-free tasks
| Task | Label | Priority | Write Scope | Planned Wave |
| :--- | :--- | :--- | :--- | :--- |
| `task-slug` | Slugify helper | 50 | `src/slug.ts` | 1 |
| `task-truncate` | Truncate helper | 50 | `src/truncate` | 1 |

### Sugiyama Hierarchical DAG: slugger (Revision 1)
Layer 0 (Wave 1):
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ task-slug                    │       │ task-truncate                │
│ (○ READY)                    │       │ (○ READY)                    │
│ Scope: src/slug.ts           │       │ Scope: src/truncate          │
│ Gate: bun test tests/slug    │       │ Gate: bun test tests/trunc   │
└──────────────────────────────┘       └──────────────────────────────┘
```

---

## 🪪 Step 7: Register the Implementer Workforce

Register implementer agents under the coordinator:

```bash
bun harness.ts agent:register --run .capsules/slugger --agent impl-slug \
  --role implementer --host claude-code --parent-agent coordinator-1 --parent-task task-slug \
  --model claude-opus-4-6 --model-tier l --thinking-level high --tool Read --tool Write --tool Bash

bun harness.ts agent:register --run .capsules/slugger --agent impl-truncate \
  --role implementer --host claude-code --parent-agent coordinator-1 --parent-task task-truncate \
  --model claude-opus-4-6 --model-tier l --thinking-level high --tool Read --tool Write --tool Bash
```

```text
### Agent Granted: impl-slug (implementer)
- **Under**: `coordinator-1` / task `task-slug`
- **Host**: `claude-code` | **Model**: `claude-opus-4-6` | **Thinking**: `high`
```

---

## 🔐 Step 8: Claim Parallel Task Leases

Lease both parallel tasks simultaneously:

```bash
SLUG_TOKEN=$(bun harness.ts task:claim --format json --run .capsules/slugger \
  --task task-slug --agent impl-slug --role implementer | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')

TRUNC_TOKEN=$(bun harness.ts task:claim --format json --run .capsules/slugger \
  --task task-truncate --agent impl-truncate --role implementer | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')
```

```text
### Task Leased: task-slug
- **Agent**: `impl-slug`
- **Duration**: 20 minutes | **Assigned Scope**: `src/slug.ts`
- **Content Baseline Digest**: Recorded at claim time
```

---

## ✍️ Step 9: Parallel Execution, `gate:prove`, & Branching

### Lane 1: Naive Implementation, `gate:prove`, & Submission

The agent writes a naive, hard-coded implementation in `src/slug.ts`:

```ts
// src/slug.ts — naive attempt 1
export function slugify(input: string): string {
  if (input === "Hello World") return "hello-world";
  if (input === "Ship it, now!") return "ship-it-now";
  return input;
}
```

Execute the gate command and prove falsifiability with `gate:prove`:

```bash
bun harness.ts run:exec --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor impl-slug -- bun test tests/slug.test.ts

bun harness.ts gate:prove --run .capsules/slugger --task task-slug --actor coordinator-1

bun harness.ts task:submit --run .capsules/slugger --task task-slug --agent impl-slug \
  --token "$SLUG_TOKEN" --summary "Implemented basic slugify helper."
```

```text
### Gate Proof: `task-slug`
**PROVEN FALSIFIABLE**: exits 1 once `task-slug`'s write scope is reverted to `HEAD`.
- **Duration**: 284ms | Recorded as `gate-proved` event

### Submission Accepted: task-slug
- **Agent**: `impl-slug` | Status: `submitted`
- **Write Scope Compliance**: Passed (1 file touched within `src/slug.ts`)
```

### Lane 2: Dynamic Execution Branching

In `task-truncate`, `impl-truncate` subdivides work into two parallel sub-tasks:

```bash
BRANCH_ID=$(bun harness.ts branch:open --format json --run .capsules/slugger \
  --parent-task task-truncate --agent impl-truncate --token "$TRUNC_TOKEN" \
  --reason "Separating cut-point calculation and ellipsis character formatting" \
  --sub-task S-measure --sub-label S-measure="Cut measurement" --sub-scope S-measure=src/truncate/measure.ts \
  --sub-task S-ellipsis --sub-label S-ellipsis="Ellipsis handler" --sub-scope S-ellipsis=src/truncate/ellipsis.ts \
  | bun -e 'console.log(JSON.parse(process.argv[1]).result.branch_id)')

bun harness.ts agent:register --run .capsules/slugger --agent sub-measure \
  --role sub-implementer --host claude-code --parent-agent impl-truncate --parent-task S-measure

MEASURE_TOKEN=$(bun harness.ts branch:claim --format json --run .capsules/slugger \
  --branch "$BRANCH_ID" --sub-task S-measure --agent sub-measure --role sub-implementer \
  | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')
```

The subagents implement their files:

- `src/truncate/measure.ts`: Exports `calculateCutPoint(str, max)`.
- `src/truncate/ellipsis.ts`: Exports `ELLIPSIS = "…"`.

Submit sub-tasks and collect the branch:

```bash
bun harness.ts branch:submit --run .capsules/slugger --branch "$BRANCH_ID" --sub-task S-measure \
  --agent sub-measure --token "$MEASURE_TOKEN" --summary "Calculates truncate index."

# (Repeat for S-ellipsis)

bun harness.ts branch:collect --run .capsules/slugger --branch "$BRANCH_ID" \
  --agent impl-truncate --token "$TRUNC_TOKEN" --summary "Collected both sub-modules; composing index.ts"
```

The parent agent writes `src/truncate/index.ts`, runs `gate-truncate`, and submits:

```ts
// src/truncate/index.ts
import { calculateCutPoint } from "./measure.ts";
import { ELLIPSIS } from "./ellipsis.ts";

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + ELLIPSIS;
}
```

```bash
bun harness.ts run:exec --run .capsules/slugger --task task-truncate --gate gate-truncate \
  --actor impl-truncate -- bun test tests/truncate.test.ts

bun harness.ts task:submit --run .capsules/slugger --task task-truncate --agent impl-truncate \
  --token "$TRUNC_TOKEN" --summary "Composed truncate helper from branch sub-modules."
```

---

## 🕵️ Step 10: Adversarial Validation & Task Rejection

Register an independent validator for `task-slug`. The validator runs the gate, inspects the diff, and catches the naive hardcoded implementation:

```bash
bun harness.ts agent:register --run .capsules/slugger --agent val-slug \
  --role validator --host claude-code --parent-agent coordinator-1 --parent-task task-slug

VAL_TOKEN=$(bun harness.ts task:validate-start --format json --run .capsules/slugger \
  --task task-slug --validator val-slug | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')

CHECK_CMD=$(bun harness.ts run:exec --format json --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor val-slug -- bun test tests/slug.test.ts | bun -e 'console.log(JSON.parse(process.argv[1]).result.command_id)')

bun harness.ts task:reject --run .capsules/slugger --task task-slug --validator val-slug \
  --token "$VAL_TOKEN" \
  --reason "The gate passes only because test inputs are hard-coded; general slugification is not implemented." \
  --severity critical \
  --remediation "Implement general regex-based lowercasing, punctuation collapsing, and whitespace trimming." \
  --checks "$CHECK_CMD"
```

```text
### Task Rejected: task-slug
- **Validator**: `val-slug` | Verdict: ❌ REJECTED
- **Finding ID**: `finding-task-slug-reject`
- **Issue**: `The gate passes only because test inputs are hard-coded; general slugification is not implemented.`
- **Status**: Task transitioned to `changes_requested` (Repair Round 1/6).
```

---

## 🔧 Step 11: Bounded Repair Under Repairer Contract

Claim `task-slug` under the `--role repairer` capability contract:

```bash
REPAIR_TOKEN=$(bun harness.ts task:claim --format json --run .capsules/slugger \
  --task task-slug --agent impl-slug --role repairer | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')
```

Implement the genuine algorithm in `src/slug.ts`:

```ts
// src/slug.ts — robust implementation
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

Verify and resubmit:

```bash
bun harness.ts run:exec --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor impl-slug -- bun test tests/slug.test.ts

bun harness.ts task:submit --run .capsules/slugger --task task-slug --agent impl-slug \
  --token "$REPAIR_TOKEN" \
  --summary "Replaced hardcoded checks with general regex-based punctuation collapsing and trimming."
```

---

## 🔎 Step 12: Fresh Validator Re-Validation, Probe, & Sign-Off

The independence invariant requires a **fresh validator** identity for round 2:

```bash
bun harness.ts agent:release --run .capsules/slugger --agent val-slug --reason "Round 1 verdict recorded"

bun harness.ts agent:register --run .capsules/slugger --agent val-slug-2 \
  --role validator --host claude-code --parent-agent coordinator-1 --parent-task task-slug

VAL2_TOKEN=$(bun harness.ts task:validate-start --format json --run .capsules/slugger \
  --task task-slug --validator val-slug-2 | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')
```

Issue a mandatory adversarial probe demand with `task:probe`:

```bash
bun harness.ts task:probe --run .capsules/slugger --task task-slug --validator val-slug-2 \
  --token "$VAL2_TOKEN" \
  --demand "Verify that general string inputs produce valid slugs without hardcoded branching." \
  --revalidation "bun test tests/slug.test.ts"
```

Execute verification and record final passing review with resolved findings:

```bash
PROOF_CMD=$(bun harness.ts run:exec --format json --run .capsules/slugger --task task-slug --gate gate-slug \
  --actor val-slug-2 -- bun test tests/slug.test.ts | bun -e 'console.log(JSON.parse(process.argv[1]).result.command_id)')

bun harness.ts task:review --run .capsules/slugger --task task-slug --validator val-slug-2 \
  --token "$VAL2_TOKEN" --status pass \
  --summary "General slugification verified; all test cases pass cleanly." \
  --checks "$PROOF_CMD" \
  --resolve "finding-task-slug-reject=$PROOF_CMD" \
  --resolve "probe-task-slug-01-1=$PROOF_CMD"
```

```text
### Task Validated & Satisfied: task-slug
- **Validator**: `val-slug-2` | Verdict: ✅ PASS
- **Adversarial Probes**: 1 answered and resolved
- **Findings Resolved**: `finding-task-slug-reject` closed with command receipt `$PROOF_CMD`
```

---

## 🧑‍⚖️ Step 13 & 14: Run Gate Execution & Completeness Critic

Execute the run-wide completion gate and register the Completeness Critic:

```bash
bun harness.ts run:exec --run .capsules/slugger --gate gate-run-completion \
  --actor coordinator-1 -- bun test tests

bun harness.ts agent:register --run .capsules/slugger --agent critic-1 \
  --role completeness-critic --host claude-code --parent-agent coordinator-1

CRITIC_TOKEN=$(bun harness.ts critic:start --format json --run .capsules/slugger \
  --critic critic-1 | bun -e 'console.log(JSON.parse(process.argv[1]).result.token)')
```

The critic runs its **own independent verification commands**:

```bash
CRITIC_CMD1=$(bun harness.ts run:exec --format json --run .capsules/slugger --actor critic-1 -- bun test tests/slug.test.ts | bun -e 'console.log(JSON.parse(process.argv[1]).result.command_id)')
CRITIC_CMD2=$(bun harness.ts run:exec --format json --run .capsules/slugger --actor critic-1 -- bun test tests/truncate.test.ts | bun -e 'console.log(JSON.parse(process.argv[1]).result.command_id)')
```

Write the proofs JSON file in `/tmp` (keeping the repository worktree clean):

```json
[
  {
    "requirement_id": "req-1",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "CRITIC_CMD1",
        "observation": "Critic verified slugify tests pass cleanly."
      }
    ]
  },
  {
    "requirement_id": "req-2",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "CRITIC_CMD2",
        "observation": "Critic verified truncate tests pass cleanly."
      }
    ]
  }
]
```

Submit critic sign-off:

```bash
bun harness.ts critic:review --run .capsules/slugger --critic critic-1 --token "$CRITIC_TOKEN" \
  --decision approve --proofs-file /tmp/proofs.json \
  --summary "100% line coverage confirmed. All helpers verified with independent critic command receipts."
```

```text
### Completeness Critic Sign-Off: APPROVED
- **Critic**: `critic-1`
- **Summary**: 100% line coverage confirmed. All helpers verified.
- **Authorization**: Valid completion certificate issued.
```

---

## 🔚 Step 15 & 16: Teardown Grants, Seal Capsule & Diagnostics

Release all active grants before sealing:

```bash
for agent in impl-slug impl-truncate sub-measure val-slug-2 critic-1 coordinator-1; do
  bun harness.ts agent:release --run .capsules/slugger --agent "$agent" --reason "Run complete"
done

bun harness.ts run:complete --run .capsules/slugger --actor coordinator-1 --auth-token "$CRITIC_TOKEN"
```

```text
### 🎉 Run Completed Successfully: slugger
- **Capsule**: `.capsules/slugger`
- **Summary**: 2 tasks executed, 2 independent validations passed, 1 critic certificate
- **Capsule Status**: Sealed & Auditable
```

Export summary reports and run diagnostics:

```bash
bun harness.ts summary:export --run .capsules/slugger
bun harness.ts dag:trace --run .capsules/slugger --max-steps 25
bun harness.ts doctor --run .capsules/slugger
bun harness.ts watchdog:verify --generation 1
```

```text
### Summary Suite Exported: slugger
- **Artifacts Generated**: `summary/graph.json`, `summary/timeline.json`, `summary/metrics.json`, `summary/summary.md`

### Capsule Doctor: .capsules/slugger
- **Healthy**: YES ✅ | **Gitignored**: YES ✅ | **Issues**: 0
```

---

## 📋 Complete Lifecycle Command Reference Table

|  Step  | Command                          |   Phase    | Core Action & State Transition                                                           |
| :----: | :------------------------------- | :--------: | :--------------------------------------------------------------------------------------- |
| **1**  | `plan:init`                      |  Planning  | Creates `.capsules/<slug>`, freezes `prompt.md` at mode `0444`.                          |
| **2**  | `plan:enhance`                   |  Planning  | Records host-observed repository facts into `planning/enhanced-plan.md`.                 |
| **3**  | `plan:add`                       |  Planning  | Declares tasks, write scopes, and `--requirement-lines` prompt bindings.                 |
| **4**  | `plan:audit` / `compile`         |  Planning  | Runs 6 structural invariants; commits `state.graph` (Revision 1).                        |
| **5**  | `plan:validate-start`            | Validation | Independent `plan-validator` adversary audits decomposition.                             |
| **6**  | `queue:wave` / `dag:render`      | Scheduling | Inspects conflict-free wave and renders Sugiyama ASCII DAG.                              |
| **7**  | `agent:register`                 | Execution  | Registers Tier 2/3 agent identities into `state.agents` ledger.                          |
| **8**  | `task:claim`                     | Execution  | Leases task, issues one-time bearer token, records scope baseline digest.                |
| **9**  | `run:exec` / `gate:prove`        | Execution  | Runs gate commands; proves gate falsifiability on reverted scratch tree.                 |
| **10** | `branch:open` / `collect`        | Execution  | Subdivides task at execution time; freezes parent lease clock.                           |
| **11** | `task:validate-start`            | Validation | Mints validation lease with mandatory independence rules.                                |
| **12** | `task:probe` / `reject`          | Validation | Issues probe demands; records defect findings transitioning task to `changes_requested`. |
| **13** | `task:claim --role repairer`     |   Repair   | Leases task under repair contract (bounded 6-round budget).                              |
| **14** | `task:review --resolve`          | Validation | Passes task and resolves all probe/defect findings with command IDs.                     |
| **15** | `critic:start` / `review`        | Completion | Completeness Critic executes independent checks and issues completion certificate.       |
| **16** | `agent:release` / `run:complete` |    Seal    | Releases all agent grants; seals capsule permanently.                                    |

---

[⬅ Previous: Evidence Classes & Honesty](../09-branching-and-honesty/03-evidence-classes-and-honesty.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)
