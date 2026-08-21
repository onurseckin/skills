# Harness protocol

## Non-negotiable invariants

- `prompt.md` is immutable, byte-preserved, read-only, and SHA-256 bound to `manifest.json`.
- A run with unverified capture is labeled `recorded-unverified`; no agent may silently upgrade it.
- Every nonblank prompt line has exactly one disposition, and every obligation maps to an atomic
  requirement through the canonical `requirement` line kind. Atomic requirements independently
  declare actionable or pending-authority disposition; only an audited authority decline disposes
  an obligation.
- Mutations run through the harness CLI under a kernel lock, a canonical state projection, and
  append-only hashed events. Agent prose and process memory are never authoritative state.
- Every recorded value carries an `evidence_class`, and no code substitutes a plausible value for a
  missing one. Absent stays absent and renders as "unknown".
- An agent writes only its leased scope. Validators are independent and receive allowlisted context
  without implementer narrative or prior-review anchoring.
- Retries are bounded and allowed only for declared idempotent transient failures. Unknown,
  authorization, test, and policy failures are terminal until a human/agent decision records a new
  attempt.
- Completion is mechanical: integrity, traceability, task states, findings, leases, branches,
  validation, commands, gates, and completeness-critic approval must all pass.

## The evidence spine

Every value the system reports is labelled with how it was learned:

| Class              | Meaning                                                                                                                                                                                                         |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness_observed` | The harness measured it: exit codes, byte counts, Git diffs, wall clock.                                                                                                                                        |
| `agent_reported`   | An agent said so through the CLI. True only if the agent was honest.                                                                                                                                            |
| `host_reported`    | Defined for a host attestation the harness independently verified; no current code path assigns it — model id, tier, thinking level and token usage all arrive as CLI input and carry `agent_reported` instead. |
| `derived`          | Computed from other recorded values, such as wave numbers or estimates.                                                                                                                                         |
| `unknown`          | Not available. It must render as "unknown", never as a neutral-looking default.                                                                                                                                 |

Estimates carry `evidence_class: "derived"` **and** `is_estimated: true`. Nothing about an agent's
model, tier or thinking level is inferred from the machine that exported the run.

## Canonical roles

Eleven roles, each with a capability contract in `roles/<role>.md` declaring `may`, `must_not`, the
exact commands it may invoke, and the roles it may branch into:

| Tier       | Roles                                                                                      |
| :--------- | :------------------------------------------------------------------------------------------ |
| 1          | `orchestrator`                                                                              |
| 2          | `coordinator`                                                                                |
| 3          | `planner`, `plan-validator`, `implementer`, `validator`, `repairer`, `completeness-critic` |
| 3 (branch) | `sub-implementer`, `sub-validator`, `sub-investigator`                                      |

The orchestrator sits above every run: it dispatches exactly one coordinator per round and never a
tier 3 agent directly, and it is the only role the main thread (tier 0, outside this table — it never
registers a role) ever dispatches. See `roles/orchestrator.md` and `references/host-adapters.md`.

`task:claim --role` names the contract the agent is bound to for the whole lease: `implementer` for
a ready or retry-ready task, `repairer` for one in `changes_requested`. A mismatch is refused.

## Lifecycle

### 1. Capture

Write the user's exact prompt to a file without summarizing or normalizing it. Initialize from that
file when possible. Use stdin only when the host can prove it supplied the complete source. Record
capture mode and assurance.

After initialization, execute every run command through the same pinned entrypoint:

```text
bun orchestrating-long-tasks/scripts/harness.ts <command> ...
```

If the entrypoint is missing or the capsule fails its integrity check, stop and run `doctor`.

### 2. Inspect the repository, then write down what you read

Record applicable instruction files, dirty paths, recent commits, toolchain/runtime versions,
coding/test conventions, package boundaries, architecture limits, and sensitive/shared ownership
points. Pre-existing changes are outside harness ownership unless explicitly placed in a task.

`plan:enhance` is where that reading becomes a reviewable document. The agent reads the repository
host-side and reports what it found through flags; the harness consults no model and invents no
entry, so everything recorded is `agent_reported`. It writes `planning/enhanced-plan.md` and
`planning/enhanced-plan.json` read-only and records their digests in `state.planning`. The document
is explicitly derived: `prompt.md` stays the requirement source, and an enhancement with no summary,
observation, todo, risk or open question is refused rather than minted from nothing.

### 3. Compile the prompt

Create `requirements.json` and `graph.json` using the schemas in `schema-examples.md`. Requirements
preserve source ranges/excerpts and expand what each instruction means for implementation. A
disposition table proves nothing was dropped. A plural obligation may map actionable and
pending-authority atomic requirements together. Each atomic requirement repeats the shared source
line and exact full-line excerpt; the single line disposition declares duplicate-free
`requirement_ids` instead of `requirement_id` and needs a substantive authority rationale when any
mapped requirement needs authority. The line kind remains `requirement`.

Bind a task to the prompt lines it implements with `plan:add --requirement-lines "3-5,8"`. Without
it the compiler glues the task to a prompt line by position and warns; positional gluing is a
fallback, not a plan.

`plan:compile --completion-gate` declares the command the whole run is finally held to. The compiler
has no default for it and refuses to invent one.

### 4. Build the relational graph

Use node types `agent`, `artifact`, `decision`, `finding`, `gate`, `requirement`, `task`, and `topic`.
Use only `assigned_to`, `blocks`, `depends_on`, `discovered_from`, `evidenced_by`, `implements`,
`produces`, `relates_to`, `supersedes`, and `validates` edges. `depends_on` points from a task to its
prerequisite. Execution dependencies must be acyclic; semantic/topic cycles may be valid.

Give every task normalized write scopes. Equal, ancestor, descendant and glob-overlapping scopes
conflict — `docs/**` and `docs/concepts/**` are the same region. The scheduler ranks ready work
deterministically by priority, critical depth, distinct descendants, age, effort, then ASCII ID and
packs the largest conflict-free batch within the configured concurrency.

Topology is decided once. `plan:compile` records `state.topology`: the waves, and per task the wave
it landed in, what it may run beside, what it was serialized behind, and why. Every later reader —
`queue:wave`, the summary step calculator — reads that record instead of re-deriving it.

### 5. Dispatch native subagents

Construct an immutable packet for each role and persist its Markdown plus metadata before dispatch.
Append the canonical common instructions exactly and bind the packet digest. Use only host-native
agent tools; do not call an API or launch an LLM CLI.

Keep the eligible set full. `queue:wave` is a read-only readiness snapshot — every task claimable
right now — so dispatch each entry the moment an agent is free and recompute it the instant a slot
frees, rather than assembling one batch and waiting for it. Record every dispatched subagent with `agent:register` — id,
role, host, parent agent, parent task, and any host-reported model, tier, thinking level and granted
toolset. The parent must already hold a grant, so lineage is a chain rather than a claim.

The coordinator holds state ownership. Authority commands return tokens once; the coordinator sends
them through the host-native dispatch channel separately from the immutable packet, and only digests
persist. A lost token cannot be reconstructed or reissued; wait for the recorded deadline, run
`recover`, and authorize a new attempt. Heartbeat active work. Preserve late correct-token
submissions as orphan evidence after expiry/recovery, but never let them mutate active task state.

### 6. Subdivide at execution time with a branch

A working agent that discovers its task is really several disjoint pieces opens a branch instead of
fighting the frozen plan contract. `branch:open` requires the parent's live lease token and a
`--reason`, moves the parent to `branched`, and **suspends** the parent's lease clock so it is not
reaped while it waits. Sub-task scopes must be a _strictly proper_ subset of the parent scope and stay disjoint from their
siblings; a violation is refused, not trimmed. That proper-subset rule is what makes a chain of
branches terminate. `max_branch_depth` (default 5) is an escalation tripwire layered on top of it,
and `max_agents` (default 100) caps the grants a run may issue at any depth.

Sub-agents take one sub-task each with `branch:claim` and hand it back with `branch:submit`.
`branch:collect` refuses while any sub-task is still live; it records a real Git observation of the
worktree delta as `harness_observed`, restores the parent lease with a fresh window, and returns the
parent to `running`. `branch:abandon` is the failure path: every non-terminal sub-task is abandoned,
its lease released, and the parent resumes to carry the work itself.

A branch is never a plan task, so it never touches the graph revision. An uncollected branch blocks
completion, and `recover` reclaims sub-tasks whose sub-agent died.

### 7. Collect evidence and validate

Implementer submissions cover every mapped requirement and include changed paths, artifacts, and
focused command IDs. `task:submit --summary` is the agent's own account of what it changed and has
no stand-in; `files_changed` comes from `--files-changed` or from the Git working-tree observation
narrowed to the write scope, and the command fails when neither source yields anything.

A fresh validator receives only authoritative, allowlisted context without implementer narrative or
subjective confidence. It inspects the repository, executes mandatory gate commands under monitored
execution (`run:exec`), and performs an exhaustive adversarial invariant audit:

- Contract boundaries, input extremes, and edge cases;
- Negative assertions and error handling paths;
- Mathematical, algorithmic, and layout precision;
- Visual/layout bounds, responsive constraints, typography, and styling for generated artifacts;
- Substantive test verification (rejecting tautological, shallow, or mocked-out tests).

**The round-1 adversarial check is a probe, not a rejection.** `task:probe --demand "Prove X"` files
a `probe_demand` finding: it asserts nothing about the code, it leaves the task in `validating` under
the same validator, and it does not touch `repair_round` or reassign the repairer. A sign-off is
refused while `probe_round < min_adversarial_probes` (canonically **1**), so the check cannot be
skipped and does not have to be faked as a defect.

`task:reject` is reserved for a defect the validator actually observed. It demands the validator's
own `--reason`, `--severity` and remediation; nothing is graded or worded on its behalf. The same is
true of `task:review --status fail`.

`task:review --status pass` is refused unless all three hold:

1. at least `min_adversarial_probes` probe rounds are recorded;
2. no applicable mandatory gate's latest recorded run exited nonzero or failed — `run:exec` exits 0
   whenever the child ran, so the verdict is judged on the recorded `exit_code`, not the CLI's;
3. every open finding, probe demand and defect alike, is answered with
   `--resolve <finding-id>=<command-id>`. The harness marks nothing answered on the validator's
   behalf and closes nothing merely because some command succeeded.

### 8. Repair with bounded feedback

Route single-task repair findings to the original implementer within `write_scope`, claimed with
`--role repairer`. If recorded policy marks the author unavailable, stale, or repeatedly failing,
lease a replacement with the same frozen task contract. A fresh validator must re-verify the repaired
code against prior findings and re-run gate proofs with nonempty revalidation evidence. After
`max_repair_rounds` (canonically **6**, configurable), the task transitions to `escalated` and the
exact handoff is preserved instead of self-approved.

Probes do not consume this budget. Six is six _repairs_, not six rounds of adversarial questioning.

When defects are cross-cutting or discovered during late-stage completeness review, the coordinator
must not perform in-place single-agent patching. The **Cascading Scope-Aware Replanning & Fan-Back
Protocol** below takes over through `critic:reject` and `plan:replan`.

### 9. Gates and completeness

Run mandatory focused, integration, and final commands through the watchdog. Gate contracts use
literal direct argv and a strict verification grammar: shells, inline runtime modes, no-op tools,
permissive no-test modes, and help/list/watch/dry-run commands are invalid. Runtime commands use
explicit repository-relative scripts or test targets. Recognized test, lint, build, format, and
package-script forms remain valid only with a bare executable name. A path-qualified executable uses
the custom-verifier grammar even if its basename matches a recognized tool. `env` may only wrap a
literal command, with an optional `--`; environment assignments and options are forbidden. Package
scripts accept no trailing or passthrough argv. The only Git proofs are operand-free
`git diff --check` and `git diff --cached --check`. Declared Git and wrapper executable names must be bare;
canonical absolute paths appear only in the execution form after path binding. Any custom verifier must be invoked through its
repository-local executable path, such as `./scripts/check`; reserved tool, wrapper, shell, and no-op
basenames cannot masquerade as custom verifiers. A custom verifier accepts no dash-prefixed arguments;
optional arguments are separate non-option safe tokens or repository-relative paths. A gate accepts
only a successful command whose literal argv fingerprint, task ID, and gate ID match the graph
contract. Then dispatch a completeness critic with the prompt, plans, actual diff, integrity, and gate
records but no implementer reports.

The critic proves requirements or records them unproven; it never grades itself clean. Requirement
proofs come only from `--proofs`, `--proofs-file` or a `--review` payload, an unproven requirement
blocks completion, and a clean verdict carrying one is refused. `integrity_evidence` is always the
harness's own capsule observation measured at review time, because a review file cannot certify its
own capsule.

Mandatory gate evidence is labeled `trusted_host_observed_v1` and is explicitly unsandboxed. The
trusted boundary is the local OS user plus the host-selected toolchain and transitive processes. A
host or coding application may add a sandbox, but the harness neither configures nor attests it.
The before/after observations do not cover a same-user mutate → execute → restore sequence completed
entirely between them; that sequence is outside the threat model. Do not describe this evidence as
hermetic, sealed, reproducible-build evidence, sandboxed, or a complete inferred input closure.

Every terminal mandatory gate must carry a non-null `repository_after` matching its pristine
pre-command repository binding. Gate attachment rejects missing, unknown, or stale assurance.
Completion rechecks each attached gate's post-binding against the live repository binding captured
inside the locked completion transaction. Process ownership and host-ancestor checks are independent
of repository evidence and remain fail closed before any signal is sent.

All packet Git subprocesses use a sanitized seam that disables hooks, pathname fsmonitor, pagers,
external diff, text conversion, and replacement objects with `GIT_NO_REPLACE_OBJECTS=1`.
Repository discovery rejects local `diff.external`, every `diff.*.textconv`, every executable
`filter.*.clean`, `filter.*.smudge`, or `filter.*.process`, and any non-disabled `core.fsmonitor`
before porcelain status. Indexed gitlinks are rejected before porcelain status can inspect an
initialized nested worktree. The two accepted
Git diff checks add `--no-ext-diff` and `--no-textconv` at execution; the declared Git gate argv and fingerprint remain unchanged and remain the graph-contract authority.
The exact child form is separately bound in the command record's persisted `execution_argv`; shape
and disk verification reconstruct it from the declared argv and canonical executable binding. Any
other gate-tagged effective Git command is rejected before command intent publication or process spawn.

### 10. Complete or hand off

Complete only when the runtime reports zero blockers and the completeness critic has approved the run
(`critic:review --decision approve`). Otherwise preserve the handoff: assurance, revisions, tasks,
owners, leases, branches, findings, recent events, and exact next argv, so another supported client
can continue with no conversational context.

---

## Tiered dispatch, the Triad Floor, and the Pairing Invariant

```text
[Tier 0: Main Interactive Thread] (User interaction only)
               │ (Spawns exactly 1 child: the orchestrator)
               ▼
[Tier 1: Background Loop Orchestrator] (Round scheduler, capsule chaining, final synthesis)
               │ (Spawns exactly 1 coordinator per round)
               ▼
[Tier 2: Background Run Coordinator] (Capsule, graph, topology, leases, lease lifecycle)
               │ (Dispatches each task the instant it becomes claimable)
        ┌──────┴─────────────────────────────┐
        ▼                                    ▼
[Tier 3: Task Implementers (N)]       [Tier 3: Adversarial Validators (N)]
 (Disjoint write scopes)               (Allowlisted context, mandatory gates)
        │ branch:open                          (cannot branch: a validation
        │ (holds the task's live lease)         token is not a lease)
        ▼
[sub-implementer / sub-validator / sub-investigator]
```

`branch:open` demands the parent task's live **lease** token and a `leased` or `running` task, so
only the agent actually doing the work subdivides it. A validator holds a validation token against a
task in `validating` and is refused; a `sub-validator` is dispatched into a branch sub-task by the
agent that owns the branch.

1. **The Triad Floor (Minimum 3 Agents Deployed)**: for any run — even a single sequential task
   ($N=1$) — at least 1 Coordinator + 1 Implementer + 1 Validator are deployed. This is a floor, not
   the sizing rule: it is what the formula below reduces to when a task draws exactly one validator
   domain, the common case.
2. **Pairing Invariant, not strict 1:1**: an Implementer is never dispatched alone — every task
   draws at least one independent Validator, becoming eligible the instant that implementer submits.
   But a task's write scope can draw _more than one_ validator domain (B12.2's derivation — every
   task draws `code-quality`; a task touching `.tsx`/`.css` also draws `ui-design`; one touching a
   schema or a public contract also draws `system-design`), and the coordinator dispatches one
   validator per applicable domain. The task reaches `validated` only once every domain it drew has
   independently passed — the pairing is guaranteed, the ratio is not fixed at one.
3. **Sizing is Σ, not 2N+1**: total agents deployed is `1 coordinator + N implementers +
Σ(validators per task)`, where each task contributes as many validators as it has applicable
   domains (at least one). A single-domain run collapses back to the familiar `2N+1`; a run with
   multi-domain tasks costs more agents for richer validation, bounded by `max_agents` (the run's
   total-agent budget, independent of this formula).
4. **Occupancy, not sizing**: there is no fixed implementer:validator ratio and no batch size to
   compute. Dispatch whatever is claimable up to the occupancy ceiling (`default_max_parallel`), and
   refill the instant a slot frees.
5. **Every dispatch is registered**: one `agent:register` per subagent, before it starts work.
6. **The orchestrator sits above the floor, not inside it**: the Triad Floor and the Σ formula count
   one run's coordinator, implementers and validators — never the tier 1 orchestrator that dispatched
   that coordinator. The orchestrator dispatches a coordinator per round and never a tier 3 agent
   directly; a round's own agent count is unaffected by how many rounds the loop has run.

### Isolation boundaries

1. **Main Thread Isolation (Tier 0)**: Tier 0 is dedicated to user dialogue and whole-loop milestone
   notifications. It never runs worker tools, edits files, or polls background tasks, and spawns
   exactly one child: the orchestrator.
2. **Orchestrator Mediation (Tier 1)**: the orchestrator owns the round scheduler, chains capsule
   state across rounds, and synthesizes a coordinator's or critic's findings into the next round's
   prompt instead of bubbling them to Tier 0. It spawns exactly one coordinator per round and
   composes the one finished, whole-run report itself.
3. **Coordinator Mediation (Tier 2)**: the coordinator holds capsule ownership, manages lease tokens,
   compiles graph revisions, and dispatches continuously. It emits milestone summaries to Tier 1.
4. **Leaf Isolation (Tier 3)**: implementers and validators report exclusively to the coordinator,
   never to Tier 0, never to Tier 1, and never to each other. Sub-agents report to the agent that
   branched them.
5. **Token & Lease Isolation**: lease, validation and critic tokens are non-transferable, tied to a
   specific agent id and deadline, handed over the native channel, and never written to shared files.
   Reports persist digests only.
6. **Write Scope Isolation**: every implementer holds a normalized, disjoint `write_scope`;
   overlapping scopes are refused by the scheduler and by `branch:open` alike.

The exhaustive `may` / `must_not` lists are in `roles/<role>.md`; those documents bind, not this
summary.

---

## Cascading Scope-Aware Replanning & Fan-Back Protocol

When late-stage completeness verification detects defects across the repository diff, the harness
triggers dynamic graph recompilation and parallel repair rounds:

```text
               ┌────────────────────────────────────────────────────────┐
               ▼                                                        │
[All Tasks Done] ──► [critic:start] ──► [critic:reject]                 │
                                               │                        │
                                               ▼                        │
                                        [plan:replan]                   │
                                               │                        │
                                               ▼                        │
                                 [Compile Repair Round R DAG]           │
                                  (Graph Revision R -> R+1)             │
                                               │                        │
                                               ▼                        │
                          [Dispatch Each Repair Task When Claimable]    │
                               (One fresh validator per repair)         │
                                               │                        │
                                               ▼                        │
                                  [All Repair Tasks Terminal]           │
                                 (All repair tasks reach done)          │
                                               │                        │
                                               └────────────────────────┘
                                               │ (Re-convergence)
                                               ▼
                                        [critic:start]
                                               │
                                               ▼
                                        [critic:review] (approve)
                                               │
                                               ▼
                                        [run:complete]
```

### 1. Late-stage defect ingestion (`critic:reject`)

- The Completeness Critic reviews the full repository diff against immutable prompt bytes.
- When unfulfilled requirements, regressions, or integration gaps are identified, the critic rejects
  the run via `critic:reject` (or `critic:review --decision request_changes`). Structured findings
  are mandatory; the harness composes none on the critic's behalf.
- Each finding carries `id`, `requirement_id`, `severity` (`critical` / `important` / `minor`),
  `observation`, `remediation`, and `revalidation`, and may name `file_paths`.

### 2. Dynamic scope partitioning (`plan:replan`)

- The coordinator invokes `plan:replan --run $RUN --actor coordinator`.
- **Finding clustering**: open findings are clustered by file paths into disjoint write scopes.
  Findings touching intersecting files are grouped into one repair task to prevent write collisions.
- **Task & gate generation**: modular repair tasks with mandatory revalidation gates. `--gate` may be
  omitted only when the findings declare `revalidation_gate` or the planned task covering the scope
  has a gate to inherit; there is no default.
- **Graph revisioning**: `graph_revision` increments by exactly one, the previous documents are
  archived immutably, and the critic lifecycle records are cleared for a fresh review.

### 3. Continuous repair dispatch

- The coordinator reads the injected repair tasks with `queue:wave` and dispatches each one the
  moment it is claimable, registering every agent. A repair task's fresh adversarial validator is
  eligible the instant that repair is submitted, independent of every other repair task in the
  revision.
- Repair workers operate strictly within their partitioned write scopes.

### 4. Validation barriers and re-convergence

- **Atomic validation barrier**: every repair task independently completes
  `ready → leased → running → submitted → validating → validated → gating → done`, with a recorded
  probe round and verified `run:exec` evidence.
- The barrier blocks completion until zero repair tasks remain unverified or failed.
- **Re-convergence**: once cleared, the coordinator re-triggers `critic:start` against the updated
  repository. On `critic:review --decision approve`, the run is sealed with `run:complete`.

---

## Formal state transitions

| Current state           | Trigger / command                   | Next state             | Required conditions & invariant checks                                                          |
| :---------------------- | :---------------------------------- | :--------------------- | :---------------------------------------------------------------------------------------------- |
| `proposed`              | `plan:compile`                      | `ready`                | Disjoint write scopes validated; atomic requirements mapped; topology recorded.                 |
| `ready` / `retry_ready` | `task:claim --role implementer`     | `leased`               | Dependencies done; lease token minted; deadline bound.                                          |
| `leased`                | `task:heartbeat`                    | `running`              | Valid lease token; expiry moved forward by the lease's own duration.                            |
| `leased` / `running`    | `branch:open`                       | `branched`             | Live parent token; sub-scopes inside the parent and disjoint; lease clock suspended.            |
| `branched`              | `branch:collect` / `branch:abandon` | `running`              | Every sub-task terminal (collect); lease restored with a fresh window.                          |
| `leased` / `running`    | `task:submit`                       | `submitted`            | Valid token; write scope unviolated; summary and changed files present.                         |
| `leased` / `running`    | `task:release`                      | `retry_ready`          | Live token; `changes_requested` instead when the attempt was a repair.                          |
| any leased state        | `recover` (lease expired)           | `retry_ready`          | Past expiry plus grace; suspended leases exempt; repair attempts return to `changes_requested`. |
| `submitted`             | `task:validate-start`               | `validating`           | Independent validator assigned; implementer prose stripped from the packet.                     |
| `validating`            | `task:probe`                        | `validating`           | `probe_round` +1; `repair_round` untouched; demands recorded as open findings.                  |
| `validating`            | `task:reject` / `--status fail`     | `changes_requested`    | Validator-authored severity, observation and remediation; `repair_round` +1.                    |
| `changes_requested`     | `task:claim --role repairer`        | `leased`               | Claimant is the recorded repair assignee; bounded by `max_repair_rounds`.                       |
| `changes_requested`     | `task:reject` at the budget         | `escalated`            | `repair_round` reached `max_repair_rounds`; handoff preserved.                                  |
| `validating`            | `task:review --status pass`         | `validated`            | Probe budget met; no failing gate run; every open finding `--resolve`d.                         |
| `validated`             | mandatory gate attachment           | `gating`               | Gate argv fingerprint, task and gate ids match the contract; bindings match.                    |
| `gating`                | all mandatory gates attached        | `done`                 | Review passed and every applicable mandatory gate satisfied.                                    |
| `done` (all tasks)      | `critic:start`                      | critic assigned        | Fresh repository inspection recorded; critic token minted.                                      |
| critic assigned         | `critic:reject`                     | completion blocked     | Structured findings recorded; completion halted.                                                |
| completion blocked      | `plan:replan`                       | `ready` (revision $R$) | Revision $R \to R+1$; findings partitioned into disjoint repair scopes.                         |
| critic assigned         | `critic:review --decision approve`  | critic approved        | Every requirement proved; no requirement left `unproven`.                                       |
| critic approved         | `run:complete`                      | completed              | Zero blockers, no open branch, live repository binding matches every gate. Sealed.              |

---

## Host interruption monitor

The host may attach a recurring thread/task monitor for connection, service, or usage-limit
interruptions. The monitor reads the run capsule and Git state before acting, never trusts an
in-memory attempt, and uses exponential backoff near 30 seconds, 1 minute, 2 minutes, 4 minutes,
then 5 minutes capped. A retry is safe only when the operation is read-only, explicitly idempotent,
or durable evidence proves that the prior mutation did not commit. Otherwise it resumes from the
recorded event/packet/command state instead of replaying work. The monitor uses the host's native
wakeup mechanism only; provider APIs and LLM CLIs remain forbidden.

## Graph revision policy

A revision increments by exactly one and archives exact prior requirement/graph documents. Source
requirements are immutable. Once execution begins, structural task fields, dependencies, produced
artifacts, and write scopes freeze. Runtime fields — leases, attempts, findings, reports, validation,
commands, gates, and histories — survive a valid revision. Branches are execution-time records and
sit outside this policy entirely, which is why subdividing work never needs a revision.
