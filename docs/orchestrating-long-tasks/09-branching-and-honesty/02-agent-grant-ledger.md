# 02. The Agent Grant Ledger & Lineage

[⬅ Previous: Execution-Time Branching](./01-execution-time-branching.md) | [Master Table of Contents](../README.md) | [Next: Evidence Classes & The Honesty Model ➡](./03-evidence-classes-and-honesty.md)

---

## 👤 The Question the Capsule Could Not Answer

A task record names the task and the agent id that claimed a lease. On its own that does not answer
the questions a person actually asks after a long run:

- Who was deployed on this run, and who deployed them?
- Which model ran which task, and at what thinking level?
- How many tokens did this subagent consume?
- When a sub-agent produced a file, whose sub-agent was it?

Spawning happens host-side — the harness never calls a model API and never launches an agent process
(Chapter 04). So the run can only know these things if the dispatcher **tells** it. `state.agents` is
that record, and the `agent:*` family is how it is written.

---

## 🪪 `agent:register` — the grant

```bash
bun harness.ts agent:register --run .capsules/<run-id> \
  --agent impl-slug --role implementer --host claude-code \
  --parent-agent coordinator-1 --parent-task task-slug \
  --model claude-opus-4-6 --model-tier l --thinking-level high \
  --tool Read --tool Write --tool Bash
```

The agent id recorded here is the same string the harness later sees as an event `actor` and a
command actor. That is what closes the loop between "an agent was deployed" and "this work was done
under that grant".

Rules the ledger enforces:

- `--role` must be one of the ten canonical roles: `coordinator`, `planner`, `plan-validator`,
  `implementer`, `repairer`, `sub-implementer`, `sub-investigator`, `sub-validator`, `validator`,
  `completeness-critic`.
- `--parent-agent` must already hold a grant. Omit it only for the root.
- Model, tier, thinking level and granted tools are **optional and stay absent** when the dispatcher
  does not supply them.

That last rule is the whole point. Compare two real registrations from the tutorial run:

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

The second agent ran on the same machine, under the same harness, on the same day. Nothing was
inferred from the exporting machine's config, and no plausible default was substituted. It renders as
`unknown` because it _is_ unknown. Every field on the first block reads `agent_reported`, not
`host_reported`: a `--model`/`--model-tier`/`--thinking-level` flag is whatever the calling process
claims, and nothing here confirms the host itself attested to it — see
[Evidence Classes §03](./03-evidence-classes-and-honesty.md). The generated "Close The Grant" block
always fills a literal `--reason "<why>"` placeholder rather than omitting the flag: `agent:release`
requires a stated reason (invariant B21 — a lifecycle transition that closes out an agent's
participation is never recorded silently), the same rule chapter 09 §01 documents for `branch:collect`
and `branch:abandon`.

### 🧑‍⚖️ The Tenth Role: `plan-validator`

`plan-validator` is the newest of the ten canonical roles — the coordinator's own adversary for the
_compiled plan itself_, dispatched once per graph revision rather than once per task (see
[Chapter 03 §03](../03-graph-scheduler/03-plan-revision-and-freezing.md) for what its verdict does to
`task:claim`). Registering one is identical to registering any other role — there is no separate grant
mechanism:

```bash
bun harness.ts agent:register --run .capsules/<run-id> --agent plan-val-1 \
  --role plan-validator --host claude-code --parent-agent coordinator-1
```

```text
### Agent Granted: plan-val-1 (plan-validator)
- **Under**: `coordinator-1` / no task
- **Host**: `claude-code` · **Provider**: unknown
- **Model**: unknown · **Tier**: unknown
- **Thinking**: unknown · **Context Window**: unknown
- **Tools Granted**: unknown

#### Close The Grant:
```

```bash
bun harness.ts agent:release --run .capsules/slugger --agent plan-val-1 --reason "<why>"
```

Its grant carries `/ no task` under "Under" — a plan-validator reviews the whole compiled plan, not a
task, so `--parent-task` is never supplied for it. The one independence rule the ledger enforces for
this role fires when a validation claim is actually opened
(`plan:validate-start`, not at registration time): a `plan-validator` cannot be the same agent id as
the `coordinator` or `planner` that produced the plan under review —

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"plan validator must be independent from the coordinator or planner that produced the plan","issues":[]}}
```

— the same shape of independence rule chapter 06 documents for a task-level `validator`
(`validator must be independent from implementers`), applied to the whole plan instead of one task.

---

## 📊 `agent:report` — telemetry in flight

```bash
bun harness.ts agent:report --run .capsules/<run-id> --agent impl-slug \
  --tool Read --tool Edit --tokens-in 18000 --tokens-out 2400
```

- At least one of `--tool`, `--tokens-in`, `--tokens-out` or `--token-extra` is required; an empty
  report is refused.
- Token counts are whatever the caller relayed as **running totals** and replace the previous ones,
  not add to them. Like every other field an `agent:report` flag sets, they carry `agent_reported`
  evidence class — a plain `--tokens-in`/`--tokens-out` count is unverified CLI input, not a host
  attestation, unless a transcript probe later corroborates it.
- `--tokens-estimated` records the counts as `derived` estimates with `is_estimated: true` instead.
  There is no third option: a number is either an unverified count someone reported or an estimate
  that says so.
- A released grant can no longer report.

---

## 🔚 `agent:release` — closing the grant

```bash
bun harness.ts agent:release --run .capsules/<run-id> --agent impl-slug --reason "task-slug done"
```

Release every grant **before** `run:complete`. A completed run is terminal, and a late release fails:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"completed runs are terminal and cannot be mutated"}}
```

---

## 🧬 `agent:list` — roster and lineage

Without flags, `agent:list` shows active grants with whatever telemetry was reported for them. With `--task` it
answers "who worked this task, and under whom", including the agents those agents dispatched:

```text
### Task Lineage: task-truncate

| Depth | Agent | Role | Under | Status |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `impl-truncate` | implementer | `coordinator-1` | released |
| 0 | `val-truncate` | validator | `coordinator-1` | released |
| 1 | `sub-measure` | sub-implementer | `impl-truncate` ← `coordinator-1` | released |
| 1 | `sub-ellipsis` | sub-implementer | `impl-truncate` ← `coordinator-1` | released |
```

Depth 1 rows are the branch children from the previous chapter. `--all` includes released grants,
which is what the table above used after the run had closed every grant.

---

## 🗂️ The Grant Record

`state.agents` is an array of grant records:

| Field                                     | Evidence class                                                      | Notes                                                     |
| :---------------------------------------- | :------------------------------------------------------------------ | :-------------------------------------------------------- |
| `id`, `role`, `host`, `granted_at`        | harness                                                             | Always present.                                           |
| `parent_agent_id`, `parent_task_id`       | harness                                                             | `null` for the root.                                      |
| `status`, `released_at`, `release_reason` | harness                                                             | `active` or `released`.                                   |
| `model`, `model_tier`, `thinking_level`   | `agent_reported` / `harness_observed`                               | Optional. Probed from transcript or agent-declared.       |
| `tools_granted`                           | `agent_reported`                                                    | Optional; what the dispatcher relayed.                    |
| `tools_used[]`                            | per-entry `evidence_class`                                          | Each tool carries its own class and first-seen time.      |
| `tokens_in`, `tokens_out`                 | `agent_reported`, `harness_observed`, or `derived` + `is_estimated` | Real counts or estimates.                                 |
| `telemetry_conflicts[]`                   | harness                                                             | Disagreements between agent reports and host transcripts. |
| `report_count`, `last_reported_at`        | harness                                                             | Optional.                                                 |

The three events are `agent-registered`, `agent-reported`, `agent-released`.

---

## 📡 Host Probe Telemetry Merging (`refreshAgentDerivedTelemetry`)

On lifecycle boundaries (`task:claim`, `task:submit`, `agent:release`), the harness invokes the host probe to merge host-observed telemetry into the active grant:

1. **`mergeDerivedField`**: Merges provider, model, thinking level, and context window. If the agent self-reported a value that contradicts host transcripts, the conflict is recorded in `telemetry_conflicts` without overwriting the explicit claim.
2. **`mergeObservedCount`**: Replaces estimated token counts with real host-observed token counts (`tokens_in`, `tokens_out`).
3. **`mergeObservedTools`**: Reconciles tool usage events and failure counts from transcript tool call logs.
4. **`checkParentAgentConflict`**: Asserts that the claimed parent agent ID matches observed transcript spawn depth.

---

## 🚦 Where the Grants Land in the Graph

`summary:export` uses the ledger, and only the ledger, for per-agent attribution. Host _identity_
detection — which harness a run happened under — is still inferred from the machine, because that is a
property of the export. Per-agent **model attribution is not**: an agent whose model nobody reported
renders "unknown" on its node, on every node, forever. There is no fallback that stamps the exporting
machine's model onto agents that never declared one.

---

[⬅ Previous: Execution-Time Branching](./01-execution-time-branching.md) | [Master Table of Contents](../README.md) | [Next: Evidence Classes & The Honesty Model ➡](./03-evidence-classes-and-honesty.md)
