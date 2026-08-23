# 02. Completeness Critic Verification Protocol

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                                                                  |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand the macro-level role of the Completeness Critic, whole-run verification against `prompt.md`, requirement satisfaction mechanics, and the Plan-Validator pre-flight adversary. |
| **How-To Guide** | Initializing critic review, executing task-unbound critic commands, compiling requirement proofs, issuing approval/rejection verdicts, and remediating critic findings.                  |
| **Reference**    | Critic JSON schemas, proof schemas, command syntax, independence constraints, and error codes.                                                                                           |
| **Tutorial**     | Complete walkthrough of auditing a finished capsule against prompt requirements and recording an authoritative approval.                                                                 |

---

## 🎯 1. Explanation: Why Whole-Run Verification Is Necessary

Task validators verify localized scopes. However, an entire run can pass every individual task validation while still failing the user's overarching request:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE MACRO-LEVEL COMPLETION GAP                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Task 1: Auth Token Generation  ──► ✅ Validated by val-1                   │
│  Task 2: User Database Schema   ──► ✅ Validated by val-2                   │
│  Task 3: REST API Handler       ──► ✅ Validated by val-3                   │
│                                                                             │
│  CRITICAL RUNTIME FAILURES SURVIVING TASK VALIDATION:                       │
│  ❌ Prompt requirement #4 ("Generate Swagger OpenAPI spec") was never mapped│
│     to any task and was completely forgotten.                               │
│  ❌ Integration regression: Auth middleware crashes when receiving schema   │
│     responses from Task 2 due to type mismatch across module boundaries.    │
│  ❌ Declared CLI documentation artifact is an empty 0-byte stub.            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The **Completeness Critic** is an independent, whole-run verification authority executed after all graph tasks are `validated` and before the capsule can be sealed.

---

## 🔐 2. Explanation: The Critic Verification Protocol

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      COMPLETENESS CRITIC LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. `critic:start --critic <id>`                                            │
│     ├── Verifies strict independence invariant (0 prior roles in run)       │
│     ├── Captures repository readiness snapshot & baseline integrity         │
│     └── Mints single-use critic bearer token (digest stored in state)       │
│                                   │                                         │
│                                   ▼                                         │
│  2. Critic Executes Unbound Commands: `run:exec --actor <critic>`           │
│     ├── Executes whole-suite run completion gate (`gate-run-completion`)    │
│     ├── Runs cross-cutting integration checks & end-to-end tests            │
│     └── Validates that commands are NOT bound to individual tasks           │
│                                   │                                         │
│                                   ▼                                         │
│  3. Critic Verifies Every Prompt Requirement                                │
│     ├── Audits `prompt.md` line-by-line against `planning/requirements.json`│
│     └── Maps each requirement to a successful critic command receipt        │
│                                   │                                         │
│                                   ▼                                         │
│  4. Verdict Submission                                                      │
│     ├── `critic:review --decision approve` (Requires 100% Proven Reqs)      │
│     └── `critic:reject --findings [...]`  (Triggers replan & repair wave)   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### The Strict Independence Invariant

The completeness critic must have **zero prior participation** in the current run. An agent that acted as planner, coordinator, implementer, repairer, or validator is strictly disqualified:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "completeness critic must be independent from implementers, repairers, planners, and validators"
  }
}
```

---

## 🧪 3. Explanation: Task-Unbound Critic Command Execution

A completeness critic cannot rely on command receipts generated by implementers or validators. The critic must **re-run all verification commands independently** under its own actor identity.

Furthermore, critic verification commands must be **unbound to any specific task**:

```bash
# ✅ VALID: Critic runs completion gate unbound to tasks
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --actor critic-1 \
  --gate gate-run-completion \
  -- bun test tests/

# ❌ INVALID: Critic attempts to cite a task-bound command (Refused)
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --actor critic-1 \
  --task task-slug \
  -- bun test tests/slug.test.ts
```

If a critic attempts to submit a review without fresh, unbound command receipts, the harness aborts:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "critic checks must be nonempty and unbound to specific tasks"
  }
}
```

---

## 📝 4. Reference: Requirement Proof Schema

To approve completion, the critic must submit a verified proof for **every requirement** registered in `state.requirements`:

```json
[
  {
    "requirement_id": "req-auth-jwt",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "C-948205",
        "observation": "Critic executed bun test tests/auth/jwt.test.ts; exited 0 with 14 assertions passed."
      }
    ]
  },
  {
    "requirement_id": "req-swagger-docs",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "C-948206",
        "observation": "Critic executed bun run validate:swagger; confirmed valid OpenAPI 3.1 schema generated."
      }
    ]
  }
]
```

### Requirement Status Values:

- **`satisfied`**: Verified and proven by a successful critic command receipt.
- **`out_of_scope`**: Disposed as non-binding context with explicit rationale.
- **`unproven`**: System state for any requirement lacking verified proof. **Blocks completion unconditionally.**

---

## 🪞 5. Explanation: The Mirror-Image Adversary (Plan-Validator)

While the Completeness Critic audits the _finished output_ at the end of the run, the **Plan-Validator** serves as the mirror-image adversary at the _beginning_ of the run.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PLAN-VALIDATOR VS CRITIC ROLES                        │
├────────────────────────────┬────────────────────────────────────────────────┤
│ Feature                    │ Plan-Validator (Pre-Flight)                    │ Completeness Critic (Post-Flight)│
├────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────┤
│ Timing                     │ Before any implementer is dispatched           │ After all tasks are validated    │
│ Target Artifact            │ Compiled graph DAG & requirements              │ Final working tree & diff        │
│ Focus                      │ Decomposition, false barriers, stragglers      │ Prompt completeness & gates      │
│ Blocking Power             │ `changes_requested` blocks all `task:claim`    │ Rejection blocks `run:complete`  │
│ Primary Artifact Inspected │ `planning/graph.json` & `requirements.json`    │ Whole repository diff & prompt.md│
└────────────────────────────┴────────────────────────────────────────────────┴──────────────────────────────────┘
```

### The 4 Mandatory Plan-Review Questions

`plan:review` requires explicit structured answers to four architectural questions on every review:

1. **Decomposition**: Does the graph granularity match the entities in the prompt?
2. **Dependencies**: Is every graph edge justified by a real data/type dependency? (No false barriers).
3. **Gate Discrimination**: Can each task gate fail if its task's work is absent?
4. **Straggler Risk**: Is any task's scope disproportionately large relative to its wave?

If a plan-validator rejects a graph revision (`status: "changes_requested"`), all implementer claims are **hard-locked** until a new graph revision is compiled and approved.

---

## 📖 6. How-To Guide: Operating the Critic

### Step 1: Start Critic Review

```bash
bun harness.ts critic:start \
  --run .capsules/<run-id> \
  --critic critic-1
```

Output:

```text
### Completeness Critic Leased: critic-1
- **Run**: `.capsules/run-402`
- **Critic Token**: `CRITIC_TOK_88194` (digest recorded)
- **Action Required**: Execute whole-suite gates and compile requirement proofs.
```

### Step 2: Critic Executes Verification Commands

```bash
# Run completion gate
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --actor critic-1 \
  --gate gate-run-completion \
  -- bun test

# Run specific integration check
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --actor critic-1 \
  -- bun run build
```

### Step 3A: Issue Approval Verdict

```bash
bun harness.ts critic:review \
  --run .capsules/<run-id> \
  --critic critic-1 \
  --token CRITIC_TOK_88194 \
  --decision approve \
  --proofs-file proofs.json \
  --summary "All prompt requirements implemented and verified against full integration test suite."
```

### Step 3B: Issue Rejection Verdict

```bash
bun harness.ts critic:reject \
  --run .capsules/<run-id> \
  --critic critic-1 \
  --token CRITIC_TOK_88194 \
  --summary "Missing OpenAPI schema generation" \
  --findings '[{"id":"CF-01","requirement_id":"req-swagger","severity":"critical","observation":"openapi.json is missing from build output","remediation":"Add swagger generation script to build pipeline","revalidation":"bun run validate:swagger"}]'
```

### Step 4: Remediating Critic Rejections

When defects are fixed, the coordinator registers the remediation receipts:

```bash
bun harness.ts critic:remediate \
  --run .capsules/<run-id> \
  --actor coordinator \
  --resolve CF-01=C-948210 \
  --resolution-method CF-01="Generated OpenAPI spec via build script"
```

---

## 💻 7. Tutorial: Whole-Run Audit Walkthrough

### 1. Critic Starts Review

```bash
bun harness.ts critic:start --run .capsules/run-99 --critic critic-audit-1
```

Mints token `CRIT_9901`.

### 2. Critic Checks Whole-Repository Diff

Critic inspects `git diff HEAD~3` and compares against `prompt.md`. Critic finds:

- Prompt item: "Add rate limiting middleware with Redis storage."
- Implementation: Rate limiter implemented with in-memory map; Redis adapter omitted.

### 3. Critic Executes Gate and Discovers Failure

```bash
bun harness.ts run:exec --run .capsules/run-99 --actor critic-audit-1 -- \
  bun test tests/integration/rate-limit.test.ts
```

Receipt `C-110022` recorded with exit code `1`.

### 4. Critic Emits Structured Rejection

```bash
bun harness.ts critic:reject \
  --run .capsules/run-99 \
  --critic critic-audit-1 \
  --token CRIT_9901 \
  --summary "Rate limiter lacks Redis backend required by prompt." \
  --findings '[{
    "id": "CF-RATE-01",
    "requirement_id": "req-rate-limit-redis",
    "severity": "critical",
    "observation": "RateLimiter class uses Map<string, number> instead of ioredis client.",
    "remediation": "Inject RedisStore into RateLimiter and connect to REDIS_URL.",
    "revalidation": "bun test tests/integration/rate-limit.test.ts"
  }]'
```

### 5. Repair Wave & Final Remediation

1. Coordinator dispatches repair task via `plan:replan`.
2. Repairer implements Redis store and tests pass.
3. Coordinator calls `critic:remediate --resolve CF-RATE-01=C-110045`.
4. Fresh critic `critic-audit-2` is started, verifies all requirements, and signs off `approve`.

---

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)
