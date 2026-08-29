# The Twenty-Eight Empirical Blunders & Failure Modes

[Reference Home](../index.md) > [Error Dictionary](./index.md) > Twenty-Eight Empirical Blunders

---

[⏮️ Previous: Harness Error Codes & Payloads](16-02-harness-error-codes-and-payloads.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Recovery & Mitigation Playbooks](16-04-recovery-and-mitigation-playbooks.md)
---

Autonomous multi-agent systems driven by Large Language Models (LLMs) fail in distinct, empirically observed ways. When given unconstrained autonomy, LLMs exhibit cognitive biases such as conversational sycophancy, premature sign-offs, prompt rewriting, unread tail dropping, and hallucinated line citations.

The Open Loop Task (OLT) architecture classifies these failure modes into **28 canonical empirical blunders**. Every blunder is backed by an automated, mechanical countermeasure enforced by the harness runtime.

---

## 🧭 1. Blunder Taxonomy Overview

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   THE 28 OLT BLUNDER CODES                                       │
├────────────────────────┬───────────────────────────┬─────────────────────────────────────────────┤
│ DOMAIN CATEGORY        │ BLUNDER CODES             │ PRIMARY TARGETED VULNERABILITY              │
├────────────────────────┼───────────────────────────┼─────────────────────────────────────────────┤
│ 1. Lifecycle & Planning│ `LP-1` .. `LP-6` (6 codes)│ Prompt truncation, rewriting, hallucination │
│ 2. Validation & Probing│ `VP-1` .. `VP-4` (4 codes)│ Context anchoring, sycophancy, vague review │
│ 3. Verification & Test │ `VT-1` .. `VT-4` (4 codes)│ Premature pass, prose answers, broken gates │
│ 4. Branching Isolation │ `BR-1` .. `BR-4` (4 codes)│ Deadlock, branch leaks, scope escalation    │
│ 5. Multi-Agent Coord   │ `MC-1` .. `MC-4` (4 codes)│ Monolithic repair, regression, Triad breach │
│ 6. State & Runtime     │ `SM-1` .. `SM-8` (8 codes)│ Interactive stalls, recursion, empty output │
│ 7. Gates & Evidence    │ `G5-1` .. `G5-3` (3 codes)│ Supervisor leaks, fake proof, ephemeral logs│
└────────────────────────┴───────────────────────────┴─────────────────────────────────────────────┘
```

---

## 📋 2. Category 1: Lifecycle & Planning Blunders (`LP-1` .. `LP-6`)

### `LP-1`: Unread Tail Dropping

- **Empirical Failure Pattern**: When ingest prompts exceed 2,000 tokens, LLMs exhibit severe recency/primacy bias, dropping operational requirements or negative constraints placed in the bottom third of the prompt.
- **Impact**: Incomplete implementations, missing non-functional constraints, silent omissions.
- **Harness Countermeasure**: **Full Source Line Disposition Algorithm**. Every single line in `prompt.md` must be explicitly classified (`MUST_IMPLEMENT`, `CONSTRAINT`, `CONTEXT`, `IRRELEVANT`) in `requirements.json`. `plan:compile` fails if any prompt line remains unmapped.
- **Diagnostic Command**: `bun harness.ts plan:audit --run <run-path>`

```
┌────────────────────────────────────────────────────────────────────────┐
│ PROMPT.MD (100 Lines)  ───►  REQUIREMENTS.JSON                         │
│ [Line 001 - 040]       ───►  req-auth-01 (MUST_IMPLEMENT)              │
│ [Line 041 - 075]       ───►  req-rate-limit (CONSTRAINT)               │
│ [Line 076 - 100]       ───►  ⛔ UNMAPPED (Error: LP-1 Halt Compilation) │
└────────────────────────────────────────────────────────────────────────┘
```

---

### `LP-2`: Chat Context Capture Loophole

- **Empirical Failure Pattern**: An agent copies text from conversational history into a local file, claims it is the "verbatim user request", and calculates a SHA-256 hash without proving authenticity against the original stream.
- **Impact**: Hallucinated prompt captures; missing original constraints.
- **Harness Countermeasure**: **Provenance-Bound Capture Engine** (`cli/prompt-capture.ts`). The harness accepts prompt text exclusively via explicit input modes (`stdin`, `--file`, or verified system pipe), recording the raw byte digest into `manifest.json`.
- **Diagnostic Command**: `bun harness.ts doctor --run <run-path>`

---

### `LP-3`: Implicit Goal Invention

- **Empirical Failure Pattern**: The planner hallucinates unrequested features, unnecessary libraries, or microservice architectures not present in the user prompt.
- **Impact**: Scope explosion, unneeded complexity, budget exhaustion.
- **Harness Countermeasure**: **Closed Requirement Boundary**. Every requirement in `requirements.json` must cite exact, continuous source line ranges (`source_line_start`, `source_line_end`) in `prompt.md`. Requirements without verbatim prompt backing are rejected.
- **Diagnostic Command**: `bun harness.ts plan:audit --run <run-path>`

---

### `LP-4`: Prompt Rewrite Inversion

- **Empirical Failure Pattern**: During plan enhancement, the model summarizes or rephrases the user prompt into a "clearer" description, subtly dropping strict negative constraints (e.g. "do not use external dependencies").
- **Impact**: Relaxed constraints, violation of explicit user requirements.
- **Harness Countermeasure**: **Immutable Prompt Authority**. `prompt.md` is strictly immutable. All plan goals generated during `plan:enhance` are labeled `agent_reported` and cannot override or relax raw prompt lines.
- **Diagnostic Command**: `bun harness.ts doctor --run <run-path>`

---

### `LP-5`: Line Range Hallucination

- **Empirical Failure Pattern**: The model cites fictitious line numbers (e.g. lines 120–145 in an 80-line prompt) to claim compliance for hallucinated features.
- **Impact**: Bogus traceability links that pass naive schema validators.
- **Harness Countermeasure**: **Strict Line Range Bounds Verifier**. `plan:init` and `plan:add` validate line index boundaries ($1 \le \text{start} \le \text{end} \le N$) against the exact line count of `prompt.md`.
- **Diagnostic Command**: `bun harness.ts plan:audit --run <run-path>`

---

### `LP-6`: Premature Architecture Invention

- **Empirical Failure Pattern**: The model freezes the system architecture, file layouts, and test frameworks before inspecting the existing repository files, naming conventions, or dependencies.
- **Impact**: Incompatible file structures, conflicting package managers, build breakage.
- **Harness Countermeasure**: **Two-Stage Architecture Freezing**. Initial plans are marked provisional. Freezing (`plan:compile`) requires prior recorded execution of repository baseline reconnaissance (`repo-baseline.json`).
- **Diagnostic Command**: `bun harness.ts plan:audit --run <run-path>`

---

## 🔍 3. Category 2: Validation & Probing Blunders (`VP-1` .. `VP-4`)

### `VP-1`: Context Anchoring & Sycophancy

- **Empirical Failure Pattern**: A validator agent receives the implementer’s confident narrative ("I thoroughly tested all edge cases and verified 100% test passing"), anchors on it, and rubber-stamps flawed code.
- **Impact**: Defective code merged into main branches; broken guarantees.
- **Harness Countermeasure**: **Validator Context Sanitization** (`isolateValidatorContext`). Validator instruction packets omit implementer prose, justifications, and chat logs, containing only authoritative requirements, git diffs, and test commands.
- **Diagnostic Command**: `bun harness.ts task:packet --task <task-id> --role validator`

---

### `VP-2`: Implementer Narrative Bias & Broad Test Fallacy

- **Empirical Failure Pattern**: A validator runs a broad test runner (e.g. `python3 -m unittest`), discovers 0 tests due to naming mismatches, observes exit code `0`, and approves the task.
- **Impact**: Zero-test false positive approvals.
- **Harness Countermeasure**: **Substantive Test Discovery Assertion**. Monitored command execution (`run:exec`) parses test runner outputs; zero discovered test cases are flagged as unproven requirements.
- **Diagnostic Command**: `bun harness.ts task:check --task <task-id>`

---

### `VP-3`: Unstructured Pushback

- **Empirical Failure Pattern**: A validator rejects a task with vague conversational complaints ("The error handling feels incomplete"), leaving the repairer with no actionable specification.
- **Impact**: Thrashing repair loops; repairers guessing at requirements.
- **Harness Countermeasure**: **Mandatory Structured Finding Schema**. `task:reject` and `critic:reject` require structured payloads containing `id`, `requirement_id`, `severity` (`critical`, `important`, `minor`), `observation`, `evidence`, `remediation`, and `revalidation` command.
- **Diagnostic Command**: `bun harness.ts task:findings --task <task-id>`

---

### `VP-4`: Validator Exhaustion Abandonment

- **Empirical Failure Pattern**: After 2 rounds of pushback, a fatigued validator surrenders to implementer resistance and approves broken work.
- **Impact**: Decay of quality standards in later rounds.
- **Harness Countermeasure**: **Validator Independence Rotation**. A validator cannot review the same task across multiple repair rounds. A fresh, independent validator identity is mandated for each repair attempt.
- **Diagnostic Command**: `bun harness.ts status --run <run-path>`

---

## 🧪 4. Category 3: Verification & Testing Blunders (`VT-1` .. `VT-4`)

### `VT-1`: Premature First-Round Approval

- **Empirical Failure Pattern**: A validator approves a task on Round 0 immediately after green unit tests, without probing negative paths, boundary inputs, or typing constraints.
- **Impact**: Edge-case failures, unhandled exceptions in production.
- **Harness Countermeasure**: **Mandatory Adversarial Probe Round** (`min_adversarial_probes = 1`). `task:review --status pass` is mechanically blocked until at least one formal `task:probe` round is recorded.
- **Diagnostic Command**: `bun harness.ts task:probe --task <task-id> --list`

---

### `VT-2`: Ritual Rejection

- **Empirical Failure Pattern**: A validator invents non-existent cosmetic defects simply to satisfy perceived pushback quotas, burning repair rounds needlessly.
- **Impact**: Wasted token budgets; repair thrashing.
- **Harness Countermeasure**: **Separation of Probes and Defect Rejections**. `task:probe --demand` records non-defect proof demands without incrementing `repair_round` or reassigning workers. `task:reject` is reserved exclusively for verified code defects.
- **Diagnostic Command**: `bun harness.ts task:probe --task <task-id>`

---

### `VT-3`: Prose-Answered Demands

- **Empirical Failure Pattern**: An implementer responds to a probe demand with conversational explanation ("This function never receives null because caller checks it"), which the validator accepts without empirical proof.
- **Impact**: Unverified assumptions; regression vulnerabilities.
- **Harness Countermeasure**: **Receipt-Bound Resolution Invariant**. `task:review --status pass` requires `--resolve <finding-id>=<command-id>` for every open finding and demand. Unbacked prose answers are refused.
- **Diagnostic Command**: `bun harness.ts task:review --run <run> --task <task> --status pass --resolve <id>=<cmd>`

---

### `VT-4`: Green Sign-Off Over Red Gate

- **Empirical Failure Pattern**: A validator passes a task because the code looks clean, ignoring a failing mandatory integration gate.
- **Impact**: Broken builds and failing test suites merged into main.
- **Harness Countermeasure**: **Mechanical Gate Interlock**. `task:review` inspects the durable command store; if the latest recorded run of any applicable mandatory gate failed or timed out, review approval is refused.
- **Diagnostic Command**: `bun harness.ts gate:status --run <run-path>`

---

## 🌿 5. Category 4: Branching & Isolation Blunders (`BR-1` .. `BR-4`)

### `BR-1`: Dead Sub-Agent Freeze

- **Empirical Failure Pattern**: A subagent holding a branch sub-task crashes or disconnects. The sub-task never completes, freezing the parent lease indefinitely.
- **Impact**: Pipeline lockups; infinite agent wait states.
- **Harness Countermeasure**: **Automated Lease Reclamation** (`bun harness.ts recover`). Expired sub-leases are reclaimed and returned to `open` status, allowing the parent to re-dispatch.
- **Diagnostic Command**: `bun harness.ts recover --run <run-path>`

---

### `BR-2`: Uncollected Branch Leak

- **Empirical Failure Pattern**: All primary plan tasks appear `done`, but a worker leaves open, uncollected child branches, leaking unmerged code.
- **Impact**: Incomplete codebase; lost subagent work.
- **Harness Countermeasure**: **Terminal Completion Barrier**. `run:complete` scans all branches; any branch in `open` or `collecting` status immediately halts completion.
- **Diagnostic Command**: `bun harness.ts branch:list --run <run-path>`

---

### `BR-3`: Branched Parent Stale Reap

- **Empirical Failure Pattern**: A live parent agent waiting synchronously for child branch completion has its own lease expire and gets reaped by the watchdog.
- **Impact**: Premature task revocation of active parent workers.
- **Harness Countermeasure**: **Lease Clock Suspension**. `branch:open` freezes the parent task's expiration clock until `branch:collect` or `branch:abandon` restores it with a fresh lease window.
- **Diagnostic Command**: `bun harness.ts status --run <run-path>`

---

### `BR-4`: Branch Scope Escalation

- **Empirical Failure Pattern**: A child sub-branch attempts to claim a write scope broader than the parent task's leased boundary.
- **Impact**: Unauthorized modifications; cross-subsystem corruption.
- **Harness Countermeasure**: **Strict Hierarchical Scope Containment**. Sub-branch write scopes must be strict subsets of the parent task's `write_scope`.
- **Diagnostic Command**: `bun harness.ts branch:open --run <run> --task <subtask> --scope <glob>`

---

## 👥 6. Category 5: Multi-Agent Coordination Blunders (`MC-1` .. `MC-4`)

### `MC-1`: Monolithic In-Place Repair

- **Empirical Failure Pattern**: When late-stage Completeness Critic detects cross-subsystem defects, the coordinator assigns all fixes to a single agent in-place on the main thread, causing context window exhaustion and regression cascades.
- **Impact**: Massive prompt bloat; thrashing repair loops.
- **Harness Countermeasure**: **Mandatory Fan-Back Replanning** (`plan:replan`). Critic defects are partitioned by write scope into new wave DAGs with independent worker pairs.
- **Diagnostic Command**: `bun harness.ts plan:replan --run <run-path>`

---

### `MC-2`: Repair Regression Cascade

- **Empirical Failure Pattern**: A repair worker applies quick patches without running regression test suites, breaking previously working components.
- **Impact**: New bugs introduced during defect resolution.
- **Harness Countermeasure**: **Cumulative Gate Re-Execution**. Completing a repair task requires re-executing all ancestor and sibling task gates within the affected subsystem.
- **Diagnostic Command**: `bun harness.ts gate:run-all --run <run-path>`

---

### `MC-3`: Repair Identity Reuse

- **Empirical Failure Pattern**: The same implementer who wrote buggy code is re-assigned to fix it without fresh validation, repeating original flawed assumptions.
- **Impact**: Repeated failure to identify cognitive blind spots.
- **Harness Countermeasure**: **Different Repairer Preference**. `task:assign-repairer` requires designating a fresh repairer identity or explicit override justification.
- **Diagnostic Command**: `bun harness.ts queue:next --run <run-path>`

---

### `MC-4`: Triad Floor Violation

- **Empirical Failure Pattern**: A coordinator dispatches an implementer without deploying a paired validator, intending to validate "later".
- **Impact**: Unvalidated code accumulation; delayed defect discovery.
- **Harness Countermeasure**: **The Triad Floor Invariant**. The harness mandates maintaining an active Triad: $\ge 1\text{ Coordinator} + \ge 1\text{ Implementer} + \ge 1\text{ Independent Validator}$.
- **Diagnostic Command**: `bun harness.ts status --run <run-path>`

---

## ⚡ 7. Category 6: State Machine & Storage Blunders (`SM-1` .. `SM-8`)

### `SM-1`: Host Binary Inversion

- **Empirical Failure Pattern**: The model attempts to manage subagents by running the host's interactive terminal wrapper (e.g. `agy agents`, `cursor`) inside shell execution commands.
- **Impact**: Nested terminal deadlocks; recursive host invocation.
- **Harness Countermeasure**: **Host Binary Deny-List**. Shell execution interlocks block invocations of interactive host binaries, directing agents to native harness commands.
- **Diagnostic Command**: `bun harness.ts run:exec --cmd "..."`

---

### `SM-2`: Interactive CLI Stall

- **Empirical Failure Pattern**: A model spawns interactive CLI commands (e.g. `npm init`, `nano`) in non-interactive background tasks, causing permanent process hangs.
- **Impact**: Unbounded CPU hangs; task timeouts.
- **Harness Countermeasure**: **Non-Interactive Invariant & PTY Watchdog**. Commands are executed with `CI=1` and `DEBIAN_FRONTEND=noninteractive`; stalled zero-output processes are terminated after timeout.
- **Diagnostic Command**: `bun harness.ts run:exec --timeout 30000 --cmd "..."`

---

### `SM-3`: Nested Harness Recursion

- **Empirical Failure Pattern**: A subagent worker attempts to spawn a nested OLT orchestrator session inside its own leased worktree.
- **Impact**: State corruption; recursive locking deadlocks.
- **Harness Countermeasure**: **Process Tree Introspection**. Harness initialization checks ancestor process environment variables, prohibiting nested capsule creation.
- **Diagnostic Command**: `bun harness.ts run:init --run <run-path>`

---

### `SM-4`: Turn 0 Conversational Paralysis

- **Empirical Failure Pattern**: Upon being initialized as an autonomous supervisor, the model halts and asks "How can I help you?".
- **Impact**: Zero autonomous progress; stalled workflows.
- **Harness Countermeasure**: **`TURN_0_AUTONOMOUS_WAKEUP` Invariant**. Supervisor role prompts compel immediate backlog intake and queue inspection on Turn 0 without user interaction.
- **Diagnostic Command**: `bun harness.ts mind:pulse`

---

### `SM-5`: Thinking Chain Truncation

- **Empirical Failure Pattern**: The model consumes its entire max token budget in internal `<thought>` reasoning, truncating before emitting tool calls.
- **Impact**: Aborted turns; zero emitted output.
- **Harness Countermeasure**: **Telemetry Truncation Alert**. The harness logs reasoning token metrics and alerts coordinators when token budgets approach limits.
- **Diagnostic Command**: `bun harness.ts status --run <run-path>`

---

### `SM-6`: Empty Payload Dropout

- **Empirical Failure Pattern**: The model finishes thinking and returns an empty payload (0 text, 0 tool calls), causing host execution errors.
- **Impact**: Dropped execution turns; pipeline stalls.
- **Harness Countermeasure**: **`NON_EMPTY_PAYLOAD_MANDATE`**. Host wrappers validate payload existence and automatically prompt for required tool outputs.
- **Diagnostic Command**: `bun harness.ts agent:health`

---

### `SM-7`: Markdown Fence Escape

- **Empirical Failure Pattern**: The model outputs malformed nested triple-backticks inside file writes or JSON arguments, breaking CLI argument parsers.
- **Impact**: CLI parse errors; broken file contents.
- **Harness Countermeasure**: **Quad-Backtick & File Path IO Architecture**. High-volume payloads are passed via files (`--findings-file`) rather than inline CLI strings.
- **Diagnostic Command**: `bun harness.ts task:findings --findings-file <path>`

---

### `SM-8`: Rogue Background Sleep Loops

- **Empirical Failure Pattern**: The model writes `while true; do sleep 10; done` daemon scripts in the repository root to simulate timers.
- **Impact**: Orphaned processes; dirty workspace root; CPU waste.
- **Harness Countermeasure**: **Root Directory Hygiene Guard & Anti-Sleep Mandate**. Prohibits unmanaged shell sleep scripts in favor of native `schedule` timers.
- **Diagnostic Command**: `bun harness.ts doctor --run <run-path>`

---

## 🛡️ 8. Category 7: Gate & Evidence Blunders (`G5-1` .. `G5-3`)

### `G5-1`: Supervisor Boundary Leak

- **Empirical Failure Pattern**: A supervisory role (`mind`, `orchestrator`, `coordinator`) directly modifies source files or runs raw unit tests.
- **Impact**: Loss of architectural separation; bypass of validation checks.
- **Harness Countermeasure**: **Supervisor Zero-File-Edit Invariant**. Any file write attempted by a supervisor is refused with `ROLE_CONFINEMENT_VIOLATION`.
- **Diagnostic Command**: `bun harness.ts role:cheat-sheet <role>`

---

### `G5-2`: Unfalsifiable Evidence Submission

- **Empirical Failure Pattern**: An agent submits subjective, qualitative assertions ("the UI looks great and feels fast") as evidence for technical acceptance criteria.
- **Impact**: Bogus verification sign-offs; degraded software quality.
- **Harness Countermeasure**: **Classes 1–4 Deterministic Evidence Engine**. Verification requires machine-verifiable receipts:
  - Class 1: Exact exit code receipts (`record.json`).
  - Class 2: Static AST lint reports (`ast-linter.ts`).
  - Class 3: Perceptual APCA contrast calculations ($\ge 60 L_c$).
  - Class 4: Binary PNG IHDR chunk validation.
- **Diagnostic Command**: `bun harness.ts gate:prove --gate <gate-id>`

---

### `G5-3`: Ephemeral Evidence Evaporation

- **Empirical Failure Pattern**: An agent runs tests in a temporary container or directory, captures output to `/tmp`, and deletes the directory, leaving no audit trail.
- **Impact**: Unreproducible builds; broken audit trails.
- **Harness Countermeasure**: **Durable Content-Addressed Receipt Storage**. All execution logs and outputs are stored permanently in `.olt/capsules/<slug>/commands/` with SHA-256 hashes.
- **Diagnostic Command**: `bun harness.ts inspection:receipt --cmd-id <cmd-id>`

---

## 📊 9. Master 28-Blunder Matrix

| Code   | Blunder Name                     | Category               | Risk Level | Invariant Enforced            | Automated Detection  |
| :----- | :------------------------------- | :--------------------- | :--------- | :---------------------------- | :------------------- |
| `LP-1` | Unread Tail Dropping             | Lifecycle & Planning   | High       | Source Line Disposition       | `plan:audit`         |
| `LP-2` | Chat Context Capture Loophole    | Lifecycle & Planning   | High       | Provenance-Bound Capture      | `doctor`             |
| `LP-3` | Implicit Goal Invention          | Lifecycle & Planning   | Medium     | Closed Requirement Boundary   | `plan:audit`         |
| `LP-4` | Prompt Rewrite Inversion         | Lifecycle & Planning   | High       | Immutable Prompt Authority    | `doctor`             |
| `LP-5` | Line Range Hallucination         | Lifecycle & Planning   | High       | Line Range Bounds Verifier    | `plan:audit`         |
| `LP-6` | Premature Architecture Invention | Lifecycle & Planning   | Medium     | Two-Stage Architecture Freeze | `plan:audit`         |
| `VP-1` | Context Anchoring & Sycophancy   | Validation & Probing   | Critical   | Context Sanitization          | `task:packet`        |
| `VP-2` | Broad Test Fallacy               | Validation & Probing   | Critical   | Substantive Test Discovery    | `task:check`         |
| `VP-3` | Unstructured Pushback            | Validation & Probing   | Medium     | Structured Finding Schema     | `task:findings`      |
| `VP-4` | Validator Exhaustion             | Validation & Probing   | High       | Independence Rotation         | `status`             |
| `VT-1` | Premature First-Round Approval   | Verification & Testing | Critical   | Adversarial Probe Round       | `task:probe`         |
| `VT-2` | Ritual Rejection                 | Verification & Testing | Medium     | Probe / Defect Separation     | `task:probe`         |
| `VT-3` | Prose-Answered Demands           | Verification & Testing | Critical   | Receipt-Bound Resolution      | `task:review`        |
| `VT-4` | Green Sign-Off Over Red Gate     | Verification & Testing | Critical   | Mechanical Gate Interlock     | `gate:status`        |
| `BR-1` | Dead Sub-Agent Freeze            | Branching Isolation    | High       | Lease Reclamation             | `recover`            |
| `BR-2` | Uncollected Branch Leak          | Branching Isolation    | High       | Completion Barrier            | `branch:list`        |
| `BR-3` | Branched Parent Stale Reap       | Branching Isolation    | Medium     | Lease Clock Suspension        | `status`             |
| `BR-4` | Branch Scope Escalation          | Branching Isolation    | Critical   | Scope Containment             | `branch:open`        |
| `MC-1` | Monolithic In-Place Repair       | Multi-Agent Coord      | High       | Fan-Back Replanning           | `plan:replan`        |
| `MC-2` | Repair Regression Cascade        | Multi-Agent Coord      | Critical   | Cumulative Gate Run           | `gate:run-all`       |
| `MC-3` | Repair Identity Reuse            | Multi-Agent Coord      | Medium     | Fresh Repairer Policy         | `queue:next`         |
| `MC-4` | Triad Floor Violation            | Multi-Agent Coord      | Critical   | Triad Floor Invariant         | `status`             |
| `SM-1` | Host Binary Inversion            | State & Runtime        | High       | Host Binary Deny-List         | `run:exec`           |
| `SM-2` | Interactive CLI Stall            | State & Runtime        | High       | Non-Interactive PTY Watchdog  | `run:exec`           |
| `SM-3` | Nested Harness Recursion         | State & Runtime        | Critical   | Process Tree Check            | `run:init`           |
| `SM-4` | Turn 0 Paralysis                 | State & Runtime        | Medium     | Turn 0 Autonomous Wakeup      | `mind:pulse`         |
| `SM-5` | Thinking Chain Truncation        | State & Runtime        | Medium     | Token Telemetry Alert         | `status`             |
| `SM-6` | Empty Payload Dropout            | State & Runtime        | Medium     | Non-Empty Payload Mandate     | `agent:health`       |
| `SM-7` | Markdown Fence Escape            | State & Runtime        | Low        | Quad-Backtick File IO         | `task:findings`      |
| `SM-8` | Rogue Sleep Loops                | State & Runtime        | High       | Root Hygiene & Anti-Sleep     | `doctor`             |
| `G5-1` | Supervisor Boundary Leak         | Governance & Boundary  | Critical   | Supervisor Zero-File-Edit     | `role:cheat-sheet`   |
| `G5-2` | Unfalsifiable Evidence           | Governance & Boundary  | Critical   | Classes 1-4 Evidence Engine   | `gate:prove`         |
| `G5-3` | Ephemeral Evidence Loss          | Governance & Boundary  | High       | Content-Addressed Store       | `inspection:receipt` |

---

[⏮️ Previous: Harness Error Codes & Payloads](16-02-harness-error-codes-and-payloads.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Recovery & Mitigation Playbooks](16-04-recovery-and-mitigation-playbooks.md)
---
