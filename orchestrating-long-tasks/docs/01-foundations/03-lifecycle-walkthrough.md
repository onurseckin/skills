# 03. The 9-Stage Lifecycle Walkthrough

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)

---

## 🧭 The End-to-End Orchestration Lifecycle

The `orchestrating-long-tasks` system guides a complex software engineering request through **9 deterministic lifecycle stages**. Each stage has strictly defined inputs, outputs, cryptographic proofs, and gate transitions.

```text
  1. CAPTURE           2. INSPECT          3. COMPILE           4. GRAPH
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Prompt.md   │ ──> │ Baseline    │ ──> │ 100% Line   │ ──> │ Dependency  │
│ (SHA-256)   │     │ Git & Files │     │ Disposition │     │ Task DAG    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
                                                                   ▼
  8. GATES & CRITIC    7. REPAIR           6. VALIDATE         5. DISPATCH
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Run Gates & │ <── │ Bounded Fix │ <── │ Adversarial │ <── │ Leased Role │
│ Critic Pass │     │ Loop (Max 5)│     │ Proof       │     │ Briefs      │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
  9. COMPLETE
┌─────────────┐
│ Mechanical  │
│ Terminal OK │
└─────────────┘
```

---

## 🔍 Detailed Breakdown of the 9 Stages

### Stage 1: Capture & Capsule Initialization

- **Action**: The user's exact, unedited prompt is piped to standard input and initialized via `plan:init`:
  ```bash
  printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <slug> --prompt-stdin
  ```
- **Artifacts Created**: `.capsules/<run-id>/prompt.md` (read-only mode `0444`), `manifest.json` (SHA-256 bound), `events.jsonl`, and `state.json`.
- **Assurance**: Marked as `source-verified` (if direct file/stdin) or `recorded-unverified` (if context transcribed).

### Stage 2: Baseline Repository Inspection

- **Action**: Before any planning or editing, the coordinator or planner inspects the host repository.
- **Artifacts Recorded**: Git HEAD commit, branch status, modified/untracked files, and key project configs (`tsconfig.json`, `package.json`).

### Stage 3: Modular Task Registration (`plan:add`)

- **Action**: The planner registers tasks with disjoint directory scopes and mandatory validation gates:
  ```bash
  bun harness.ts plan:add --run .capsules/<slug> --actor planner --id <task-id> --label "<label>" --scope <path> --gate "<gate-cmd>" [--deps <dep-id>]
  ```
- **Disjoint Scopes**: Guarantees that parallel lanes cannot collide on the filesystem.

### Stage 4: Graph Compilation & Line Coverage (`plan:compile`)

- **Action**: The planner compiles the dependency graph:
  ```bash
  bun harness.ts plan:compile --run .capsules/<slug> --actor planner
  ```
- **100% Line Coverage**: Performs line-by-line decomposition, ensuring every requirement is mapped and free of cycles.

### Stage 5: Conflict-Free Scheduling & Role Dispatch

- **Action**: The coordinator queries `queue:next` or `queue:list`, then leases work to Tier 3 subagents:
  ```bash
  bun harness.ts queue:pop --run .capsules/<slug> --agent <worker-id> --lease-seconds 1800
  # Or explicit claim:
  bun harness.ts task:claim --run .capsules/<slug> --task <task-id> --agent <worker-id>
  ```
- **Bearer Tokens**: `task:claim` returns a one-time bearer token (only its SHA-256 digest is stored in `state.json`) and emits a compact markdown brief ($\le 30$ lines).

### Stage 6: Implementation & Adversarial Validation

- **Action**: The implementer works strictly within its leased write scope, heartbeats active leases via `task:heartbeat`, and submits work:
  ```bash
  bun harness.ts task:submit --run .capsules/<slug> --task <task-id> --agent <worker-id> --token <token> --summary "<summary>"
  ```
- **Context Sanitization**: A fresh, independent validator is dispatched (`task:validate-start`). The validator receives allowlisted context stripped of subjective implementer prose.
- **Independent Proof**: The validator executes the mandatory gate command under monitoring:
  ```bash
  bun harness.ts run:exec --run .capsules/<slug> --task <task-id> --gate <gate-id> --actor <val-agent> -- <gate-argv...>
  ```
- **Review Verdict**: The validator records approval or rejection:
  ```bash
  bun harness.ts task:review --run .capsules/<slug> --task <task-id> --validator <val-agent> --token <token> --status pass --summary "<summary>"
  ```

### Stage 7: Bounded Repair Loop

- **Action**: If rejected, the validator executes `task:reject` with structured findings and remediation hints:
  ```bash
  bun harness.ts task:reject --run .capsules/<slug> --task <task-id> --validator <val-agent> --token <token> --reason "<reason>" --finding "<remediation>"
  ```
- **Routing**: The task transitions to `changes_requested` and routes back to the implementer.
- **Escalation**: Configurable via `harness.config.json` (default 5 rounds). If a task fails 5 consecutive rounds, it escalates to prevent runaway agent loops.

### Stage 8: Mandatory Task Gates, Run Gates & Completeness Critic

- **Action**: Once validation passes, mandatory task gates and global run gates are executed through `run:exec`:
  ```bash
  bun harness.ts run:exec --run .capsules/<slug> --gate gate-run-completion --actor coordinator -- bun test tests/unit
  ```
- **Trusted Host Observation**: Each gate verifies pre-command and post-command repository state under `trusted_host_observed_v1`.
- **Completeness Critic**: A fresh critic verifies requirements and diffs:
  ```bash
  bun harness.ts critic:start --run .capsules/<slug> --critic critic-lead
  bun harness.ts critic:review --run .capsules/<slug> --critic critic-lead --token <token> --decision approve --summary "<summary>"
  ```

### Stage 9: Mechanical Terminal Completion

- **Action**: The coordinator seals the run:
  ```bash
  bun harness.ts run:complete --run .capsules/<slug> --actor coordinator
  bun harness.ts run:status --run .capsules/<slug>
  ```
- **Zero-Blocker Invariant**: Completion passes if and only if:
  1. Zero integrity or traceability issues exist.
  2. All prompt lines are disposed and all requirements satisfied with command proof.
  3. All tasks are `done` with zero active leases and zero open findings.
  4. All mandatory gates succeeded with matching live repository bindings.
  5. The completeness critic issued a clean approval.

---

## 🔄 The Formal Task State Machine

Every individual task inside the dependency graph moves through a strict, deterministic state machine:

```text
                     ┌───────────┐
                     │ proposed  │
                     └─────┬─────┘
                           │ (All dependencies become 'done')
                           ▼
                     ┌───────────┐
       ┌────────────>│   ready   │
       │             └─────┬─────┘
       │ (Lease expiry)    │ (queue:pop / task:claim + bearer token issued)
       │                   ▼
       │             ┌───────────┐
       ├─────────────┤  leased   │
       │             └─────┬─────┘
       │                   │ (task:heartbeat / active progress)
       │                   ▼
       │             ┌───────────┐
       ├─────────────┤  running  │
       │             └─────┬─────┘
       │                   │ (task:submit + report validation)
       │                   ▼
       │             ┌───────────┐
       │             │ submitted │
       │             └─────┬─────┘
       │                   │ (task:validate-start command)
       │                   ▼
       │             ┌────────────┐
       │             │ validating │
       │             └─────┬──────┘
       │                   │
       │         ┌─────────┴─────────┐
       │         │ (task:review)     │ (task:reject)
       │         ▼                   ▼
       │   ┌───────────┐       ┌───────────────────┐
       │   │ validated │       │ changes_requested │
       │   └─────┬─────┘       └─────────┬─────────┘
       │         │                       │
       │         │ (run:exec task gates) ├─> (task:claim repair) ──> [ repair ]
       │         ▼                       │                              │
       │   ┌───────────┐                 │                              ▼
       │   │  gating   │                 │                        (task:submit)
       │   └─────┬─────┘                 │
       │         │ (All gates pass)      ▼ (After 5 rejected rounds)
       │         ▼                 ┌───────────┐
       │   ┌───────────┐           │ escalated │
       │   │   done    │           └───────────┘
       │   └───────────┘
       │
       └─> [ Stale Recovery Engine ] ──> retry_ready
```

---

## 📊 Summary of Task States

| State                   | Meaning                                                                 | Permitted Next Actions                                            |
| :---------------------- | :---------------------------------------------------------------------- | :---------------------------------------------------------------- |
| **`proposed`**          | Initial state in plan; waiting for prerequisite dependencies to finish. | Automatically transitions to `ready` when dependencies complete.  |
| **`ready`**             | Unblocked and eligible for scheduler batching.                          | Coordinator executes `queue:pop` or `task:claim`.                 |
| **`leased`**            | Claimed by an agent; one-time bearer token issued; timer running.       | Agent calls `task:heartbeat` or begins execution.                 |
| **`running`**           | Active work in progress with verified heartbeats.                       | Implementer executes `task:submit`.                               |
| **`submitted`**         | Implementer submitted structured report; write lease closed.            | Coordinator calls `task:validate-start`.                          |
| **`validating`**        | Independent validator holds exclusive inspection lease.                 | Validator executes `run:exec` and `task:review` / `task:reject`.  |
| **`validated`**         | Independent validator passed the work with command evidence.            | Coordinator triggers mandatory task gates (`run:exec`).           |
| **`gating`**            | Task gates are running under watchdog observation.                      | On gate pass, transitions to `done`.                              |
| **`changes_requested`** | Validator rejected with structured findings (`F-xxx`).                  | Implementer repairs and re-submits (`task:claim`, `task:submit`). |
| **`done`**              | Terminal success for this task. Unblocks dependent tasks.               | None (Immutable).                                                 |
| **`escalated`**         | Hit max repair limit (default 5 rounds) or hit unresolvable blocker.    | Human operator intervention or plan revision.                     |
| **`cancelled`**         | Associated requirements were declined via user authority.               | None (Cleanly disposed).                                          |

---

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)
