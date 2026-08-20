# 01. Complete End-to-End Tutorial

[⬅ Previous: Evidence Classes & Honesty](../09-branching-and-honesty/03-evidence-classes-and-honesty.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)

---

## 🎯 What This Tutorial Is

A complete run, start to finish, on a repository you can build in two minutes. Every command below
was executed in order against that repository, and every output block is the real stdout of that
execution — including the two failures that teach the most.

The run exercises the whole surface that matters: prompt capture, an enhanced plan, a compiled
topology, a dispatched wave, a branch that splits work at execution time, a genuine rejection and
repair, a mandatory adversarial probe, the completeness critic, and mechanical completion.

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
- **Document**: `planning/enhanced-plan.md` (sha256 `f52356841938a33a04e0b40be64c88525877e03db7b7e0660a721aa0f5bd1e1e`)
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

---

## 🏗️ Step 4: Compile

```bash
bun harness.ts plan:status --run .capsules/slugger
bun harness.ts plan:compile --run .capsules/slugger --actor planner --completion-gate "bun test tests"
```

```text
### Plan Compiled Successfully (Graph Revision 1)
- **Total Tasks**: 2 registered | **Recorded Waves**: 1 (topology revision 1, max_parallel 4)
- **Wave 1 (Ready Now)**: `task-slug`, `task-truncate` (2 parallel lanes)
- **Scope Isolation**: Disjoint write scopes verified (0 collisions)
- **Requirements Covered**: 2/2 atomic obligations mapped
- **Next Step**: Dispatch the whole ready wave via `bun harness.ts queue:wave --run slugger`
```

`--completion-gate` is mandatory and has no default. It is also checked for substance — a first
attempt with `--completion-gate "bun test"` was refused outright:

```text
{"ok":false,"error":{"code":"INTEGRITY","message":"compiled graph failed validation: gates[2].command must perform substantive verification"}}
```

Gate ids are derived from task ids: `task-slug` → `gate-slug`, plus the run-scope `gate-run-completion`.

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

```bash
bun harness.ts task:claim --run slugger --task <TASK_ID> --agent <AGENT_ID> --role implementer
```
```

`queue:wave` is read-only and reports every task claimable right now, so a coordinator dispatches
each one as an agent frees up instead of waiting for the list to be claimed as a unit. `queue:pop`
hands out one task at a time and is the right tool for filling a single freed slot.

---

## 🪪 Step 6: Register Every Agent Before It Works

```bash
bun harness.ts agent:register --run .capsules/slugger --agent coordinator-1 \
  --role coordinator --host claude-code

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
```bash
bun harness.ts agent:release --run .capsules/slugger --agent impl-slug
```
```

```text
### Agent Granted: impl-truncate (implementer)
- **Under**: `coordinator-1` / task `task-truncate`
- **Host**: `claude-code` · **Provider**: unknown
- **Model**: unknown · **Tier**: unknown
- **Thinking**: unknown · **Context Window**: unknown
- **Tools Granted**: unknown

#### Close The Grant:
```bash
bun harness.ts agent:release --run .capsules/slugger --agent impl-truncate
```
```

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
- **Lease Token**: `K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A`
- **Duration**: 20 minutes
- **Assigned Write Scope**: `src/slug.ts`
- **Note**: Pass `--token K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A` to `task:submit`.
```

`--role` is mandatory. It is the capability contract the agent is bound to for the whole lease
(`orchestrating-long-tasks/roles/<role>.md`): `implementer` for fresh work, `repairer` for a task in
`changes_requested`. The token is printed once and only its SHA-256 digest is stored.

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

bun harness.ts task:submit --run .capsules/slugger --task task-slug --agent impl-slug \
  --token "$SLUG_TOKEN" --summary "slugify returns the expected slug for both cases in tests/slug.test.ts."
```

```text
### Command Executed: `bun test tests/slug.test.ts`
- **Exit Code**: `0` (Success) | **Duration**: 0.67s
- **Output Summary**: Command completed successfully
- **Evidence Recorded**: `.capsules/slugger/commands/C-d5c672c2-6ec5-44af-a547-86c3fb253dbf/record.json`
- **Raw Stream Log**: `<absolute-path-to-the-same-record.json>`
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
observation of the worktree narrowed to the write scope, not from a default path. Every recorded
command now lives at `commands/C-<uuid>/record.json` rather than a flat `evidence/` file; `evidence/`
still exists on disk but only for readable names hardlinked onto `blobs/`, never command records
(Chapter 01 §02).

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
### Branches: .capsules/slugger

| Branch | Parent | Depth | Status | Submitted | Files | Reason |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `B-6731b09f-…` | `task-truncate` | 1 | open | 0/2 | unknown (no repository observation) | measuring the cut point and choosing the ellipsis are separable and were slowing each other down |
```

The parent is now `branched` and its lease clock is frozen. Each sub-scope is a _proper_ subset of
`src/truncate` and disjoint from its sibling; anything else is refused rather than trimmed.

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
- **Branch**: `B-6731b09f-…` on `task-truncate`
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
### Branch Collected: B-6731b09f-…
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
- **Validation Token**: `BtYrfM4hNV-YBbSBw3jp6eHUI-GmVZAXbPBT9b2l6cQ`
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
- **Gate Results**: gate-slug: C-168a1579-5c14-468f-bb76-04463fdfed87 exited 0
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
**Occupancy**: 0/4 occupancy slots in use.
**Capsule**: `<N>` commands, `<N>` captures over `<N>` blobs (`<size>`), 0 open findings — index current
```

`run:status` reports live occupancy against `default_max_parallel` and a one-line capsule catalogue
summary alongside task progress — the occupancy figure is what B24's continuous-dispatch policy makes
visible: idle capacity that would otherwise go unnoticed.

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
        "reference": "C-6c9cbf46-…",
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
        "reference": "C-b0f3a57a-…",
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
for a in impl-slug impl-truncate val-slug-2 val-truncate critic-1 coordinator-1; do
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
  - `graph.json` (GVUI GraphDataset, 12 nodes, 19 edges)
  - `timeline.json` (61 chronological events)
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

---

## 📋 The Whole Run in One Table

| #   | Command                                        | What it changed                                                          |
| :-- | :--------------------------------------------- | :----------------------------------------------------------------------- |
| 1   | `plan:init`                                    | Capsule created, prompt bytes frozen at `0444`.                          |
| 2   | `plan:enhance`                                 | `planning/enhanced-plan.md`, digest in `state.planning`.                 |
| 3   | `plan:add` ×2                                  | Planning buffer, tasks bound to prompt lines.                            |
| 4   | `plan:compile`                                 | Requirements, DAG, revision 1, `state.topology`.                         |
| 5   | `queue:wave`                                   | Read-only; the whole conflict-free wave.                                 |
| 6   | `agent:register` ×N                            | `state.agents` grants and lineage.                                       |
| 7   | `task:claim --role`                            | Lease + one-time bearer token.                                           |
| 8   | `run:exec`                                     | Command record, log bytes, `trusted_host_observed_v1` evidence.          |
| 9   | `task:submit --summary`                        | Submission report; scope compliance checked against Git.                 |
| 10  | `branch:open` / `claim` / `submit` / `collect` | `state.branches`; parent frozen, then resumed with a measured file list. |
| 11  | `task:validate-start`                          | Validation token; independence enforced.                                 |
| 12  | `task:reject`                                  | Defect finding; `changes_requested`; repair round +1.                    |
| 13  | `task:claim --role repairer`                   | Repair lease.                                                            |
| 14  | `task:probe`                                   | Probe demand; probe round +1, repair round untouched.                    |
| 15  | `task:review --status pass --resolve …`        | Verdict; every open finding answered.                                    |
| 16  | `critic:start` / `critic:review`               | Completion certificate with requirement proofs.                          |
| 17  | `agent:release` ×N                             | Grants closed.                                                           |
| 18  | `run:complete`                                 | Capsule sealed.                                                          |
| 19  | `summary:export` / `doctor`                    | Graph, timeline, metrics, integrity report.                              |

---

[⬅ Previous: Evidence Classes & Honesty](../09-branching-and-honesty/03-evidence-classes-and-honesty.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)
