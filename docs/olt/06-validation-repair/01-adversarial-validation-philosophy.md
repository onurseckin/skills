# 01. Adversarial Validation: The Probe / Defect Split & Dual-Channel Protocol

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                             |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand why LLM self-grading fails, the mechanics of cognitive validator hard-locks, context sanitization, and the Dual-Channel Review Protocol. |
| **How-To Guide** | Step-by-step procedures for leasing validation, executing mandatory gate runs, recording probes, performing static AST checks, and rejecting tasks. |
| **Reference**    | CLI commands, flag specifications, validator domain classifications, and validation error contracts.                                                |
| **Tutorial**     | End-to-end walkthrough of validating a multi-domain task with adversarial probes and incremental checks.                                            |

---

## 🧱 1. Explanation: The Fatal Flaw of Self-Grading

In conventional multi-agent systems, agents that implement a feature are frequently prompted to "verify" their own work. In practice, this produces catastrophic failure rates on long-horizon tasks due to three systemic cognitive vulnerabilities:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       THE COGNITIVE SELF-GRADING TRAP                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Sycophantic Confirmation Bias                                           │
│     The model assumes its own prior reasoning was sound and interprets      │
│     ambiguous error output or partial mock data as "expected behavior".     │
│                                                                             │
│  2. Blind-Spot Inheritance                                                  │
│     The edge cases and invariants overlooked during implementation are the   │
│     exact same edge cases omitted from self-authored verification tests.     │
│                                                                             │
│  3. Optimistic Ambiguity Collapse                                           │
│     When test output is noisy or unassertive, the implementer assumes the   │
│     absence of explicit failure equals verifiable correctness.              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

To eliminate these vulnerabilities, the `olt` harness enforces a foundational rule:

> **An implementer is NEVER permitted to validate its own task.**

When `task:validate-start` is invoked, the harness verifies three strict independence invariants before issuing a validation lease token:

1. **Implementer Separation**: The candidate validator cannot be the task's `original_implementer`.
2. **Attempt Disqualification**: The candidate validator cannot appear in any prior implementation or repair attempt for this task.
3. **Freshness Invariant**: The candidate validator cannot have validated this task in any previous round. A repair round demands a _fresh_ validator to eliminate confirmation anchoring from previous reviews.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VALIDATOR INDEPENDENCE VERIFICATION                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Agent Assignment Request (agent_id: "val-1")                               │
│       │                                                                     │
│       ├── 1. agent_id === task.original_implementer? ───► [ REJECT ]        │
│       │                                                                     │
│       ├── 2. agent_id ∈ task.attempts[*].implementer? ──► [ REJECT ]        │
│       │                                                                     │
│       ├── 3. agent_id ∈ task.validation_history[*]? ────► [ REJECT ]        │
│       │                                                                     │
│       └── All Checks Passed ────────────────────────────► [ GRANT LEASE ]   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Attempting to assign a compromised or non-independent validator fails immediately with a deterministic harness error:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "validator must be independent from implementers and prior validators"
  }
}
```

---

## 🔒 2. Explanation: The Cognitive Validator Hard-Lock

A validator's responsibility is rigorous cognitive evaluation and verification of evidence—**not** performing ad-hoc code alterations, applying dirty patches, or running arbitrary non-reproducible scripts.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   COGNITIVE VALIDATOR HARD-LOCK BOUNDARY                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐  │
│  │        IMPLEMENTER ROLE         │   │         VALIDATOR ROLE          │  │
│  ├─────────────────────────────────┤   ├─────────────────────────────────┤  │
│  │ • Write Scope: MUTABLE          │   │ • Write Scope: READ-ONLY (🔒)   │  │
│  │ • Arbitrary Commands: ALLOWED   │   │ • 0 Workspace Mutating Cmds     │  │
│  │ • Edits Code, Adds Files        │   │ • Pure Cognitive Inspection     │  │
│  │ • Submits Diff & Commit State   │   │ • Mandatory Gate Verification   │  │
│  │ • Executes Unit/Integration     │   │ • AST Static Checks (0 any)     │  │
│  │   Test Suites During Dev        │   │ • Socratic Probing & Pushbacks  │  │
│  └─────────────────────────────────┘   └─────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Under the **Cognitive Validator Hard-Lock**:

- The validator is granted **zero commands** to alter repository code. Its filesystem view is strictly immutable.
- A validator cannot bypass a failure by quietly patching an implementer's code.
- All command executions performed by a validator via `run:exec --actor <validator>` must target explicit compiled mandatory gates or static checks (`task:check`).
- The validator operates as an objective cognitive critic, measuring reality against requirements.

---

## 📡 3. Explanation: The Dual-Channel Review Protocol

Reviewing code requires two distinct cognitive approaches: identifying broken functionality and probing for latent brittleness. The **Dual-Channel Review Protocol** formalizes this separation:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DUAL-CHANNEL REVIEW PROTOCOL                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│             ┌─────────────────────────────────────────────────┐             │
│             │            VALIDATOR INSPECTION ENGINE          │             │
│             └───────────────┬─────────────────┬───────────────┘             │
│                             │                 │                             │
│               CHANNEL 1     │                 │     CHANNEL 2               │
│            (Defect Push)    │                 │ (Cognitive Probe)           │
│                             ▼                 ▼                             │
│             ┌─────────────────────────┐ ┌─────────────────────────┐         │
│             │       task:reject       │ │       task:probe        │         │
│             ├─────────────────────────┤ ├─────────────────────────┤         │
│             │ • Claim: "X is broken"  │ │ • Claim: "Prove X"      │         │
│             │ • Class: defect         │ │ • Class: probe_demand   │         │
│             │ • Severity: required    │ │ • Severity: minor       │         │
│             │ • Moves repair_round +1 │ │ • Moves probe_round +1  │         │
│             │ • Reassigns/escalates   │ │ • Stays in validating   │         │
│             └─────────────────────────┘ └─────────────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Channel 1: Adversarial Defect Pushes (`task:reject`)

Channel 1 handles hard functional defects: logic errors, broken contracts, security vulnerabilities, regression bugs, or hardcoded mock returns that bypass gates without actually implementing logic.

- **Precondition**: Requires `--checks` citing the validator's own successful execution of mandatory gates. If the gate itself is red, the task is mechanically broken; `task:reject` is reserved for when gates are green but requirements are unmet.
- **Effect**: Records a structured `defect` finding, increments `repair_round`, transitions task state to `changes_requested`, and routes the task to repair.

### Channel 2: Socratic Cognitive Deepening Probes (`task:probe`)

Channel 2 handles demands for falsifiable proof. A probe is a Socratic challenge, not an accusation of failure.

- **Nature**: Asks the implementer or codebase to demonstrate generalization (e.g., "Prove the algorithm handles empty strings and multi-byte UTF-8 without branching into special-case hardcodes").
- **Effect**: Records a `probe_demand` finding, increments `probe_round`, and keeps the task in `validating` state.
- **Invariant**: Every task has a mandatory minimum number of probes (`min_adversarial_probes`, default `1`). `task:review --status pass` is strictly refused until this minimum is satisfied.

---

## ⚡ 4. Explanation: 1-Hop In-Lease Micro-Cycles

Full task rejection and reassignment introduces coordination latency: the implementer's lease is revoked, work is queued to the graph coordinator, and a repairer must be scheduled and onboarded.

For minor defects and fast corrections, `olt` provides **1-Hop In-Lease Micro-Cycles** (`task:reject --in-lease`):

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    1-HOP IN-LEASE MICRO-CYCLE STATE ENGINE                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Task Submitted by Implementer ] ──► [ Validator Leased ]                 │
│                                                │                            │
│                                                ▼                            │
│                                       [ Finding Discovered ]                │
│                                                │                            │
│                   ┌────────────────────────────┴────────────────────────────┐
│                   ▼ (micro_cycles < 3)                  ▼ (micro_cycles >= 3)│
│       ┌───────────────────────┐             ┌───────────────────────┐       │
│       │ task:reject --in-lease│             │      task:reject      │       │
│       ├───────────────────────┤             ├───────────────────────┤       │
│       │ • Lease retained      │             │ • Lease revoked       │       │
│       │ • micro_cycles +1     │             │ • repair_round +1     │       │
│       │ • Direct fast repair  │             │ • Formal reassignment │       │
│       └───────────┬───────────┘             └───────────────────────┘       │
│                   │                                                         │
│                   ▼                                                         │
│       [ Implementer Fixes Code ]                                            │
│                   │                                                         │
│                   ▼                                                         │
│       [ Re-submit: task:submit ]                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Micro-Cycle Execution**: When a minor issue is identified during active validation, the validator issues `task:reject --in-lease`. The active implementer's lease is maintained rather than torn down.
2. **Direct Turnaround**: The implementer receives the structured finding, applies the fix, and re-submits within the active lease window.
3. **Hard Bounded Ceiling (Max 3)**: A task is permitted a maximum of **3 in-lease micro-cycles**. If the implementer cannot satisfy the validator within 3 micro-cycles, the harness automatically escalates the rejection to a formal round (`repair_round + 1`), revokes the lease, and triggers formal repair routing.

---

## 🔍 5. Explanation: Fast Incremental Static Checks (`task:check`)

Before and during validation, static code quality is verified via `task:check`. This provides instantaneous, deterministic AST-level feedback without running heavy integration test suites.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TASK:CHECK AUDIT INVARIANTS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Zero `any` Types                                                        │
│     Explicit or untyped `any` annotations are flagged as hard blocking      │
│     defects (CQ-TYPE-001). Code must use strict types or `unknown`.         │
│                                                                             │
│  2. Zero Suppression Directives                                             │
│     Comments disabling type checking or linter rules (@ts-ignore,            │
│     @ts-expect-error, eslint-disable) are strictly rejected (CQ-SUPPRESS-002).│
│                                                                             │
│  3. Boundary Type Integrity                                                 │
│     All exported functions, parameters, and return types must carry         │
│     explicit, non-inferred type definitions.                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Running `task:check` ensures the codebase is statically sound before cognitive review begins:

```bash
bun harness.ts task:check --run .olt/capsules/<run-id> --task <task-id>
```

---

## 🗂️ 6. Reference: Standing Checklist Validator Domains (B12.2)

To avoid forcing a single validator to certify unrelated specialties, tasks support **concurrent domain validations**:

$$\text{VALIDATOR\_DOMAINS} = \{\text{code-quality}, \text{product}, \text{security}, \text{system-design}, \text{ui-design}\}$$

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DOMAIN APPLICABILITY & DISPATCH RULES                    │
├───────────────────┬─────────────────────────────────────────────────────────┤
│ Domain            │ Trigger Invariant / Scope Criteria                      │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ `code-quality`    │ Mandatory for ALL tasks. Enforces formatting, types,    │
│                   │ AST cleanliness, and structure.                         │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ `ui-design`       │ Triggered when write scope touches: `.tsx`, `.jsx`,     │
│                   │ `.vue`, `.svelte`, `.html`, `.css`, `.scss`, `.sass`.   │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ `system-design`   │ Triggered when write scope touches: `.graphql`,         │
│                   │ `.proto`, or paths matching `schema/`, `migrations/`.   │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ `security`        │ Dispatched explicitly for auth, crypto, and token code. │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ `product`         │ Dispatched explicitly for user-facing flows & copy.     │
└───────────────────┴─────────────────────────────────────────────────────────┘
```

### Domain Rules:

1. **Unanimous Pass Required**: A task reaches `validated` status only when **every applicable domain has recorded an independent pass**.
2. **Atomic Invalidation on Reject**: A rejection from **any single domain** immediately terminates the round for all domains, archiving all open validation attempts into `validation_history`.
3. **Shared Finding Registry**: Findings are registered at the task level (`state.tasks[id].findings`), requiring all open findings to be resolved before any domain can issue a final pass.

---

## 🧼 7. Explanation: Algorithmic Context Sanitization

LLMs suffer from sycophantic anchoring when shown previous reviewers' narratives or implementers' self-assessing claims. The harness sanitizes validator briefs via `isolateValidatorContext`:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ALGORITHMIC CONTEXT SANITIZATION PIPELINE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Raw Implementer Submission ]                                             │
│    • summary: "Refactored auth module. All tests 100% pass!" (PROSE)        │
│    • confidence: 0.99, decision_narrative: "Clean rewrite"                  │
│    • files_changed: ["src/auth.ts"]                                         │
│                                  │                                          │
│                                  ▼ (isolateValidatorContext)                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  SCRUBBED EXCLUSION SET:                                              │  │
│  │  ❌ confidence             ❌ decision_narrative                      │  │
│  │  ❌ implementer_report     ❌ task_report                             │  │
│  │  ❌ previous_review        ❌ prior_reviews                           │  │
│  │  ❌ validator_report       ❌ subjective opinions                     │  │
│  └───────────────────────────────┬───────────────────────────────────────┘  │
│                                  ▼                                          │
│  [ Clean Allowlisted Brief Delivered to Validator ]                         │
│    ✅ Original requirements & acceptance criteria                            │
│    ✅ Objective Git diff of touched files                                    │
│    ✅ Mandatory gate command argv to execute via run:exec                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Round 2+ Judgement Stripping

In repair rounds (Round 2 and beyond), prior findings are stripped of subjective fields (`verdict`, `severity`, `observation`, `recommendation`). What remains is re-framed as an objective **demand to prove**:

```json
{
  "demand_id": "finding-task-slug-reject",
  "requirement_id": "req-slug",
  "prove": "Lowercase input, collapse non-alphanumeric character runs to single hyphens, trim edge hyphens.",
  "prove_by": "bun test tests/slug.test.ts",
  "look_at": ["src/slug.ts", "tests/slug.test.ts"]
}
```

---

## 📖 8. How-To Guide: The Validator Lifecycle

Follow this operational procedure when validating any task.

### Step 1: Claim the Validation Lease

```bash
bun harness.ts task:validate-start \
  --run .olt/capsules/<run-id> \
  --task <task-id> \
  --validator <validator-agent-id> \
  --validator-domain code-quality
```

Output:

```text
### Validation Leased: task-slug
- **Validator**: `val-code-1`
- **Validation Token**: `BtYrfM4hNV-YBbSBw3jp6eHUI-GmVZAXbPBT9b2l6cQ`
- **Mandatory Gates to Run**:
  1. `bun test tests/slug.test.ts`
- **Before Sign-off**: record 1 adversarial probe(s) with `task:probe`.
```

### Step 2: Run Static Audits

```bash
bun harness.ts task:check \
  --run .olt/capsules/<run-id> \
  --task <task-id>
```

### Step 3: Execute Mandatory Gates Independently

Every mandatory gate must be executed by the validator using its own actor identity:

```bash
bun harness.ts run:exec \
  --run .olt/capsules/<run-id> \
  --actor <validator-agent-id> \
  --task <task-id> \
  -- bun test tests/slug.test.ts
```

### Step 4: Record Socratic Probes

```bash
bun harness.ts task:probe \
  --run .olt/capsules/<run-id> \
  --task <task-id> \
  --validator <validator-agent-id> \
  --token <validation-token> \
  --demand "Prove the slugify function computes slugs dynamically rather than matching static fixture strings." \
  --revalidation "bun test tests/slug.test.ts"
```

### Step 5A: Issue Verdict — PASS

When all gates pass, probes are answered, and static checks are clean:

```bash
bun harness.ts task:review \
  --run .olt/capsules/<run-id> \
  --task <task-id> \
  --validator <validator-agent-id> \
  --token <validation-token> \
  --status pass \
  --summary "Implementation handles unicode, collapses hyphens dynamically, and satisfies all requirements." \
  --checks <gate-command-id> \
  --resolve "probe-<task-id>-01-1=<gate-command-id>"
```

### Step 5B: Issue Verdict — Fast In-Lease Pushback (Micro-Cycle)

If a fast, isolated fix is needed within the active lease:

```bash
bun harness.ts task:reject \
  --run .olt/capsules/<run-id> \
  --task <task-id> \
  --validator <validator-agent-id> \
  --token <validation-token> \
  --in-lease \
  --reason "Missing boundary check for null/undefined input in src/slug.ts:14" \
  --severity minor \
  --remediation "Add explicit guard clause checking for empty/null string before regex execution." \
  --checks <gate-command-id>
```

### Step 5C: Issue Verdict — Formal Task Rejection

For substantial defects or exhausted micro-cycles:

```bash
bun harness.ts task:reject \
  --run .olt/capsules/<run-id> \
  --task <task-id> \
  --validator <validator-agent-id> \
  --token <validation-token> \
  --reason "Slug generation uses hardcoded if-statements matching test cases rather than algorithmic transformation." \
  --severity critical \
  --remediation "Implement dynamic regex replacement: input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')" \
  --checks <gate-command-id>
```

---

## 💻 9. Tutorial: End-to-End Task Validation Walkthrough

### Scenario

An implementer (`imp-1`) has submitted `task-auth-token`, which generates and verifies cryptographic JWT tokens. Write scope: `src/auth/token.ts`, `tests/auth/token.test.ts`.

### 1. Acquire Validation Lease

```bash
bun harness.ts task:validate-start \
  --run .olt/capsules/run-402 \
  --task task-auth-token \
  --validator val-sec-1 \
  --validator-domain code-quality
```

The harness mints validation token `VAL_TOK_9981`.

### 2. Run AST Static Check

```bash
bun harness.ts task:check --run .olt/capsules/run-402 --task task-auth-token
```

Result: `0 any types found, 0 linter suppression comments detected. Clean.`

### 3. Validator Executes Gate

```bash
bun harness.ts run:exec --run .olt/capsules/run-402 --actor val-sec-1 --task task-auth-token -- \
  bun test tests/auth/token.test.ts
```

Recorded command receipt: `C-948201`.

### 4. Challenge Implementation with Socratic Probe

Validator inspects `src/auth/token.ts` and notices token expiration check uses client-supplied timestamps. Validator records probe:

```bash
bun harness.ts task:probe \
  --run .olt/capsules/run-402 \
  --task task-auth-token \
  --validator val-sec-1 \
  --token VAL_TOK_9981 \
  --demand "Prove signature verification fails when an expired token is signed with a valid key but past its exp claim." \
  --revalidation "bun test tests/auth/token.test.ts"
```

Probe registered: `probe-task-auth-token-01-1`.

### 5. Pushback via 1-Hop In-Lease Micro-Cycle

Validator runs a test against token expiration and finds the expiration check was omitted:

```bash
bun harness.ts task:reject \
  --run .olt/capsules/run-402 \
  --task task-auth-token \
  --validator val-sec-1 \
  --token VAL_TOK_9981 \
  --in-lease \
  --reason "Token verification does not validate the 'exp' claim against server clock." \
  --severity critical \
  --remediation "Add Math.floor(Date.now() / 1000) > payload.exp check in verifyToken." \
  --checks C-948201
```

### 6. Implementer Fast-Fix & Re-submission

Implementer `imp-1` (still holding lease) updates `src/auth/token.ts`, adds an expiration unit test, and runs `task:submit`.

### 7. Re-Testing & Resolution

Validator reruns gate:

```bash
bun harness.ts run:exec --run .olt/capsules/run-402 --actor val-sec-1 --task task-auth-token -- \
  bun test tests/auth/token.test.ts
```

Recorded command receipt: `C-948205`.

Validator signs off:

```bash
bun harness.ts task:review \
  --run .olt/capsules/run-402 \
  --task task-auth-token \
  --validator val-sec-1 \
  --token VAL_TOK_9981 \
  --status pass \
  --summary "Cryptographic verification confirmed. Expiration claim validated against system clock." \
  --checks C-948205 \
  --resolve "probe-task-auth-token-01-1=C-948205"
```

Task transitions to `validated`.

---

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)
