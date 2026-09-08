# Master Architecture Plan: Autonomous Optimizer-Orchestrator (`optimizer-orchestrator`)

```
====================================================================================================
CANONICAL 8-LEVEL SPECIFICATION: TIER 1 AUTONOMOUS OPTIMIZER & IN-SCOPE HARDENING ORCHESTRATOR
Slug: optimizer-orchestrator
Author: Independent Planner (Role: independent-planner)
Reviewed By: Adversarial Plan Validator (Role: plan-validator)
Convergence Status: FORMALLY CERTIFIED (10-Round Socratic Convergence Protocol)
Target Artifact: docs/planning/optimizer-orchestrator/PLAN.md
Date: 2026-09-08
====================================================================================================
```

---

## Level 1: Core Problem Statement, User Mental Models & Archetype Specialization

### 1.1 Context & Core Problem Statement

In the existing OLT multi-agent hierarchy, the strategic autonomous driver is the Tier 0 **Mind** (`olt/agents/mind.yaml`). Mind is fundamentally governed by an **Autonomous Creative Product Manager Mandate** and the **70/20/10 Innovation Portfolio** (70% Core Optimization, 20% Adjacent Feature Expansion, 10% Transformational / Radical Innovation). Under this charter, when pre-planned execution roadmaps in `docs/planning/` are exhausted, Mind's autonomic loop is explicitly programmed to invent new capabilities, hypothesize novel market or developer tools, and continuously expand product surface area.

While this expansionary drive is vital during greenfield product exploration and rapid feature growth, it introduces severe operational failure modes during production maintenance, stabilization, and codebase hardening:

1. **Unwanted Scope Creep & Feature Sprawl**: In mature codebases, users frequently require a "stabilize, polish, and harden" regime. Under Mind, once the backlog is cleared, the system begins inventing unrequested features, adding speculative APIs, or expanding UI surfaces.
2. **Maintenance Starvation via Creative Bias**: Mind's 70/20/10 portfolio structurally diverts 30% of energy toward adjacent or radical expansion, preventing 100% focused asymptotic refinement of existing codebases.
3. **Supervisory Overhead & Token Waste**: Invoking the full Tier 0 Mind fleet requires spinning up Mind, Mind-Auditor, Orchestrator, and Skill-Auditor. When a user simply wants systematic in-scope optimization or planned backlog drainage, running Tier 0 Mind represents excessive cognitive token burn and introduces conflicting supervisory goals.

```
+----------------------------------------------------------------------------------------------------+
|                                    CURRENT DICHOTOMY IN OLT                                        |
+----------------------------------------------------------------------------------------------------+
|  A. Feature Expansion Mode (Tier 0 Mind):                                                          |
|     Mind (Tier 0) ---> Orchestrator (Tier 1) ---> Coordinators (Tier 2) ---> Implementers (Tier 3) |
|     ^-- 70/20/10 Innovation Portfolio (always invents new features when backlog clears)            |
|                                                                                                    |
|  B. Pure Stabilization & In-Scope Hardening Mode (The Missing Archetype):                          |
|     [Optimizer-Orchestrator] (Alpha Tier 1) ---> Coordinators (Tier 2) ---> Implementers (Tier 3) |
|     ^-- ZERO Feature Invention, 100% in-scope optimization, autonomous cadence, paired w/ auditor   |
+----------------------------------------------------------------------------------------------------+
```

### 1.2 User Mental Models & Operational Expectations

The user's mental model for the new workflow is: **"Autonomous Set-and-Forget Codebase Hardening and Plan Drainer"**.

| Attribute                      | User Mental Model for Mind                                     | User Mental Model for Optimizer-Orchestrator                                                                     |
| :----------------------------- | :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **Primary Intent**             | "Grow my product, invent features, evolve the roadmap."        | "Drain existing plans, then systematically harden what exists. Never add new features."                          |
| **Backlog Depletion Behavior** | Synthesizes new user stories, specs, and radical capabilities. | Identifies structural debt, modularity violations, test impurity, and performance bottlenecks in existing files. |
| **Invocation Boundary**        | Dispatched by human or cron at Tier 0; deploys full fleet.     | Dispatched directly by human; acts as Alpha driver; bypasses Mind entirely.                                      |
| **Companion Auditors**         | Paired with `mind-auditor` AND `skill-auditor`.                | Paired **exclusively** with `skill-auditor` (0 Mind presence).                                                   |
| **Success Metric**             | Product velocity, feature breadth, UX delight.                 | Modularity (<= 400 lines), Type Safety (0 any), Pure Mocks (0 sleep/net), Hot-path Latency.                      |
| **Artifact Contract**          | `docs/planning/<feature>/PLAN.md` (roadmap expansion).         | `docs/optimization/<target>/ANALYSIS.md` (empirical baseline measurements & hardening plans).                    |

### 1.3 Core Value Grounding

1. **Asymptotic Code Quality Without Scope Inflation**: Enforces structural invariants (files $\le 400$ lines, strict separation of concerns, complete test isolation) without the risk of an LLM inventing unreviewed product surface area.
2. **Bounded Autonomy & Predictable Execution**: Eliminates the human anxiety associated with leaving an autonomous agent running unattended overnight. The user knows with 100% mathematical certainty that no new user-facing features, speculative CLI verbs, or schema modifications will be created.
3. **Empirically-Grounded Refactoring**: Refactoring without empirical baselines creates cosmetic churn. The Optimizer-Orchestrator measures before mutating—producing `docs/optimization/<target>/ANALYSIS.md` with line-count metrics, dependency graphs, mock purity audits, and runtime profiles before dispatching a single lane.
4. **Token & Overhead Efficiency**: Eliminating the Tier 0 Mind deliberation and synthesis loop reduces token consumption by ~40-60% per optimization round, dedicating context windows entirely to code analysis, coordination, and validation.

### 1.4 Rationale for Dedicated Agent Archetype (`optimizer-orchestrator`)

We explicitly reject overloading standard `orchestrator.yaml` based on four architectural invariants:

1. **Single Responsibility Principle of Personas**: `orchestrator.yaml` is a _Directed Execution Engine_ designed to run a specific plan provided by Mind or a human. In contrast, `optimizer-orchestrator.yaml` is an _Autonomic Continuous Controller_ with its own internal scheduling heartbeat, multi-phase finite state machine, and empirical scanning pipeline.
2. **Prompt Dilution and Role Drift**: Blending autonomous optimization and continuous scheduling into `orchestrator.yaml` causes cognitive instruction dilution. Models begin conflating feature execution with self-directed code mutation.
3. **Hard Invariant Isolation (`ZERO_FEATURE_INVENTION`)**: Standard orchestrators execute feature roadmaps authored by Mind. A standard orchestrator cannot have a blanket `ZERO_FEATURE_INVENTION` prohibition in its charter.
4. **Clean Auditing Topology**: A distinct archetype allows out-of-band `skill-auditor` to enforce strict compliance boundaries specific to optimization without false-alarm alerts on standard feature runs.

---

## Level 2: Strategic Constraints, Scope Boundaries, Non-Goals & Architectural Invariants

### 2.1 Mathematical Formalization of `ZERO_FEATURE_INVENTION`

To eliminate the "Trojan Horse" failure mode where an LLM disguises new capabilities as "ergonomic refactorings," the Optimizer-Orchestrator enforces the following mathematical invariant across all optimization tasks:

$$\text{PublicSymbols}_{\text{post}} \equiv \text{PublicSymbols}_{\text{pre}} \quad \land \quad \forall s \in \text{PublicSymbols}, \, \text{TypeSignature}(s)_{\text{post}} \equiv \text{TypeSignature}(s)_{\text{pre}}$$

$$\Delta \text{PublicAPI} = \emptyset \quad \land \quad \Delta \text{BehavioralSpecs} = \emptyset \quad \land \quad \Delta \text{StructuralMetrics} > 0$$

#### Falsifiable Boundary Invariants:

1. **Zero Public Interface Expansion & Deletion (`ZERO_PUBLIC_API_EXPANSION`)**:
   - The set of exported symbols (functions, classes, interfaces, types, CLI verbs, flags, endpoints) and their exact TypeScript type signatures must be strictly invariant before and after mutation.
   - Deleting existing public symbols is flagged as a breaking API mutation. Adding new public functions or optional parameters with new behaviors is flagged as an AST invariant breach (`FEATURE_INVENTION_BLUNDER`).
2. **Zero Behavioral Delta on Existing Tests (`ZERO_BEHAVIORAL_DELTA`)**:
   - Pre-existing test suites targeting the module (`*.test.ts`) are assigned **READ-ONLY** status.
   - `optimize:check-tests` executes a strict git diff check: **0 assertions (`expect()`, `assert()`) may be deleted, weakened, or commented out**.
   - Additive tests (`*.spec.ts`) introduced for extracted submodules must be pure structural/regression tests covering internal logic with 100% in-memory mocks.
3. **Mandatory Positive Structural Delta ($\Delta \text{StructuralMetrics} > 0$)**:
   - Every optimization lane must yield a measurable structural improvement:
     - Target file SLOC reduced to $\le 400$ lines.
     - TypeScript `any` count reduced to 0.
     - Elimination of wall-clock timers or network calls in tests.
     - Elimination of dead internal functions and cyclic dependencies.

### 2.2 Strategic Non-Goals

1. **Non-Goal 1: Greenfield Feature Conception**: The optimizer shall never formulate a plan that introduces new user-facing workflows, visual interfaces, public CLI verbs, or business capabilities.
2. **Non-Goal 2: Cosmetic Code Churn**: Renaming variables for stylistic preference, rearranging imports without circularity resolution, or reformatting files that already pass linting is strictly prohibited (`ANTI_MAKEWORK_SUPERVISORY_PURITY`).
3. **Non-Goal 3: Speculative Abstraction Bloat**: Creating generic factory wrappers, micro-interfaces for single-implementation classes, or multi-layered indirection that increases cognitive overhead is forbidden.
4. **Non-Goal 4: Test Assertion Weakening**: Weakening test assertions or increasing timeout tolerances to achieve false test passes is considered a fatal breach.

### 2.3 Structural Hierarchy Rules

- **Banned Parent: Mind**: `optimizer-orchestrator.yaml` defines `disallowed_parent: ["mind"]`. If Tier 0 Mind attempts to dispatch `optimizer-orchestrator`, harness rejects with `E_ILLEGAL_PARENT_DISPATCH`. Mind must only dispatch standard `orchestrator`.
- **Strict Tier 1 Standing**: Optimizer acts as Alpha driver when launched directly by human (`parent_agent_id: null` or human ID).
- **Four-Tier Confinement**: Dispatches Tier 2 Coordinators only (`spawns: ["coordinator"]`). Never dispatches Tier 3 Implementers or Validators directly.
- **Sole Companion Auditor**: Paired strictly with `skill-auditor` (`tier: 0`, forensics). Mind-auditor is prohibited from joining the session.
- **The Three Hard Zeros**: 0 direct source code edits, 0 unit test runs, 0 PR reviews on supervisory threads.

---

## Level 3: 8 Conceptual Failure Vectors & Internal Autonomous Scheduler Architecture

### 3.1 The 8 Conceptual Failure Vectors Expansion Matrix

| Failure Vector                            | Concrete Vulnerability in Optimizer-Orchestrator                                           | Architectural Defense & Mechanical Interlock                                                                                                                                                                                                                         |
| :---------------------------------------- | :----------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Empty States**                       | Zero plans in `docs/planning/` AND 0 modularity/purity violations in repo.                 | Transition to `Phase 4: QUIESCENT_STEADY_STATE`. Activate exponential backoff ($15\text{m} \rightarrow 6\text{h}$) with Zero-Delta Message Suppression.                                                                                                              |
| **2. Timeout Stagnation**                 | Tier 2 Coordinator or worker hangs on long-running test or unresolved circular type check. | Internal supervisory scheduler enforces a 15-minute lease watchdog. If an active task exhibits no mailbox IPC or worktree git commit within 15 minutes, trigger automated lease revocation (`task:reject --in-lease`) and Coordinator recycling.                     |
| **3. Concurrent Actor Mutation**          | Multiple workers refactoring shared dependencies mutate the same barrel export file.       | **Monolithic File Decomposition Rule**: Decomposition of a single file is confined to a single worktree. Brent parallel waves scale exclusively across mutually independent files.                                                                                   |
| **4. System Boundaries**                  | Host `schedule` command returns immediately; agent terminates or spins in busy loop.       | Non-blocking turn completion: agent schedules next supervisory tick via `schedule(DurationSeconds=300, Prompt="Autonomous Supervisory Tick", TimerCondition="any")` and immediately ends turn. System reactive wakeup resumes execution on schedule or on child IPC. |
| **5. Lifecycle Transitions**              | Plan in `docs/planning/` fails midway, leaving partial uncompiled code in tree.            | **Atomic Quarantine Transaction**: Cleans all worktrees, resets to clean git index, runs `tsc --noEmit` baseline verification, isolates to `QUARANTINED.md`, and transitions cleanly to Phase 2.                                                                     |
| **6. Invariant Breaches**                 | Implementer adds an optional param or helper method claiming "ergonomic refactoring."      | Mechanical gate `bun harness.ts optimize:check-ast`: compares pre- and post-mutation AST export tables. Any symbol expansion or signature mutation triggers instant task rejection and strike logging.                                                               |
| **7. Telemetry Gaps**                     | Optimization changes make performance worse or increase cyclomatic complexity silently.    | Mandatory pre/post empirical metrics in `docs/optimization/<target>/ANALYSIS.md`. Post-verification gate runs deterministic benchmarking script to prove non-negative performance delta.                                                                             |
| **8. Adversarial Misuse / Persona Drift** | Tier 0 Mind attempts to dispatch Optimizer-Orchestrator to bypass feature review.          | Harness-level parent interlock: `disallowed_parent: ["mind"]`. If parent is Mind, command `run:init` aborts with `E_ILLEGAL_PARENT_DISPATCH`. Optimizer can only be launched by human operator (`parent: null` / human).                                             |

### 3.2 Internal Autonomous Scheduler Architecture

The Optimizer-Orchestrator operates as a perpetual, self-sustaining autonomic engine without human intervention, while preventing zombie timers, task ID leaks, and token bleeding.

```
+----------------------------------------------------------------------------------------------------+
|                         INTERNAL SCHEDULER LIFECYCLE & STATE TRANSITIONS                           |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|    [Turn Ignition]                                                                                 |
|           |                                                                                        |
|           v                                                                                        |
|    +--------------+                                                                                |
|    | Active Mode  | <----+                                                                         |
|    |  Cadence: 5m |      | Work In-Flight / Plan Executing                                         |
|    +--------------+      |                                                                         |
|           |              |                                                                         |
|           | Repo Converged (Zero Plans, Zero Defects)                                              |
|           v              |                                                                         |
|    +--------------+      |                                                                         |
|    | Quiescent    | -----+ Code-Relevant Drift Detected (Source code mutated or new plan dropped)  |
|    | Standby Mode |                                                                                |
|    | Cadence: Exp |                                                                                |
|    | (15m -> 6h)  |                                                                                |
|    +--------------+                                                                                |
|           |                                                                                        |
|           | Quota < 10%                                                                            |
|           v                                                                                        |
|    +--------------+                                                                                |
|    | Quota Freeze | ---> Halt recurring cron, cancel host timer, preserve worktrees unstaged,      |
|    |  Suspension  |      enter zero-cost IDLE. Resume on single Auto-Wake Sentinel notification.   |
|    +--------------+                                                                                |
+----------------------------------------------------------------------------------------------------+
```

#### Dual-Cadence State Engine

1. **Active Supervisory Cadence (5 Minutes / `DurationSeconds=300`)**:
   - Used during Phase 1 (`PLAN_EXECUTION`), Phase 2 (`OPTIMIZATION_ANALYSIS`), and Phase 3 (`OPTIMIZATION_DISPATCH`).
   - Every 5 minutes, the scheduler triggers a supervisory tick:
     - Polls mailbox IPC for coordinator updates (`bun harness.ts msg:poll`).
     - Inspects active worktree leases and checks for stalled workers (`bun harness.ts health`).
     - Dispatches ready wave lanes under Brent Work/Span ($P = \lceil W / S \rceil$).
2. **Quiescent Standby Cadence (Exponential Backoff: $15\text{m} \rightarrow 30\text{m} \rightarrow 1\text{h} \rightarrow 2\text{h} \rightarrow 6\text{h}$)**:
   - Entered in Phase 4 when all roadmaps are cleared and no files violate modularity/purity limits.
   - Executes `optimize:check-drift` on wake with the Code-Relevant Path Filter.
   - If drift is 0 or non-code changes are detected, concludes turn immediately ($< 200$ tokens per tick).
   - If code-relevant drift $> 0$, resets cadence to 5 minutes and transitions to Phase 1 or 2.

#### Host-Native Task Lifecycle & Quota Elasticity

- The agent directly manages host timers via `schedule` and `manage_task(Action: 'kill')`. The disk state ledger (`.olt/capsules/<run_id>/state.json`) purely records `active_scheduler_task_id`.
- When quota drops below 10%, the agent halts background crons, records coordinates in `.olt/quota-dag-snapshot.json`, leaves worktrees unstaged, and enters zero-cost IDLE until the host auto-wake sentinel fires (`QUOTA_FREEZE_ZERO_KILL_RESUME`).

---

## Level 4: Modular Domain Decomposition & The Deterministic 4-Phase FSM

### 4.1 The Deterministic 4-Phase State Machine

```
       +-------------------------------------------------------------+
       |                                                             |
       v                                                             |
+--------------+      Roadmaps Empty      +-----------------------+  |
|   PHASE 1:   | -----------------------> |       PHASE 2:        |  |
|     PLAN     |                          | OPTIMIZATION ANALYSIS |  |
|  EXECUTION   | <----------------------- |  (Empirical Baseline) |  |
+--------------+     New Plan Dropped     +-----------------------+  |
       |                                              |              |
       | Corrupted Plan                               | Targets      |
       | (Quarantine / Escalate)                      | Discovered   |
       v                                              v              |
+--------------+                          +-----------------------+  |
|  QUARANTINE  |                          |       PHASE 3:        |  |
|  ESCALATION  |                          | OPTIMIZATION DISPATCH |  |
+--------------+                          |  (Tier 2 Supervision) |  |
                                          +-----------------------+  |
                                                      |              |
                                                      | Wave Done    |
                                                      v              |
                                          +-----------------------+  |
                                          |       PHASE 4:        |  |
                                          |   QUIESCENT STEADY    | -+
                                          |         STATE         |
                                          +-----------------------+
```

#### Phase 1: `PLAN_EXECUTION` (Plan Drainage & Continuation)

- **Canonical Target Filter**: A directory in `docs/planning/` is only admitted if it contains `PLAN.md` adhering to the Canonical 8-Level Plan Architecture (`plan:audit` passes).
- **Deterministic Priority Sorting**: Admitted plans are sorted by priority (`P0 > P1 > P2 > P3`) with lexicographical directory slug tie-breaking.
- **Atomic Archival Transaction**: Upon clean convergence, move plan directory from `docs/planning/<slug>/` to `docs/archive/completed-plans/<slug>/` and stage in Conventional Commit.
- **Atomic Quarantine Rollback (`optimize:quarantine`)**: If a plan encounters unresolvable defects after 2 retry cycles:
  1. Aborts child worktrees cleanly (`worktree:clean`).
  2. Restores clean git index (`git checkout main; git clean -fd`).
  3. Verifies whole-repo compiler health (`tsc --noEmit`).
  4. Moves plan to `docs/planning/<slug>/QUARANTINED.md` with defect SHA and failure logs.
  5. Advances immediately to next ready plan or Phase 2.

#### Phase 2: `OPTIMIZATION_ANALYSIS` (Empirical Baseline Discovery)

- Runs `bun harness.ts optimize:scan` across codebase when `docs/planning/` is drained.
- Evaluates files against the **5 Optimization Pillars**:
  1. _Modularity_: Files exceeding 400 SLOC (enforcing semantic cohesion and acyclic sub-graphs).
  2. _Purity_: Tests with wall-clock timers, network I/O, or raw daemons.
  3. _Type Safety_: Lingering `any` types, suppressions, or double-casts (`as unknown as`).
  4. _Hot-Path Latency_: Excessive sequential I/O or redundant allocations.
  5. _Ergonomics_: Dead private utilities and internal duplicates.
- Generates machine-parsable `docs/optimization/<target>/ANALYSIS.md`. If 0 candidate files exist, transitions to Phase 4.

#### Phase 3: `OPTIMIZATION_DISPATCH` (Tier 2 Supervision)

- Dispatches Tier 2 Coordinators to execute the analysis plan.
- **Monolithic File Decomposition Invariant**: Extractions of a single monolithic file are confined to **one single isolated worktree lane** to prevent cross-worktree import deadlocks.
- Parallel Brent waves scale exclusively across mutually independent files ($P = \lceil W / S \rceil$).
- Real-time preemption: If `skill-auditor` sends `severity: fatal` finding via Mailbox IPC, immediately preempt lane via `task:reject --in-lease`, clean worktree, and log Coordinator strike.

#### Phase 4: `QUIESCENT_STEADY_STATE` (Zero-Token Standby)

- Entered when 0 plans exist in `docs/planning/` and 0 files violate optimization limits.
- Scheduler operates on exponential backoff ($15\text{m} \rightarrow 6\text{h}$).
- Wakes execute `bun harness.ts optimize:check-drift`. Uses Code-Relevant Path Filter to ignore non-plan markdown and git hygiene updates. Concludes turn with $< 200$ tokens if drift is 0.

### 4.2 Mandatory 6-Section Schema for `ANALYSIS.md`

All analysis artifacts in `docs/optimization/<target>/ANALYSIS.md` must adhere to this machine-parsable schema:

```markdown
# Optimization Analysis: <target_file_path>

## 1. Empirical Baseline Metrics

- Target File: `<path>`
- Source Lines of Code (SLOC): `<number>`
- Cyclomatic Complexity (Max / Avg): `<number> / <number>`
- TypeScript `any` Count: `<number>`
- Compiler Suppressions (`@ts-ignore`, `@ts-expect-error`): `<number>`
- Unit Test Execution Baseline: `<duration_ms>`
- Memory / Allocation Footprint: `<metric_or_N/A>`

## 2. Inbound & Outbound Coupling Map

- Inbound Consumers (Callers):
  - `<consumer_file_1>`: imports `[<symbols>]`
  - `<consumer_file_2>`: imports `[<symbols>]`
- Outbound Dependencies:
  - `<dependency_1>`
- Circular Dependency Check: `CLEAN (0 cycles detected)`

## 3. Submodule Decomposition Topology

- Single-Worktree Isolation: `CONFIRMED`
- Planned Submodules (All Projected <= 400 SLOC):
  - `<submodule_1.ts>`: `<estimated_sloc>` SLOC — Responsibility: `<exact_domain>`
  - `<submodule_2.ts>`: `<estimated_sloc>` SLOC — Responsibility: `<exact_domain>`
- Original Stub Strategy: `<target_file_path>` retained as barrel re-exporting all symbols.

## 4. Public API Surface Lock

- Invariant: Zero Public Interface Expansion & Zero Behavioral Delta
- Exported Symbols Table:
  | Symbol Name | Symbol Type             | Pre-Mutation Type Signature | Post-Mutation Type Signature |
  | :---------- | :---------------------- | :-------------------------- | :--------------------------- |
  | `<symbol>`  | `<function/class/type>` | `<exact_ts_signature>`      | `<exact_ts_signature>`       |
- Public API Delta: `EMPTY_SET`

## 5. Verification & Test Gate Specification

- Existing Test Leases: `READ_ONLY` (`<existing_test_files>`)
- Assertion Deletion Gate: `bun harness.ts optimize:check-tests --target <dir>` (0 deletions allowed)
- Additive Specification Tests:
  - `<new_submodule_1.spec.ts>`: In-memory mock tests asserting I/O equivalence.
- Static Compilation Gate: `tsc --noEmit` (0 errors, 0 warnings).

## 6. Rollback & Abort Thresholds

- Compilation failure after 2 implementer repair cycles.
- Any detected AST export table mutation (`optimize:check-ast` fails).
- Assertion deletion detected in existing test suite.
- Atomic Abort Action: `bun harness.ts optimize:quarantine --plan <slug>`
```

---

## Level 5: Interaction Dynamics, Topological DAG & Brent Concurrency Waves

### 5.1 The Corrected 8-Task Wave 1 Bootstrapping DAG

To establish the runtime engine for `optimizer-orchestrator`, Wave 1 implements the 6 foundational CLI commands, the CLI registry wiring, and the agent manifest. Every task is strictly bounded to $1-2$ files ($\le 400$ lines).

```
+----------------------------------------------------------------------------------------------------+
|                               CORRECTED WAVE 1 TOPOLOGICAL EXECUTION DAG                           |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [Wave 1A: Parallel Disjoint Implementation - P = 6]                                              |
|                                                                                                    |
|  Lane 1: W1-T1 (optimize:scan) ------------> scan.ts & scan.test.ts                                |
|  Lane 2: W1-T2 (optimize:analyze) ---------> analyze.ts & analyze.test.ts                          |
|  Lane 3: W1-T3 (optimize:check-ast) -------> check-ast.ts & check-ast.test.ts                      |
|  Lane 4: W1-T4 (optimize:check-tests) -----> check-tests.ts & check-tests.test.ts                  |
|  Lane 5: W1-T5 (optimize:quarantine) ------> quarantine.ts & quarantine.test.ts                    |
|  Lane 6: W1-T6 (optimize:check-drift) -----> drift.ts & drift.test.ts                              |
|                         |                                                                          |
|                         +-----------------------+                                                  |
|                                                 | (All 6 Wave 1A Verification Gates Green)         |
|                                                 v                                                  |
|  [Wave 1B: Parallel Registry & Manifest Integration - P = 2]                                      |
|                                                                                                    |
|  Lane 7: W1-T7 (CLI Registry & Router) ----> registry/optimize.ts & registry/index.ts            |
|  Lane 8: W1-T8 (Agent Manifest & Role) ----> optimizer-orchestrator.yaml & roles/opt-orch.md       |
+----------------------------------------------------------------------------------------------------+
```

#### Task Allocation Table ($1-2$ Files Per Task):

| Task ID   | Task Title                              | Exact Write Scope ($1-2$ Files)                                                                 | Dependencies | Verification Gate (`task:check`)                                                                                                                                                                                                                |
| :-------- | :-------------------------------------- | :---------------------------------------------------------------------------------------------- | :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W1-T1** | Implement `optimize:scan` Engine        | `src/cli/commands/optimize/scan.ts`<br>`tests/cli/commands/optimize/scan.test.ts`               | None         | `bun test tests/cli/commands/optimize/scan.test.ts` && `tsc --noEmit`                                                                                                                                                                           |
| **W1-T2** | Implement `optimize:analyze` Generator  | `src/cli/commands/optimize/analyze.ts`<br>`tests/cli/commands/optimize/analyze.test.ts`         | None         | `bun test tests/cli/commands/optimize/analyze.test.ts` && `tsc --noEmit`                                                                                                                                                                        |
| **W1-T3** | Implement `optimize:check-ast` Gate     | `src/cli/commands/optimize/check-ast.ts`<br>`tests/cli/commands/optimize/check-ast.test.ts`     | None         | `bun test tests/cli/commands/optimize/check-ast.test.ts` && `tsc --noEmit`                                                                                                                                                                      |
| **W1-T4** | Implement `optimize:check-tests` Gate   | `src/cli/commands/optimize/check-tests.ts`<br>`tests/cli/commands/optimize/check-tests.test.ts` | None         | `bun test tests/cli/commands/optimize/check-tests.test.ts` && `tsc --noEmit`                                                                                                                                                                    |
| **W1-T5** | Implement `optimize:quarantine` Engine  | `src/cli/commands/optimize/quarantine.ts`<br>`tests/cli/commands/optimize/quarantine.test.ts`   | None         | `bun test tests/cli/commands/optimize/quarantine.test.ts` && `tsc --noEmit`                                                                                                                                                                     |
| **W1-T6** | Implement `optimize:check-drift` Engine | `src/cli/commands/optimize/drift.ts`<br>`tests/cli/commands/optimize/drift.test.ts`             | None         | `bun test tests/cli/commands/optimize/drift.test.ts` && `tsc --noEmit`                                                                                                                                                                          |
| **W1-T7** | Wire CLI Registry & Router              | `src/cli/registry/optimize.ts`<br>`src/cli/registry/index.ts`                                   | W1-T1..T6    | `bun harness.ts optimize:scan --help` && `tsc --noEmit`                                                                                                                                                                                         |
| **W1-T8** | Author Agent Manifest & Role Contract   | `olt/agents/optimizer-orchestrator.yaml`<br>`olt/roles/optimizer-orchestrator.md`               | W1-T1..T6    | `bun -e "import { parseUnifiedAgentManifest } from './scripts/src/authority/manifest-schema.ts'; import * as fs from 'fs'; parseUnifiedAgentManifest(fs.readFileSync('agents/optimizer-orchestrator.yaml', 'utf8'));" && bun harness.ts doctor` |

### 5.2 Brent Work/Span Concurrency Metrics

- **Total Work ($W$)**: 8 tasks.
- **Critical Path Span ($S$)**: 2 stages (Wave 1A parallel stage + Wave 1B parallel integration stage).
- **Concurrency Metric ($P$)**:
  $$P = \lceil W / S \rceil = \lceil 8 / 2 \rceil = 4$$
- **Theoretical Max Speedup**: $\frac{W}{S} = \frac{8}{2} = 4.0\times$.
- **Disjointness Audit**:
  - In Wave 1A: All 6 tasks operate on disjoint files under `src/cli/commands/optimize/` and `tests/cli/commands/optimize/`.
  - In Wave 1B: W1-T7 touches CLI routing (`src/cli/registry/`), while W1-T8 touches agent configuration (`olt/agents/` and `olt/roles/`). `detectScopeOverlap` returns 0 collisions.

### 5.3 Token-Efficient Output Contract & Evidence Storage

- Default stdout line limit: $\le 30$ lines of Unicode/ANSI summary table.
- Full structured diagnostics written to `.olt/capsules/<run_id>/evidence/optimize-<cmd>.json`.
- The `--json` flag is reserved for machine piping; zero token bleed into interactive reasoning streams.

---

## Level 6: Fast Incremental Verification Gates & Runtime Contracts

Every task lane is governed by deterministic, sub-second mechanical gates:

1. **Incremental Compilation Gate**:
   `tsc --noEmit` executes across the affected workspace, guaranteeing zero syntax or type regressions.
2. **Type Safety & AST Invariant Audit**:
   `0 any`, `0 @ts-ignore`, `0 @ts-expect-error`, and 0 double-casts (`as unknown as T`).
3. **Hermetic Test Gate**:
   All tests in `tests/cli/commands/optimize/` run isolated via `bun test` in $< 500\text{ms}$ with 0 network calls and 0 wall-clock sleeps.
4. **Doctor Pre-Completion Check**:
   Before completing any run, `bun harness.ts doctor` verifies zero stale git locks, clean worktrees, and zero unapproved files in repository root.
5. **Agent Manifest Schema Gate**:
   Validates `optimizer-orchestrator.yaml` via in-process `parseUnifiedAgentManifest()`.

---

## Level 7: Adversarial Counterfactual Falsifiability Probes (AGP Matrix)

To guarantee that verification gates are counterfactually falsifiable and cannot pass vacuously, the following mutation probes are verified:

| Task ID   | Component Under Test   | Counterfactual Mutation Probe                                                 | Expected Gate Behavior                                                                                                               |
| :-------- | :--------------------- | :---------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **W1-T1** | `optimize:scan`        | Target file has 399 lines vs. 401 lines.                                      | 399 lines passes as Clean; 401 lines triggers Actionable report.                                                                     |
| **W1-T1** | `optimize:scan`        | Test contains `setTimeout(fn, 100)`.                                          | Scanner flags Test Impurity with line reference and non-zero exit.                                                                   |
| **W1-T2** | `optimize:analyze`     | Proposed submodules have cyclic import (`a` imports `b`, `b` imports `a`).    | Generator aborts with `CIRCULAR_EXTRACTION_FAILURE` and writes 0 files.                                                              |
| **W1-T3** | `optimize:check-ast`   | Function signature mutated: `fn(): Promise<void>` $\rightarrow$ `fn(): void`. | Aborts with `SIGNATURE_MUTATION_BREACH`. Task rejected.                                                                              |
| **W1-T3** | `optimize:check-ast`   | Code contains `as unknown as MyType`.                                         | Aborts with `TYPE_SAFETY_EVASION_BREACH`. Task rejected.                                                                             |
| **W1-T4** | `optimize:check-tests` | Git diff deletes a line containing `expect(result).toBe(true)`.               | Aborts with `ASSERTION_DELETION_BREACH`. Gate fails with exit 1.                                                                     |
| **W1-T5** | `optimize:quarantine`  | Worktree has dirty uncommitted files + failing `tsc`.                         | Aborts active lane, runs `worktree:clean`, restores clean `main`, verifies `tsc --noEmit` clean, and moves plan to `QUARANTINED.md`. |
| **W1-T6** | `optimize:check-drift` | Git HEAD modified by `README.md` update only.                                 | Prints `Drift: 0 (Quiescent Ignored)` and exits with status 0.                                                                       |
| **W1-T6** | `optimize:check-drift` | New executable plan added: `docs/planning/cache/PLAN.md`.                     | Prints `Drift: 1 (New Plan Detected)` and exits with status 1.                                                                       |
| **W1-T7** | CLI Router             | Invoke `bun harness.ts optimize:invalid-verb`.                                | Fails with exit 1, rendering suggested commands without crash.                                                                       |
| **W1-T8** | Manifest Validator     | Manifest missing `instructions` or invalid `tier`.                            | `parseUnifiedAgentManifest` throws `ZodError`, gate fails.                                                                           |

---

## Level 8: Master Plan Sealing, Archival Invariants & Release Topology

### 8.1 Plan Execution & Archival Invariants

1. **Storage Location**: This master plan is sealed in `docs/planning/optimizer-orchestrator/PLAN.md`.
2. **Archival Mandate**: Upon complete execution and verification of Wave 1, this plan directory must be atomically moved:
   $$\text{mv } \text{docs/planning/optimizer-orchestrator} \longrightarrow \text{docs/archive/completed-plans/optimizer-orchestrator}$$
3. **Conventional Commit Topology**:
   - Commits for Wave 1 tasks must adhere to Conventional Commits:
     - `feat(optimize): implement scan CLI command (W1-T1)`
     - `feat(optimize): implement analyze generator (W1-T2)`
     - `feat(optimize): implement check-ast invariant gate (W1-T3)`
     - `feat(optimize): implement check-tests assertion gate (W1-T4)`
     - `feat(optimize): implement quarantine rollback transaction (W1-T5)`
     - `feat(optimize): implement drift code-relevant check (W1-T6)`
     - `feat(cli): wire optimize command registry and router (W1-T7)`
     - `feat(agents): author optimizer-orchestrator manifest and role contract (W1-T8)`
     - `chore(plan): archive completed optimizer-orchestrator plan`

### 8.2 Final Manifest Blueprint (`olt/agents/optimizer-orchestrator.yaml`)

```yaml
name: "optimizer-orchestrator"
role: "optimizer-orchestrator"
tier: 1
provider:
  - antigravity
  - agy
  - claude
  - codex
  - cursor
  - generic
tools:
  enable_subagent_tools: true
  enable_write_tools: false
interface:
  display_name: "Tier 1 Autonomous Optimizer & Maintenance Orchestrator"
  short_description: "Alpha autonomous driver for backlog drainage and zero-feature in-scope codebase hardening"
communication_contract:
  mandatory_turn_completion_actions:
    - "doctor:verify"
  protocol: "mailbox_ipc"
  mailbox_path: ".olt/mailboxes/{agent_id}/"
  lock_path: ".olt/locks/mailboxes/{agent_id}.lock"
  allowed_channels:
    - "msg:send"
    - "msg:recv"
    - "msg:poll"
  ban_raw_jsonl_reading: true
  forbid_native_messaging: true
dispatch_contract: "zero_exploration_exact_anchor"
mandatory_turn1_actions:
  - "run:init"
authority: "alpha"
disallowed_parent:
  - "mind"
allowed_companion:
  - "skill-auditor"
permissions:
  may:
    - "Mandatory Pre-Completion Doctor Verification: Before completing any run, delivering any task handoff, or marking a wave completed, execute `bun harness.ts doctor --run <capsule>` and verify that `Healthy: yes`."
    - "Act as standalone Alpha top-level driver when parent_agent_id is null or human operator, bypassing Tier 0 Mind entirely."
    - "Maintain and execute an internal autonomous supervisory heartbeat via host `schedule` (DurationSeconds=300, TimerCondition='any') across active execution phases."
    - "Drain and execute pre-existing canonical roadmaps in `docs/planning/` via Tier 2 Domain Coordinators, strictly observing P0-P3 priority ordering."
    - "Atomically archive completed plan directories from `docs/planning/<slug>/` to `docs/archive/completed-plans/<slug>/` upon round convergence."
    - "Execute atomic quarantine rollback transactions (`bun harness.ts optimize:quarantine`) on corrupted or unresolvable plans."
    - "Autonomously transition into Systematic In-Scope Optimization upon complete drainage of `docs/planning/`, scanning codebase for modularity, purity, and type defects."
    - "Author structured empirical optimization analysis documents in `docs/optimization/<target>/ANALYSIS.md` prior to dispatching refactoring waves."
    - "Dispatch and supervise Tier 2 Domain Coordinators across isolated worktrees, enforcing the Monolithic File Decomposition Rule and module-level Brent Work/Span concurrency."
    - "Ingest out-of-band forensic telemetry from companion `skill-auditor` via Mailbox IPC and execute real-time in-flight lane preemption on fatal findings."
    - "Transition into Quiescent Steady State with exponential backoff ($15m -> 6h) when zero roadmaps and zero code defects exist, executing zero-token drift checks."
    - "Suspend background scheduler crons and enter zero-cost IDLE upon Quota Freeze (<10%), preserving worktrees without killing subagents."
    - "Execute final repository releases, conventional git commits, and git pushes on its dedicated background finalization thread."
  must_not:
    - "Propose, author, or implement new user-facing features, speculative APIs, or expanded product scope (Zero Feature Invention Invariant)."
    - "Permit public API surface expansion or type signature mutation during optimization waves (Exports_post === Exports_pre)."
    - "Delete, relax, or weaken existing test assertions in `*.test.ts` during optimization lanes."
    - "Use TypeScript `any`, `@ts-ignore`, `@ts-expect-error`, or double-casts (`as unknown as T`)."
    - "Split a single monolithic file across multiple parallel git worktrees (Monolithic File Decomposition Invariant)."
    - "Perform direct code edits, direct test runs, or direct PR reviews (The Three Hard Zeros)."
    - "Deploy Tier 3 workers (Implementers, Validators) directly; must dispatch Tier 2 Coordinators only."
    - "Use native host send_message tool or bypass mailbox IPC; all inter-agent traffic flows through bun harness.ts msg:send."
    - "Attempt to kill host platform timers via child shell scripts; must use host `manage_task` directly."
    - "Accept deployment from Tier 0 Mind (disallowed_parent: ['mind'])."
    - "Read or parse raw .jsonl files directly."
  commands:
    - "run:init"
    - "agent:brief"
    - "agent:register"
    - "agent:release"
    - "agent:list"
    - "task:brief"
    - "task:check"
    - "run:complete"
    - "doctor"
    - "msg:send"
    - "msg:recv"
    - "msg:poll"
    - "worktree:create"
    - "worktree:list"
    - "worktree:clean"
    - "worktree:status"
    - "worktree:reclaim"
    - "whoami"
    - "recover"
    - "summary:view"
    - "summary:export"
    - "finding:get"
    - "evidence:get"
    - "optimize:scan"
    - "optimize:analyze"
    - "optimize:check-ast"
    - "optimize:check-tests"
    - "optimize:quarantine"
    - "optimize:check-drift"
  spawns:
    - "coordinator"
invariants:
  - "SUPERVISOR_ZERO_CODE_EDITS"
  - "SUPERVISOR_ZERO_TEST_RUNS"
  - "ZERO_FEATURE_INVENTION"
  - "ZERO_PUBLIC_API_EXPANSION"
  - "ZERO_BEHAVIORAL_DELTA"
  - "MONOLITHIC_FILE_DECOMPOSITION"
  - "BRENT_MODULE_CONCURRENCY"
  - "REAL_TIME_AUDITOR_PREEMPTION"
  - "QUIESCENT_ZERO_TOKEN_DRIFT"
  - "QUOTA_FREEZE_ZERO_KILL_RESUME"
protocol:
  role_contract: "roles/optimizer-orchestrator.md"
  cli: "bun ~/.agents/skills/olt/scripts/harness.ts"
  zero_json: true
instructions: |
  # Operational Mandate: Autonomous In-Scope Optimizer & Hardener
  You are the Tier 1 Optimizer-Orchestrator, the autonomous Alpha driver for codebase stabilization, backlog drainage, and systematic in-scope optimization. You operate exclusively when invoked directly by a human or top-level scheduler, completely bypassing Tier 0 Mind and Mind-Auditor. You are paired with Skill-Auditor as your sole companion.

  # The Three Hard Zeros
  You strictly observe the Three Hard Zeros: 0 direct code edits, 0 unit test executions, and 0 PR reviews. All mutations occur strictly in isolated git worktrees dispatched to Tier 2 Coordinators and Tier 3 Implementers.

  # Zero Feature Invention & Public API Lock
  You are strictly prohibited from conceiving, authoring, or implementing new user-facing features, speculative CLI verbs, or expanded product surface. During all optimization waves, you enforce:
    Exports(target)_post === Exports(target)_pre
    TypeSignature(symbol)_post === TypeSignature(symbol)_pre
  Any addition or deletion of public symbols is an automatic FATAL strike.

  # The Deterministic 4-Phase FSM
  - Phase 1 (Plan Execution): Drain pre-existing roadmaps in `docs/planning/` via Tier 2 Coordinators in strict P0-P3 priority order. Upon convergence, atomically move completed plans to `docs/archive/completed-plans/<slug>/`. If a plan fails 2 retry cycles, execute atomic quarantine via `optimize:quarantine`.
  - Phase 2 (Optimization Analysis): When `docs/planning/` is cleared, execute `optimize:scan`. If targets exceeding 400 SLOC or purity/type defects exist, generate `docs/optimization/<target>/ANALYSIS.md` with empirical baselines. If 0 targets exist, transition directly to Phase 4.
  - Phase 3 (Optimization Dispatch): Dispatch Tier 2 Coordinators to execute the analysis plan. Enforce the Monolithic File Decomposition Rule: extractions of a single file must occur within a single isolated worktree. Leverage Brent Work/Span concurrency across mutually independent files.
  - Phase 4 (Quiescent Steady State): When zero roadmaps and zero code defects exist, activate exponential backoff (15m -> 6h). Execute `optimize:check-drift` on wake. If non-code changes or zero drift are detected, conclude turn immediately with zero token bleed.

  # Auditor Interoperability & Real-Time Preemption
  Poll mailbox IPC every supervisory tick. If Skill-Auditor sends a finding with severity: fatal, immediately preempt the affected lane via `task:reject --in-lease`, clean the worktree, and log a strike against the Coordinator.

  # Platform Scheduler & Quota Invariant
  Manage host timers using host `manage_task` and `schedule(TimerCondition="any")`. Never attempt to cancel host tasks from bash scripts. If quota < 10%, halt crons, enter IDLE state, preserve worktrees unstaged, and await host auto-wake.
```
