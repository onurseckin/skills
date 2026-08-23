# 03. The Lifecycle Walkthrough

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)

---

## 🧭 The End-to-End Orchestration Lifecycle

An engineering objective within the OLT framework transitions through an authoritative, multi-tier execution lifecycle. Every phase has cryptographically sealed inputs, deterministic state machine transitions, and mechanical verification gates that refuse to proceed without host-observed evidence.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           THE COMPLETE OLT EXECUTION PIPELINE                           │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ TIER 0: MIND ADMISSION & DISPATCH ]                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. INGEST FEEDBACK      2. ADMIT CANDIDATE        3. ATOMIC DISPATCH              │  │
│  │    (mind:queue:add)        (mind:queue:drain)        (TASK_QUEUE.jsonl)           │  │
│  └──────────────────────────────────────┬────────────────────────────────────────────┘  │
│                                         │                                               │
│                                         ▼                                               │
│  [ TIER 1: ORCHESTRATOR PLANNING & AUDIT ]                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │ 4. CAPTURE PROMPT       5. ENHANCE PLAN           6. DECLARE & COMPILE DAG        │  │
│  │    (plan:init 0444)        (plan:enhance)            (plan:add / plan:compile)   │  │
│  └──────────────────────────────────────┬────────────────────────────────────────────┘  │
│                                         │                                               │
│                                         ▼                                               │
│  [ TIER 2: COORDINATOR WAVE SCHEDULING ]                                                │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │ 7. BRENT WORK/SPAN      8. 1-SHOT EXACT BRIEF     9. LEASE ACQUISITION            │  │
│  │    (queue:wave P=W/S)      (task:brief Turn 1)       (task:claim bearer token)    │  │
│  └──────────────────────────────────────┬────────────────────────────────────────────┘  │
│                                         │                                               │
│                                         ▼                                               │
│  [ TIER 3: IMPLEMENTATION & 1-HOP MICRO-CYCLES ]                                        │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │ 10. DISJOINT WRITE     11. FAST CHECK (AST/TYPE) 12. 1-HOP MICRO-CYCLE CRITIQUE   │  │
│  │    (task.write_scope)      (task:check 0 any)        (task:reject --in-lease)     │  │
│  └──────────────────────────────────────┬────────────────────────────────────────────┘  │
│                                         │                                               │
│                                         ▼                                               │
│  [ TIER 3: COGNITIVE VALIDATION & ADVERSARIAL PROBES ]                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │ 13. HARD-LOCK REVIEW   14. ADVERSARIAL PROBE     15. VERIFIED PASS SIGN-OFF       │  │
│  │    (0 commands run)        (task:probe min >= 1)     (task:review --resolve all)  │  │
│  └──────────────────────────────────────┬────────────────────────────────────────────┘  │
│                                         │                                               │
│                                         ▼                                               │
│  [ RUN-LEVEL GATES, CRITIC & METRIC SEALING ]                                           │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │ 16. COMPLETENESS CRITIC 17. MECHANICAL TERMINAL  18. META-AUDITOR FORENSICS       │  │
│  │    (critic:start / review) (run:complete)            (meta-audit --inject)        │  │
│  └───────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 Phase-by-Phase Execution Walkthrough

---

### Phase 1: Tier 0 Mind Admission & Atomic Dispatch Chaining

Tier 0 Mind operates as an **Infinite Product Owner** managing repository backlogs across two operational modes:

- **Mode A (Autonomous Self-Evolution)**: Triggers continuous codebase optimization, charter gap audits, and blunder regression tests when the queue is empty.
- **Mode B (External Intake)**: Ingests user directives, architectural features, and external bug reports into `.capsules/mind/queue/feedback-queue.jsonl`.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                      TIER 0 MIND ADMISSION & ATOMIC DISPATCH                            │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ Ingest Directive ] ──► [ feedback-queue.jsonl ] ──► [ Atomic Admission & Dispatch ]  │
│    (mind:queue:add)             (Status: PENDING)             (Status: ADMITTED)        │
│                                                                        │                │
│                                                                        ▼                │
│                                                               [ TASK_QUEUE.jsonl ]      │
│                                                              (0 Paused Admitted Items)  │
│                                                                        │                │
│                                                                        ▼                │
│                                                              [ Spawn Tier 1 Orchestrator]│
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Key Step Machine Commands:

```bash
# 1. Ingest directive into Mind queue
bun harness.ts mind:queue:add \
  --title "Implement OAuth2 PKCE Support" \
  --content "Add secure OAuth2 PKCE auth flow to src/auth/ with file-scoped unit tests" \
  --priority HIGH_ARCHITECTURAL_FEATURE \
  --category SECURITY

# 2. Inspect pending backlog
bun harness.ts mind:queue:list --status PENDING

# 3. Drain and admit candidate atomically into execution
bun harness.ts mind:queue:drain --limit 1 --mark-as ADMITTED
```

> [!IMPORTANT]
> **Atomic Admission-to-Dispatch Invariant**: Mind never leaves admitted items in a paused or orphaned state (`reconcilePausedAdmittedFeedbacks`). Admitted items are atomically converted and dispatched directly to the active task queue.

---

### Phase 2: Tier 1 Orchestrator Multi-Round Planning & Plan Audit

The Tier 1 Orchestrator receives the admitted objective, initializes the isolated run capsule, enhances plan context by inspecting the repository, and compiles the topological graph.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     TIER 1 ORCHESTRATOR PLANNING & STRUCTURAL AUDIT                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  1. CAPTURE PROMPT (plan:init) ──► prompt.md (mode 0444) + manifest.json (SHA-256)     │
│             │                                                                           │
│             ▼                                                                           │
│  2. ENHANCE CONTEXT (plan:enhance) ──► planning/enhanced-plan.md (agent_reported)       │
│             │                                                                           │
│             ▼                                                                           │
│  3. DECLARE TASKS (plan:add) ──► 100% Prompt Line Coverage + Explicit --dep-reason      │
│             │                                                                           │
│             ▼                                                                           │
│  4. STRUCTURAL AUDIT & COMPILE (plan:compile) ──► Enforces Invariants C1 - C6           │
│             │                                                                           │
│             ▼ (Optional Stage 4½)                                                       │
│  5. ADVERSARIAL PLAN REVIEW (plan:validate-start / plan:review) ──► Plan Approved      │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 1. Capture Prompt (`plan:init`)

```bash
printf "%s" "$USER_PROMPT" | bun harness.ts plan:init \
  --repo . \
  --run oauth-pkce-v1 \
  --prompt-stdin
```

Creates `.capsules/oauth-pkce-v1/` with `prompt.md` locked at mode `0444` and cryptographic hash recorded in `manifest.json`.

#### 2. Enhance Plan (`plan:enhance`)

```bash
bun harness.ts plan:enhance \
  --run .capsules/oauth-pkce-v1 \
  --actor planner \
  --summary "OAuth2 PKCE integration" \
  --observation "Existing auth handler in src/auth/session.ts uses legacy cookies" \
  --todo "Implement PKCE verifier generation and token exchange in src/auth/pkce.ts" \
  --risk "Token replay if verifier is logged in plaintext" \
  --source src/auth/session.ts
```

#### 3. Declare Tasks (`plan:add`)

```bash
bun harness.ts plan:add \
  --run .capsules/oauth-pkce-v1 \
  --actor planner \
  --id task-pkce-core \
  --label "Core PKCE Code Generator" \
  --scope "src/auth/pkce.ts" \
  --gate "bun test tests/auth/pkce.test.ts" \
  --requirement-lines "1-4"
```

#### 4. Compile Plan (`plan:compile`)

```bash
bun harness.ts plan:compile \
  --run .capsules/oauth-pkce-v1 \
  --actor planner \
  --completion-gate "bun test tests/auth/"
```

`plan:compile` automatically executes the **Six Plan Invariants (C1–C6)**:

- **C1**: Plan structural audit (blocks compressed decomposition or shared gates).
- **C2**: Plan validator gating.
- **C3**: Falsifiable gate checks.
- **C4**: Effort-evidence tracking.
- **C5**: Run ID pattern normalization.
- **C6**: Declared topology justification for every DAG edge.

---

### Phase 3: Tier 2 Coordinator Wave Scheduling & 1-Shot Exact Briefs

The Tier 2 Coordinator calculates optimal concurrency using **Brent's Theorem**:
$$P = \left\lceil \frac{W}{S} \right\rceil$$
Where Work $W = \sum \text{task effort}$ and Span $S = \text{critical path depth}$.

Tasks with strictly disjoint write scopes are grouped into parallel waves. The coordinator generates **1-Shot Exact-Anchor Briefings** (`task:brief`), driving implementers to **Turn 1 edits with zero exploratory reads**.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                      1-SHOT EXACT-ANCHOR DISPATCH WORKFLOW                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ queue:wave ] ──► Identifies parallel ready lanes with disjoint write scopes          │
│         │                                                                               │
│         ▼                                                                               │
│  [ task:brief ] ──► Assembles Exact Briefing:                                           │
│                       • Exact target files & explicit line coordinates (Start/EndLine)  │
│                       • Concrete TypeScript symbols & drop-in replacement chunks        │
│                       • File-scoped test command: bun test tests/auth/pkce.test.ts      │
│         │                                                                               │
│         ▼                                                                               │
│  [ task:claim ] ──► Issues one-time bearer token (qSGsImlAsT...) + leases write scope   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Dispatch Commands:

```bash
# 1. Inspect ready wave lanes
bun harness.ts queue:wave --run .capsules/oauth-pkce-v1

# 2. Register Implementer Agent
bun harness.ts agent:register \
  --run .capsules/oauth-pkce-v1 \
  --agent imp-1 \
  --role implementer \
  --host antigravity \
  --parent-agent coord-1 \
  --parent-task task-pkce-core

# 3. Assemble Exact-Anchor Briefing
bun harness.ts task:brief \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --agent imp-1 \
  --role implementer

# 4. Claim Task Lease
bun harness.ts task:claim \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --agent imp-1 \
  --role implementer
```

---

### Phase 4: Tier 3 Implementer Execution & 1-Hop In-Lease Micro-Cycles

The Implementer executes modifications strictly within `task.write_scope`.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                   IMPLEMENTER EXECUTION & FAST INCREMENTAL CHECK                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ Turn 1 Edit ] ──► Immediate code edit within leased write scope (0 exploration)      │
│         │                                                                               │
│         ▼                                                                               │
│  [ Unit Test ]   ──► File-scoped test execution: bun test tests/auth/pkce.test.ts       │
│         │                                                                               │
│         ▼                                                                               │
│  [ task:check ]  ──► Fast in-process incremental check (0 any, 0 suppressions, AST)     │
│         │                                                                               │
│         ▼                                                                               │
│  [ task:submit ] ──► Verifies SHA-256 write-scope change & closes lease                 │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Implementer Execution Commands:

```bash
# 1. Maintain active lease heartbeat during work
bun harness.ts task:heartbeat \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --agent imp-1 \
  --token <token>

# 2. Fast incremental verification (AST static invariants + TypeScript typecheck)
bun harness.ts task:check \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core

# 3. Submit completed implementation
bun harness.ts task:submit \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --agent imp-1 \
  --token <token> \
  --summary "Implemented PKCE verifier generation and SHA-256 challenge hashing" \
  --files-changed src/auth/pkce.ts
```

> [!TIP]
> **Effort-Evidence Submission Invariant (C4)**: If `src/auth/pkce.ts` is byte-identical before and after the lease, `task:submit` refuses the submission unless `--no-op --reason "<why>"` is explicitly declared and verified.

---

### Phase 5: Tier 3 Cognitive Validation & Adversarial Probes

Once submitted, the task is handed to an independent **Cognitive Validator**.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                  COGNITIVE VALIDATOR HARD-LOCK & 1-HOP MICRO-CYCLE                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ task:validate-start ] ──► Fresh independent validator assigned (stripped context)   │
│            │                                                                            │
│            ▼                                                                            │
│  [ Cognitive Hard-Lock ] ──► 0 commands allowed (0 run:exec, 0 tests, 0 shell tools)    │
│            │                 100% focused Socratic code review & checklist analysis     │
│            ▼                                                                            │
│  [ task:probe ]          ──► Demands adversarial proof (min_adversarial_probes >= 1)    │
│            │                                                                            │
│    ┌───────┴──────────────────────────────────────────┐                                 │
│    ▼ (Critique / Missing edge case)                   ▼ (All checks verified)           │
│  [ 1-Hop Micro-Cycle ]                           [ task:review --status pass ]          │
│  task:reject --in-lease                          Resolves all open probe demands        │
│  Implementer fixes in-lease & resubmits          Task transitions to validated          │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 1. Start Validation

```bash
bun harness.ts task:validate-start \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --validator val-1 \
  --validator-domain security
```

#### 2. Issue Mandatory Adversarial Probe (`task:probe`)

```bash
bun harness.ts task:probe \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --validator val-1 \
  --token <val-token> \
  --demand "Prove that code_challenge handles URL-safe base64 encoding without padding '=' characters"
```

#### 3. Execute 1-Hop In-Lease Micro-Cycle (If Remediation Needed)

```bash
bun harness.ts task:reject \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --validator val-1 \
  --token <val-token> \
  --micro-cycle \
  --reason "Base64 padding '=' was not stripped from code_challenge" \
  --remediation "Use .replace(/=+$/, '') on base64url encoded challenge string"
```

#### 4. Sign-Off Verified Pass

```bash
bun harness.ts task:review \
  --run .capsules/oauth-pkce-v1 \
  --task task-pkce-core \
  --validator val-1 \
  --token <val-token> \
  --status pass \
  --resolve probe-1=verified-in-code
```

---

### Phase 6: Completeness Critic Whole-Run Verification

Before any run can finish, the **Completeness Critic** performs whole-run adversarial verification directly against `prompt.md`.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    COMPLETENESS CRITIC WHOLE-RUN AUDIT                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ critic:start ]  ──► Assigns independent lead critic and mints completion bearer token│
│          │                                                                              │
│          ▼                                                                              │
│  [ Line-by-Line ]  ──► Verifies 100% prompt line dispositions against final repo diff   │
│          │                                                                              │
│          ▼                                                                              │
│  [ critic:review ] ──► Issues authoritative approval with structured proof artifacts    │
│                        (--decision approve --proofs-file proofs.json)                  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Critic Execution Commands:

```bash
# 1. Start critic assignment
bun harness.ts critic:start \
  --run .capsules/oauth-pkce-v1 \
  --critic critic-lead

# 2. Run whole-suite completion gate
bun harness.ts run:exec \
  --run .capsules/oauth-pkce-v1 \
  --gate gate-completion \
  --actor critic-lead \
  -- bun test tests/auth/

# 3. Submit critic approval
bun harness.ts critic:review \
  --run .capsules/oauth-pkce-v1 \
  --critic critic-lead \
  --token <critic-token> \
  --decision approve \
  --proofs-file proofs.json \
  --summary "All 4 prompt requirements verified against implementation and passing tests"
```

---

### Phase 7: Mechanical Completion Engine (`run:complete`)

The terminal completion command mechanically seals the run capsule:

```bash
# 1. Release all agent grants
bun harness.ts agent:release \
  --run .capsules/oauth-pkce-v1 \
  --agent imp-1 \
  --reason "Wave execution finished"

# 2. Execute mechanical completion gate
bun harness.ts run:complete \
  --run .capsules/oauth-pkce-v1 \
  --actor coordinator \
  --auth-token <critic-token>

# 3. Verify sealed status
bun harness.ts run:status --run .capsules/oauth-pkce-v1
```

#### Five Invariant Checks Enforced by `run:complete`:

1. **Cryptographic Integrity**: SHA-256 hash chain in `events.jsonl` has zero broken links or unquarantined torn tails.
2. **100% Requirement Coverage**: Every line in `prompt.md` is mapped to an atomic requirement verified with command receipts.
3. **Task Completion**: 100% of tasks in `state.tasks` are `done` with 0 open findings and 0 active leases.
4. **Gate Assurance**: All mandatory task gates and the whole-run completion gate exited with code `0`.
5. **Critic Approval**: Completeness critic issued `decision: "approve"`.

---

### Phase 8: Tier 2 Meta-Auditor Behavioral Forensics (`meta-audit`)

Following wave or run completion, the **Meta-Auditor** inspects the event trace across 7 behavioral heuristics and autonomously injects remediations:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    META-AUDITOR DEEP BEHAVIORAL FORENSICS                               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ meta-audit ] ──► Audits events.jsonl against 7 Behavioral Heuristics:                │
│                       1. TOKEN_BURNING           (>5 exploratory reads before write)    │
│                       2. FALSE_SERIALIZATION     (Sequential execution of disjoint tasks)│
│                       3. ROLE_BOUNDARY_DEVIATION (Supervisor writes, Validator runs cmd)│
│                       4. POLLING_WASTE           (Excessive status loops >= 4)          │
│                       5. CONTEXT_OVERFLOW        (>150k input tokens in single grant)   │
│                       6. GHOST_LEASE             (Active lease on released agent)       │
│                       7. STRAGGLER               (Task duration > 3x average)           │
│         │                                                                               │
│         ▼                                                                               │
│  [ Efficiency Score ] ──► Computes deterministic score (0.0% - 100.0%)                  │
│         │                                                                               │
│         ▼                                                                               │
│  [ Closed-Loop Injection ] ──► meta-audit --inject                                      │
│                                Synthesizes remediation into .capsules/FEEDBACK_QUEUE.json│
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Forensics Commands:

```bash
# 1. Run behavioral audit and compute score
bun harness.ts meta-audit --run .capsules/oauth-pkce-v1 --format markdown

# 2. Autonomously inject detected remediations into the feedback queue
bun harness.ts meta-audit --run .capsules/oauth-pkce-v1 --inject
```

---

## 🔄 The Formal Task State Machine

```text
                     ┌───────────┐
                     │ proposed  │
                     └─────┬─────┘
                           │ (all dependencies are 'done')
                           ▼
                     ┌───────────┐
        ┌───────────►│   ready   │◄──────────── retry_ready ◄── recover / task:release
        │            └─────┬─────┘
        │ (lease expiry)   │ (queue:pop / task:claim --role + bearer token)
        │                  ▼
        │            ┌───────────┐
        ├────────────┤  leased   │
        │            └─────┬─────┘
        │                  │ (work begins; task:heartbeat)
        │                  ▼
        │            ┌───────────┐   branch:open   ┌───────────┐
        ├────────────┤  running  ├────────────────►│ branched  │
        │            └─────┬─────┘◄────────────────┤ (lease    │
        │                  │      branch:collect / │  frozen)  │
        │                  │      branch:abandon   └───────────┘
        │                  │ (task:submit --summary)
        │                  ▼
        │            ┌───────────┐
        │            │ submitted │
        │            └─────┬─────┘
        │                  │ (task:validate-start, fresh validator)
        │                  ▼
        │            ┌───────────┐  task:probe   ┐
        │            │validating │◄──────────────┘ stays validating,
        │            └─────┬─────┘                 probe_round +1
        │                  │
        │        ┌─────────┴─────────┐
        │        │ (task:review pass │ (task:reject --in-lease / formal)
        │        │  + --resolve all) │
        │        ▼                   ▼
        │  ┌───────────┐       ┌───────────────────┐
        │  │ validated │       │ changes_requested │
        │  └─────┬─────┘       └─────────┬─────────┘
        │        │ (run:exec task gates) │ (in-lease micro-cycle OR repair claim)
        │        ▼                       │
        │  ┌───────────┐                 │ after max_repair_rounds (6)
        │  │  gating   │                 ▼
        │  └─────┬─────┘           ┌───────────┐
        │        │ (all gates pass)│ escalated │
        │        ▼                 └───────────┘
        │  ┌───────────┐
        │  │   done    │
        │  └───────────┘
        │
        └─► [ recover ] ──► retry_ready
```

---

## 📊 Summary of Task States & Allowed Actions

| State                   | Semantic Meaning                                       | Permitted Next Actions                                          |
| :---------------------- | :----------------------------------------------------- | :-------------------------------------------------------------- |
| **`proposed`**          | Declared in DAG; waiting on upstream prerequisites.    | Transitions to `ready` when all dependencies reach `done`.      |
| **`ready`**             | Unblocked and eligible for wave allocation.            | `queue:wave`, `task:claim`, `queue:pop`.                        |
| **`retry_ready`**       | Reclaimed after lease timeout; immediately claimable.  | `task:claim`.                                                   |
| **`leased`**            | Claimed by implementer; one-time bearer token active.  | `task:heartbeat`, `task:check`, `task:submit`.                  |
| **`running`**           | Active implementation underway.                        | `task:submit`, `branch:open`, `task:release`.                   |
| **`branched`**          | Subdivided dynamically; **lease clock frozen**.        | `branch:collect`, `branch:abandon`.                             |
| **`submitted`**         | Code written; write scope hashed and verified.         | `task:validate-start` (assigns fresh validator).                |
| **`validating`**        | Independent cognitive validator inspecting diffs.      | `task:probe`, `task:reject` (micro-cycle), `task:review`.       |
| **`validated`**         | Cognitive sign-off complete; all probes resolved.      | `run:exec` on task gates.                                       |
| **`gating`**            | Deterministic task gates executing under watchdog.     | Transitions to `done` when all gates exit `0`.                  |
| **`changes_requested`** | Defect identified; awaiting in-lease or formal repair. | In-lease micro-cycle remediation, `task:claim --role repairer`. |
| **`done`**              | **Terminal Success**: Dependencies satisfied.          | None (unblocks downstream dependent tasks).                     |
| **`escalated`**         | Max repair rounds exceeded (6 rounds).                 | Requires human intervention or plan revision.                   |
| **`stale`**             | Lease expired without heartbeat.                       | `recover` transitions to `retry_ready`.                         |

---

[⬅ Previous: Capsule & Storage Model](./02-capsule-and-storage-model.md) | [Master Table of Contents](../README.md) | [Next: Chapter 02 — Prompt Capture & Integrity ➡](../02-requirements/01-prompt-capture-and-integrity.md)
