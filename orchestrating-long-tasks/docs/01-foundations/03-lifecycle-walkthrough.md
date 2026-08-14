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
│ Run Gates & │ <── │ Bounded     │ <── │ Adversarial │ <── │ Leased Role │
│ Critic Pass │     │ Fix Loop    │     │ Proof       │     │ Packets     │
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
- **Action**: The user's exact, unedited prompt is saved to a file and initialized via `harness.ts init`.
- **Artifacts Created**: `.harness/<run-id>/prompt.md` (read-only mode `0444`), `manifest.json` (SHA-256 bound), `events.jsonl`, `state.json`, and `.harness/<run-id>/runtime/` (the pinned zero-dependency Bun runtime).
- **Assurance**: Marked as `source-verified` (if direct file/stdin) or `recorded-unverified` (if context transcribed).

### Stage 2: Baseline Repository Inspection
- **Action**: Before any planning or editing, the harness inspects the host repository.
- **Artifacts Recorded**: Git HEAD commit, branch status, modified/untracked files, lockfiles, convention configs (`tsconfig.json`, `package.json`), and content hashes.
- **Planner Registration**: Publishes the immutable `planner-0` packet.

### Stage 3: Prompt Compilation (Requirements Decomposition)
- **Action**: The planner agent parses the prompt and generates `planning/requirements.json`.
- **100% Line Coverage**: Every single non-blank prompt line is assigned a mathematical disposition (`requirement` with `requirement_id` or `requirement_ids`).
- **Atomic Obligations**: Compound sentences are split into atomic, independently testable requirements.

### Stage 4: Relational Graph Construction
- **Action**: The planner designs `planning/graph.json`.
- **Topology**: Defines task nodes with normalized, disjoint write scopes, requirement mappings, artifact outputs, priority weights, and verification gate contracts.
- **Validation & Apply**: The plan is checked via `validate` and applied atomically via `plan-apply --expected-revision 0`.

### Stage 5: Conflict-Free Scheduling & Role Dispatch
- **Action**: The coordinator queries `ready` and executes `schedule --max-parallel <N>`.
- **Conflict-Free Batches**: The scheduler picks tasks whose prerequisites are `done` and ensures no two concurrently running tasks have overlapping directory write scopes.
- **Bearer Tokens**: `claim` returns a one-time bearer token (only its SHA-256 digest is stored) and publishes an immutable role packet (`task-X-implementer.md`).

### Stage 6: Implementation & Adversarial Validation
- **Action**: The implementer works strictly within its leased write scope, runs focused tests, and submits a structured report via `submit`.
- **Context Sanitization**: A fresh, independent validator is leased (`begin-validation`). The validator receives **allowlisted context only**—all implementer prose, confidence, and subjective claims are stripped.
- **Independent Proof**: The validator runs fresh commands on actual disk state and issues either a `pass` or `reject` review.

### Stage 7: Bounded Repair Loop
- **Action**: If rejected, the validator outputs structured findings (`F-xxx`) with mandatory observations, evidence, remediations, and revalidation commands.
- **Routing**: The task enters `changes_requested` and routes back to the original implementer under a repair lease (`assign-repairer`).
- **Escalation**: If a task fails 3 consecutive validation rounds, it escalates to prevent infinite token-wasting loops.

### Stage 8: Mandatory Task Gates, Run Gates & Completeness Critic
- **Action**: Once validation passes, mandatory task gates and global run gates are executed through the watchdog runner (`run` command).
- **Trusted Host Observation**: Each gate verifies pre-command and post-command repository state (`trusted_host_observed_v1`).
- **Completeness Critic**: A fresh critic reviews the whole run against the original prompt, dispositions, diffs, and gate records.

### Stage 9: Mechanical Terminal Completion
- **Action**: The coordinator runs `complete`.
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
       │ (Lease expiry)    │ (claim command + bearer token issued)
       │                   ▼
       │             ┌───────────┐
       ├─────────────┤  leased   │
       │             └─────┬─────┘
       │                   │ (Heartbeat / active progress)
       │                   ▼
       │             ┌───────────┐
       ├─────────────┤  running  │
       │             └─────┬─────┘
       │                   │ (submit command + report validation)
       │                   ▼
       │             ┌───────────┐
       │             │ submitted │
       │             └─────┬─────┘
       │                   │ (begin-validation command)
       │                   ▼
       │             ┌────────────┐
       │             │ validating │
       │             └─────┬──────┘
       │                   │
       │         ┌─────────┴─────────┐
       │         │ (review verdict)  │
       │         ▼                   ▼
       │   ┌───────────┐       ┌───────────────────┐
       │   │ validated │       │ changes_requested │
       │   └─────┬─────┘       └─────────┬─────────┘
       │         │                       │
       │         │ (Run task gates)      ├─> (assign-repairer lease) ──> [ repair ]
       │         ▼                       │                                   │
       │   ┌───────────┐                 │                                   ▼
       │   │  gating   │                 │                             (re-submit)
       │   └─────┬─────┘                 │
       │         │ (All gates pass)      ▼ (After 3 rejected rounds)
       │         ▼                 ┌───────────┐
       │   ┌───────────┐           │ escalated │
       │   │   done    │           └───────────┘
       │   └───────────┘
       │
       └─> [ Stale Recovery Engine ] ──> retry_ready
```

---

## 📊 Summary of Task States

| State | Meaning | Permitted Next Actions |
| :--- | :--- | :--- |
| **`proposed`** | Initial state in plan; waiting for prerequisite dependencies to finish. | Automatically transitions to `ready` when dependencies complete. |
| **`ready`** | Unblocked and eligible for scheduler batching. | Coordinator executes `claim`. |
| **`leased`** | Claimed by an agent; one-time bearer token issued; timer running. | Agent calls `heartbeat` or begins execution. |
| **`running`** | Active work in progress with verified heartbeats. | Implementer executes `submit`. |
| **`submitted`** | Implementer submitted structured report; write lease closed. | Coordinator calls `begin-validation`. |
| **`validating`** | Independent validator holds exclusive inspection lease. | Validator executes `review` (`pass` or `reject`). |
| **`validated`** | Independent validator passed the work with command evidence. | Coordinator triggers mandatory task gates. |
| **`gating`** | Task gates are running under watchdog observation. | On gate pass, transitions to `done`. |
| **`changes_requested`**| Validator rejected with structured findings (`F-xxx`). | Coordinator routes to repairer via `assign-repairer`. |
| **`done`** | Terminal success for this task. Unblocks dependent tasks. | None (Immutable). |
| **`escalated`** | Failed 3 validation rounds or hit unresolvable blocker. | Human operator intervention or plan revision. |
| **`cancelled`** | Associated requirements were declined via user authority. | None (Cleanly disposed). |

---

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)
