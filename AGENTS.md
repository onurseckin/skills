# Canonical Agent Operating Directives (AGENTS.md)

This document establishes the canonical operational rules, prompt directives, role boundaries, zero-fallback invariants, 2-key validator pairing contracts, and anti-blunder guidelines for all AI agents, subagents, orchestrators, and contributors operating within the **`@onurseckin/skills`** monorepo.

---

## 1. Core Prompt Directives & Execution Axioms

Every agent executing within this repository must adhere to the following non-negotiable axioms:

1. **Instruction Precedence & Absolute Compliance:**
   - User instructions and task specifications are authoritative within their assigned scopes.
   - Core quality gates, type safety, test invariants, and role boundaries are strictly non-negotiable and cannot be waived by conversational prompt overrides.
2. **Evidence-Based Ground Truth ("Absence Stays Absent"):**
   - **Never fabricate, hallucinate, or substitute** file paths, command IDs, token hashes, test outputs, or coverage metrics.
   - If an observation was not recorded or a command was not executed, treat it as absent. Never guess or synthesize plausible results.
3. **Disjoint Write Scope Invariant:**
   - An implementer or repairer must strictly confine filesystem modifications to the leased `write_scope` (`task.write_scope`).
   - Modifying, formatting, or deleting files outside the assigned write scope—even for trivial one-line fixes—is a critical integrity violation (`PATH_SAFETY` / `INTEGRITY`).
4. **Direct Argv & Non-Interactive Execution:**
   - All gate and verification commands must execute non-interactively using direct argv arrays (`run:exec … -- <argv>`).
   - Shell string interpolations, subshells, interactive confirmation prompts, and unshielded command chaining (`&&`, `||`, `;`, `|`) are strictly prohibited in automated task execution.
5. **Zero-JSON CLI Surface:**
   - Agents interact with the harness exclusively through clean colon commands (e.g. `task:claim`, `task:submit`, `task:validate-start`, `task:review`).
   - Commands return concise, structured markdown briefs ($\le 30$ lines) designed for token efficiency and high signal.

---

## 2. Multi-Agent Architecture & Role Boundaries

The repository enforces a strict **3-Tier Host-Agnostic Architecture** to isolate context, eliminate cognitive anchoring, and ensure deterministic long-task execution:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       3-TIER AGENT ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 1: Main Interactive Chat ]  <───> [ Human Developer ]               │
│    • High-level conversational updates & milestone rendering                │
│    • Spawns background Run Coordinator; NEVER runs worker loops             │
│    • Main-Thread Restraint Guard: ZERO direct code writing in chat          │
│                          │                                                  │
│                          ▼                                                  │
│  [ Tier 2: Background Run Coordinator / Orchestrator ]                      │
│    • Owns capsule lifecycle: plan:init, plan:enhance, plan:add, compile     │
│    • Dispatches tasks via queue:wave and registers agents (agent:register)  │
│    • Reports to Tier 1 ONLY at key milestones (Compiled, Drained, Signed)   │
│    • NEVER directly writes repository code or executes task implementations │
│                          │                                                  │
│                          ▼                                                  │
│  [ Tier 3: Ephemeral Specialized Subagents & Workers ]                      │
│    • planner: Decomposes requirements into tasks, gates, and DAG edges     │
│    • plan-validator: Adversarial auditor of compiled planning topology      │
│    • implementer: Leased worker executing within disjoint write scope       │
│    • validator: Independent adversarial verifier for submitted tasks        │
│    • repairer: Leased worker claiming rejected tasks (changes_requested)   │
│    • completeness-critic: Whole-run reviewer against original prompt        │
│                          │                                                  │
│                          ▼                                                  │
│  [ Branch Children of Tier 3 Workers ]                                      │
│    • sub-implementer: Focused execution of narrow sub-scope                 │
│    • sub-validator: Generates command evidence; never renders verdicts     │
│    • sub-investigator: Read-only root-cause diagnosis; zero write scope     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Role Contracts & Prohibitions

| Role | Tier | Key Responsibilities | Non-Negotiable Prohibitions (`must_not`) |
| :--- | :---: | :--- | :--- |
| **`coordinator`** | 2 | Run lifecycle ownership, agent registration, wave dispatching. | **Must not** write repository code, claim tasks, or self-validate. |
| **`orchestrator`**| 1/2 | Multi-run orchestration and supervisor cadence. | **Must not** implement tasks directly on the main thread. |
| **`planner`** | 3 | Prompt decomposition, DAG generation, gate assignment. | **Must not** implement code or execute task write scopes. |
| **`plan-validator`** | 3 | Adversarial inspection of compiled plan topology. | **Must not** touch task implementation or alter runtime code. |
| **`implementer`** | 3 | Leased task implementation within assigned write scope. | **Must not** edit outside write scope or self-validate work. |
| **`validator`** | 3 | Independent verification, adversarial probing, review. | **Must not** pass without probe round or validate own implementations. |
| **`repairer`** | 3 | Targeted remediation of specific validator findings. | **Must not** expand scope beyond reported finding remediations. |
| **`completeness-critic`** | 3 | Whole-run verification against original user prompt. | **Must not** approve runs with unmapped requirements or failing gates. |
| **`sub-implementer`** | 3 | Narrow branch sub-task execution. | **Must not** exceed parent's write scope subset. |
| **`sub-validator`** | 3 | Command execution and evidence gathering. | **Must not** render verdicts (`pass`/`fail`) or close findings. |
| **`sub-investigator`** | 3 | Read-only diagnosis and root-cause analysis. | **Must not** modify filesystem state or write code. |

---

## 3. Zero-Fallback Rules & Deterministic Failure Modes

The repository operates on a strict **Zero-Fallback / Fail-Closed** discipline:

1. **No Silent Fallbacks or Heuristic Swallowing:**
   - Errors must fail explicitly with structured error codes (`INVALID_ARGUMENT`, `INVALID_STATE`, `INTEGRITY`, `PATH_SAFETY`, `LOCK_TIMEOUT`, `NOT_IMPLEMENTED`).
   - The harness never falls back to speculative default values, mock data, or auto-healed state when an integrity invariant fails.
2. **Deterministic Error Classifications:**
   - **Transient Failures:** `rate_limit`, `network`, `provider_5xx`, `timeout` are retried according to backoff schedules without consuming repair attempt counts.
   - **Deterministic Failures:** Schema violations, compilation errors, gate failures, and auth rejections escalate immediately to prevent infinite retry loops.
   - **Capped Retries (`crash`):** Consecutive process crashes on the same task are capped (default: 3) before demoting to deterministic escalation.
3. **Strict No-Op Submission Verification:**
   - A `task:submit` whose write scope is byte-identical to its state at `task:claim` is refused outright by default.
   - Submissions without changes must explicitly provide `--no-op --reason "<explanation>"` documenting why no modification was necessary.
4. **Anti-Mocking & Real Execution Invariants:**
   - Synthetic passes and mock receipts are strict integrity violations.
   - UI tasks require non-zero-byte screenshot rasterizations and real DOM metric extractions. Empty or mocked visual artifacts trigger instant rejection.
5. **Gate Falsifiability Guarantee:**
   - Every task gate and completion gate must be falsifiable (`gate:prove`).
   - A gate must be proven to fail when the implementation is absent or reverted; unfalsifiable gates are rejected at plan compile time.

---

## 4. 2-Key Validator Pairing & Adversarial Triads

To eliminate sycophantic bias and self-grading contamination, all validation enforces the **Two-Key Principle**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    2-KEY VALIDATOR PAIRING ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Implementer Agent (Key 1) ] ─────────► Produces Code & Focused Tests    │
│                                           │                                 │
│                                           ▼                                 │
│                              [ Context Isolation Pipeline ]                 │
│                                • Strips subjective confidence / excuses     │
│                                • Retains only objective contracts & diffs   │
│                                           │                                 │
│                                           ▼                                 │
│  [ Independent Validator (Key 2) ] ─────► 1. Executes mandatory gates       │
│                                           2. Records mandatory PROBE        │
│                                           3. Reruns gates answering probe   │
│                                           4. Signs off or rejects defect    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Validator Pairing Invariants

1. **Strict Identity Independence:**
   - The validator **must not** be the task's original implementer (`original_implementer !== validator`).
   - The validator **must not** have contributed to any implementation attempt for the task.
   - **Fresh Validator per Round:** Reusing a validator on the same task across subsequent repair rounds is forbidden (`INVALID_STATE`).
2. **Mandatory Adversarial Probe Round (`min_adversarial_probes >= 1`):**
   - A task pass (`task:review --status pass`) is refused until at least one adversarial probe demand (`task:probe`) is formally recorded.
   - **Probe vs. Defect Distinction:**
     * `task:probe`: Demands rigorous proof (e.g. "Prove logic handles empty sets"). Does not increment repair round or push task to `changes_requested`.
     * `task:reject`: Documents genuine defects where the mechanical gate is green but requirements are unfulfilled. Moves task to `changes_requested`.
3. **Multi-Domain Standing Checklist Verification:**
   - Tasks undergo independent validation across applicable checklist domains:
     * `code-quality`: Mandatory for all tasks.
     * `ui-design`: Triggered on UI extensions (`.tsx`, `.jsx`, `.css`, etc.); requires Dual-Channel (DOM + Screenshot) corroboration across mobile, tablet, and desktop viewports.
     * `system-design`: Triggered on schemas, migrations, contracts (`contracts/`, `schema/`, `.graphql`, `.proto`).
     * `product` & `security`: Dispatched for business logic and vulnerability-sensitive surfaces.
   - **All applicable domains must record an independent pass** before the task transitions to `validated`. A single domain rejection archives all open domain attempts and sends the task for repair.
4. **Transitive Bypass Prevention:**
   - Dependency DAGs must maintain strict topological integrity. Downstream consumer tasks cannot bypass intermediate validator nodes to directly depend on implementer tasks.

---

## 5. Anti-Blunder Guidelines & Operational Guardrails

To protect repository state and prevent common LLM blunder modes:

1. **Main-Thread Restraint Guard:**
   - Interactive Tier 1 sessions must never perform direct task implementations or file edits.
   - Unauthorized direct edits trigger automated blunder logging (`blunder:audit`) and require delegation to background subagents.
2. **Compact CLI Help Over Giant JSON Dumps:**
   - **Never** read, parse, or inject massive raw JSON dumps (e.g. `cli-capabilities.json`).
   - Always discover commands via targeted CLI help: `bun harness.ts help <command>` or error diagnostics via `bun harness.ts explain <ERROR_CODE>`.
3. **Monolithic Default Output & Step Guidance:**
   - Rely on unified status views (`summary:view` / `report:unified` / `run:status`) which automatically integrate the Sugiyama DAG, live doctor checks, task metrics, and subagent allocations.
   - Always follow the structured `nextRecommendedCommand` guidance emitted in CLI briefs.
4. **Bearer Token Confidentiality & Hygiene:**
   - Bearer tokens (`--token <token>`) are authorization credentials that must **only** appear as CLI arguments in direct harness invocations.
   - **Never** leak tokens in commit messages, log files, PR descriptions, markdown reports, or chat outputs.
5. **Lease Heartbeat Discipline:**
   - Implementers holding active leases must periodically issue `task:heartbeat` before lease expiry.
   - Expired leases are automatically reclaimed by `recover` / `orchestrator:supervise` to prevent orphaned dead-agent blocking.
6. **Git Hygiene & Ephemeral State:**
   - Dynamic plan state belongs strictly in `.capsules/<run-id>/`, never committed to `docs/planning/` or root git history.
   - Temporary testing artifacts must be directed to designated `.tmp/` or scratch directories.

---

## 6. Monorepo Quality Gates & Code Standards

All contributions to the `@onurseckin/skills` monorepo must strictly satisfy all repository quality gates:

1. **Strict TypeScript (Zero `any`):**
   - Exactly **0 TypeScript `any`** types allowed across production code and test suites.
   - External boundaries must use strict runtime schema validations or TypeScript type guards.
2. **Zero Compiler & Linter Suppressions:**
   - Exactly **0 compiler/linter suppressions** (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`) are permitted anywhere in the repository.
3. **Context-Friendly File Size Budgets:**
   - Production source files must remain compact and modular: $\le 200$ lines for production sources, $\le 250$ lines for unit test suites.
4. **100% Host-Agnostic & Zero Runtime Dependencies:**
   - Harness and scripts must run using native runtime APIs (`bun` / `node` built-ins). No external runtime `node_modules` or runtime `npm install` requirements.
5. **Comprehensive Falsifiable Test Coverage:**
   - Run `bun test` to ensure all tests pass with zero regressions before task submission.

---

## 7. Standard Harness Workflows & Step Machine

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STANDARD HARNESS STEP-MACHINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Claim Task:                                                             │
│     bun harness.ts task:claim --run <run> --task <id> --agent <agent> \     │
│       --role implementer                                                    │
│                                                                             │
│  2. Execute Implementation within Write Scope:                              │
│     (Implement code & run local verification tests with bun test)           │
│                                                                             │
│  3. Maintain Live Lease:                                                    │
│     bun harness.ts task:heartbeat --run <run> --task <id> --agent <agent> \ │
│       --token <token>                                                       │
│                                                                             │
│  4. Submit Completed Task:                                                  │
│     bun harness.ts task:submit --run <run> --task <id> --agent <agent> \    │
│       --token <token> --summary "<SUMMARY>" --files-changed <FILES>         │
│                                                                             │
│  5. Independent Validator Takes Over:                                       │
│     bun harness.ts task:validate-start --run <run> --task <id> \            │
│       --validator <val-agent> --validator-domain code-quality               │
│                                                                             │
│  6. Validator Adversarial Probe:                                            │
│     bun harness.ts task:probe --run <run> --task <id> \                     │
│       --validator <val-agent> --token <val-token> --demand "<DEMAND>"       │
│                                                                             │
│  7. Validator Sign-off:                                                     │
│     bun harness.ts task:review --run <run> --task <id> \                    │
│       --validator <val-agent> --token <val-token> --status pass             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
