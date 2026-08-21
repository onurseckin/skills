# 03. Evidence Classes & The Honesty Model

[⬅ Previous: The Agent Grant Ledger](./02-agent-grant-ledger.md) | [Master Table of Contents](../README.md) | [Next: Chapter 10 — End-to-End Tutorial ➡](../10-tutorial-and-cli/01-end-to-end-tutorial.md)

---

## 🏷️ Every Reported Value Carries a Label

"Prose is not state" (Chapter 01) says an agent's claim has no authority. But a capsule is full of
values that came from _somewhere_, and a reader deserves to know which somewhere. A gate exit code
and an implementer's summary are both stored; they are not the same kind of fact.

`evidence_class` is the label that keeps them apart:

```ts
export type EvidenceClass =
  | "harness_observed" // the harness itself measured it: exit codes, byte counts, git diff, wall clock
  | "agent_reported" // an agent said so through the CLI; true only if the agent was honest
  | "host_reported" // defined for a host attestation the harness independently confirmed; see below
  | "derived" // computed from other recorded values, or read off the host's own static config
  | "unknown"; // not available — renders as "unknown", never as a default
```

`host_reported` is a real member of the type, but no current code path assigns it. Model, tier,
thinking level, granted tools and token counts all arrive as free-text CLI input from whichever
process called the harness — indistinguishable, mechanically, from any other flag — so they carry
`agent_reported`, the same as everything else typed on the command line. This was a deliberate
correction: stamping `host_reported` on a CLI-supplied value unconditionally would let a caller type
a nonexistent model id and have it recorded as though the host had attested to it. The two real
sources that DO earn a stronger class are `detectHostTelemetry` (the host's own on-disk config,
read automatically rather than typed — `derived`, because it is a setting that merely implies what
ran) and `readAgentTranscriptTelemetry` (the host's own transcript of the agent — `harness_observed`,
because it is what the host recorded actually happening). Either one only ever fills a field with no
explicit report already on it; a value that disagrees with an explicit report is never silently
substituted, it is recorded as a conflict instead. `model_tier` is never probed at all: nothing
legitimately infers a tier from a model string.

Three rules follow, and they are absolute:

1. **No code substitutes a plausible value for a missing one.** Absent stays absent.
2. **Estimates are flagged twice**: `evidence_class: "derived"` _and_ `is_estimated: true`. A number
   that is a guess cannot be mistaken for one that was counted.
3. **Unknown renders as "unknown"**, never as a neutral-looking default that reads like a fact.

---

## 🔍 Where the Label Actually Appears

| Value                                           | Class                                                        | Why                                                                   |
| :---------------------------------------------- | :----------------------------------------------------------- | :-------------------------------------------------------------------- |
| Command `exit_code`, timings, log bytes         | `harness_observed`                                           | The runner started the process and read the descriptors.              |
| `branch:collect` `files_changed`                | `harness_observed`                                           | A real Git reading of the worktree, diffed against the open baseline. |
| Task submission `summary`                       | `agent_reported`                                             | The implementer's own words.                                          |
| Branch `reason`, sub-task summaries             | `agent_reported`                                             | Why an agent chose to subdivide, in its own words.                    |
| `plan:enhance` document, in full                | `agent_reported`                                             | The agent's reading of the repository, not a harness measurement.     |
| Agent `model` / `model_tier` / `thinking_level` | `agent_reported`                                             | Only when the dispatcher supplied it; otherwise the field is absent.  |
| Token counts                                    | `agent_reported`, or `derived` + `is_estimated`              | Relayed, or explicitly a guess.                                       |
| Topology `rationale`                            | `agent_reported` when a coordinator wrote it, else `derived` | The harness's own explanation is derived, not attributed to anyone.   |
| Probe demands                                   | `agent_reported`                                             | A demand is a validator's claim about what still needs proving.       |

A concrete pair from the tutorial capsule's exported graph:

```json
"telemetry": {
  "agentId": "impl-slug",
  "role": "implementer",
  "host": "claude-code",
  "model":         { "evidence_class": "agent_reported", "value": "claude-opus-4-6" },
  "modelTier":     { "evidence_class": "agent_reported", "value": "l" },
  "thinkingLevel": { "evidence_class": "agent_reported", "value": "high" }
}
```

```json
"telemetry": {
  "agentId": "val-slug-2",
  "role": "validator",
  "host": "claude-code",
  "grantStatus": "released"
}
```

The validator node carries no `model` key at all. That is the honest rendering: nobody reported one,
so there is nothing to render, and the viewer shows "unknown" rather than borrowing the model of the
machine that happened to run `summary:export`.

---

## 🧭 Legibility: What the Exported Graph Says Now

`summary:export` writes `graph.json` as a `GraphDataset`. Three structural decisions make a run
readable instead of merely recorded.

### 1. Validators are their own nodes

A validator is a first-class `agent` node, distinct from the gate it runs. The handoff, the probe and
the sign-off are therefore edges between two identities rather than attributes of one box. From the
tutorial run:

```text
node-task-task-slug        [agent]  Slugify helper
node-validator-task-slug   [agent]  Validator: val-slug-2
node-gate-task-slug        [gate]   Gate: Slugify helper
```

### 2. A branch becomes a `GraphSection` carrying its recorded reason

```json
{
  "id": "section-branch-B-6731b09f-…",
  "title": "Branch of task-truncate",
  "reason": "measuring the cut point and choosing the ellipsis are separable and were slowing each other down",
  "parentNodeId": "node-task-task-truncate",
  "status": "collected",
  "nodeIds": ["…-S-measure", "…-S-ellipsis"]
}
```

The region is grouped visually and the grouping states _why_ it exists — the reason the agent gave at
`branch:open`, not a label the exporter invented.

### 3. The edge vocabulary distinguishes a probe from a pushback

Nineteen edge kinds are declared: `backtrack`, `branch`, `collect`, `conditional`, `critic`, `data`,
`dependency`, `dispatch`, `fallback`, `gate`, `handoff`, `join`, `loop`, `probe`, `pushback`,
`sequence`, `signoff`, `spawn`, `validation`.

`probe` and `pushback` are deliberately separate. A probe demands proof and costs the implementer
nothing; a pushback asserts a defect. Rendering them identically would make every probed task read as
rejected. The tutorial run — one real rejection, two probes — emits exactly:

```text
sequence, dispatch, spawn, handoff, validation, probe, pushback, join, branch, collect, signoff
```

---

## 📦 `node.assets` Is the Only Home for Evidence

Screenshots and other media hang off exactly one place: `node.assets`. Nothing else in the graph
repeats them, and a node may only carry assets produced by commands scoped to that node.

That last clause matters more than it looks. A node built without a task scope would otherwise vacuum
every screenshot in the run onto one box, and the graph would claim an agent produced work it never
touched. Ownership is per node, and a node with no evidence of its own shows none.

Alongside assets, each node carries:

- **`scripts[]`** — commands the harness ran and timed for that node: argv, cwd, exit code, duration,
  gate id, actor, log path, and real stdout/stderr tails read from the recorded log bytes. Each entry
  carries its own `evidence_class`.
- **`tools[]`** — tools the node's agent was granted or reported using, never inferred from argv.
- **`stateTransitions[]`** — the recorded moves of the task state machine, with the verdict, round,
  finding class and finding count the review carried when it caused one.

---

## 🚫 What the Honesty Rule Forbids

- Stamping one detected model onto every node because the exporting machine had one configured.
- Inventing a dollar cost when the recorded cost is zero.
- Emitting edge traffic constants — bytes, durations — that nobody measured. Traffic is emitted from
  observed bytes and durations, or omitted.
- Turning an unreadable repository into an empty file list.
- Labelling a clean pass "requested changes" because the event payload was too thin to tell the
  difference. `review-recorded` carries `verdict`, `round`, `class` and `finding_count` precisely so a
  reader never has to guess which one it was.

The negative space is the feature. A field that is missing tells you something true; a field that was
filled in to look complete tells you nothing at all.

---

[⬅ Previous: The Agent Grant Ledger](./02-agent-grant-ledger.md) | [Master Table of Contents](../README.md) | [Next: Chapter 10 — End-to-End Tutorial ➡](../10-tutorial-and-cli/01-end-to-end-tutorial.md)
