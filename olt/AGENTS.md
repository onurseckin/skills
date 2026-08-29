# Canonical Agent Operating Directives (AGENTS.md)

This document establishes the canonical operational rules, prompt directives, role boundaries, zero-fallback invariants, 2-key validator pairing contracts, 1-hop micro-cycles, zero-exploration exact-anchor briefings, deep behavioral forensics (Meta-Auditor), fast incremental verification (`task:check`), and anti-blunder guidelines for all AI agents, subagents, orchestrators, and contributors operating within the **`@onurseckin/skills`** monorepo.

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
4. **Zero-Exploration Exact-Anchor Subagent Briefings:**
   - Every deployed subagent receives an instant, all-inclusive 1-shot briefing in its dispatch prompt containing: assigned task ID & title, exact disjoint write scope, target files with explicit line coordinates (`StartLine`, `EndLine`), concrete TypeScript symbols, complete drop-in replacement chunks, allowed & recommended commands (`bun test <path.test.ts>` for implementers), acceptance criteria, and next steps.
   - Dispatchers use `task:brief` and `agent:brief` to assemble structured briefings, eliminating exploratory subagent chatter, broad grep scans, and directory discovery probing. Implementers must achieve Turn 1 edits without exploratory reads. Coordinators must NEVER assign unit test execution commands to validators.
5. **1-Hop Implementer <-> Validator Micro-Cycles:**
   - Implementer and paired validator can execute fast in-lease micro-cycles (`--micro-cycle` / `--in-lease` on `task:reject` or `task:review`) without releasing or tearing down the implementation lease.
   - Implementers address validator findings in-lease, verify with file-scoped tests, and resubmit (bounded up to 3 micro-cycles before formal repair escalation).
6. **Strict Test Execution Ban on Coordinator / Orchestrator & Turn 1 Dispatch Rule:**
   - **Turn 1 is strictly reserved for planning, charter decomposition, and 1-shot batch subagent dispatch. 0 broad test runs (`bun test`, `npm test`) are allowed at Turn 1.**
   - Coordinators and Orchestrators are **strictly forbidden** from executing repo-wide test suites (`bun test`, `vitest`, `npm test`) directly.
   - Implementers own 100% of unit test execution. Cognitive Validators execute ZERO commands (0 `run:exec`, 0 terminal commands). Mechanic Validators execute ONLY typechecks (`tsc --noEmit`), AST static invariant audits (0 any, 0 suppressions), and Adversarial Gate Proofs (AGP counterfactuals). Coordinators/Orchestrators strictly consume structured evidence receipts.
7. **Subdomain Staging Safety Check (Reflog Protection), Per-Task Commit, Push & Global Skill Sync:**
   - **Subdomain Staging Safety Check (Reflog Protection):** Upon completion of any subdomain or intermediate task group within an OLT run, all modified files must immediately be staged (`git add -A`) into the Git index.
   - Staging immediately writes and records all blobs into `.git/objects/`, ensuring full immunity and recovery against local OS crashes, battery failure, or unexpected terminal disconnects.
   - Upon task or subgroup verification and completion:
     - Create a Conventional Commit (`feat(...)`, `fix(...)`).
     - Push to upstream main (`git push origin main`).
     - Run global skill sync (`bun scripts/sync-global.ts`) to synchronize `~/.agents/skills/olt/`.
8. **Hard Agent Reset Discipline:**
   - Upon wave completion or task group finish, coordinators and orchestrators perform a hard reset on completed subagents (`manage_subagents` with `Action: 'kill'`) to prevent stale context accumulation, ghost leases, and memory leaks.
9. **Direct Argv & Non-Interactive Execution:**
   - All gate and verification commands must execute non-interactively using direct argv arrays (`run:exec … -- <argv>`).
   - Shell string interpolations, subshells, interactive confirmation prompts, and unshielded command chaining (`&&`, `||`, `;`, `|`) are strictly prohibited in automated task execution.
10. **Zero-JSON CLI Surface:**
    - Agents interact with the harness exclusively through clean colon commands (e.g. `task:claim`, `task:submit`, `task:validate-start`, `task:review`, `task:brief`, `agent:brief`, `task:check`, `meta-audit`).
    - Commands return concise, structured markdown briefs ($\le 30$ lines) designed for token efficiency and high signal.
11. **Brent Work/Span Dynamic Concurrency Scaling ($P = \lceil W / S \rceil$) & 5-Minute Parallelization SLA:**
    - Dynamic parallel occupancy is computed algorithmically via Brent's Theorem: $P = \lceil W / S \rceil$, where Work $W = \sum \text{effort}$ and Span $S = \text{critical path depth}$.
    - **5-Minute Parallelization & Straggler SLA Rule:** When a subagent task takes >5 minutes (or is estimated to require >5 minutes of effort), it must be decomposed into multiple parallel subagents ($P = \lceil W / S \rceil$). Oversized tasks must be broken down into atomic work units bounded to 1–2 target files per task.
    - Artificial serialization dependencies between tasks with disjoint write scopes are decoupled automatically unless explicit dataflow/artifact rationale is present.
12. **Supervisor Zero Direct Code Edits / Zero Main-Thread Implementation & Role Boundary Watchdog:**
    - **Supervisor Zero Direct Code Edits & Zero Main-Thread Implementation:** Supervisors (Tier 0 `mind`, Tier 1 `orchestrator`, Tier 2 `coordinator`, Tier 2 `meta-auditor`) and the interactive main thread must NEVER directly modify, edit, or create repository source files in their own thread or take on worker tasks. All code edits must be delegated to leased Tier 3 Implementers.
    - Supervisory tiers must **never** edit repository source files or run unit test suites.
    - Continuous watchdog monitoring (`watchdog:role-boundary`) detects boundary violations, anti-leak/anti-drift defects, and persona duplication using deterministic persona signature hashing.
13. **Empirical Blunder Logging & Resolution Proofs:**
    - Boundary violations, main-thread implementation attempts, and reasoning errors are logged to canonical `.olt/defects.jsonl`.
    - Blunders are deduplicated, audited (`defect:audit`), and resolved only with empirical proof (`commit_sha`, `test_assertion`, `task_id`).
14. **Live Cognitive Telemetry & Active Coordinate Badges:**
    - Supervisory pulses (`mind:pulse`) stream live Work/Span metrics ($W, S, P$, optimal concurrency, active concurrency) and active agent coordinate badges (`[W<wave>:L<lane>]`).
    - The supervisory mind operates on an infinite autonomous cadence (`CLOSING_FORBIDDEN_FOR_MIND`) with active persona mandate injection.
15. **Gen5 Dynamic Wave Decoupling & Topological Parallelism:**
    - Tasks with disjoint write scopes are dynamically decoupled into independent topological waves (`detectScopeOverlap`) without artificial linear chaining or false serial dependencies. Candidate partitioning, feedback grouping, and self-evolution task graphs leverage dynamic wave decoupling to maximize parallel cognition ($P = \lceil W / S \rceil$).
16. **Multi-Attribute Semantic Memory & Cross-Generational Retrieval:**
    - Cross-generational cognitive memory querying (`memory:query` / `memory:search`) supports fine-grained multi-attribute filtering across `--kind` (task, capture, decision, blunder, blunder_promotion, objective, artifact), `--generation` (`--gen`), `--tags`, `--pattern` (regex matching), and semantic query terms (`--query`), ensuring rapid historical context retrieval and anti-blunder grounding.
17. **Automated Blunder Promotion & Regression Immunity:**
    - Resolved blunders are systematically audited (`defect:audit`) and auto-promoted (`--auto-promote`) from `blunders.jsonl` to `completed-blunders.jsonl` with verifiable empirical proofs (`commit_sha`, `test_assertion`, `task_id`). Automated regression test suite generation (`--generate-tests`, `--output-tests`) guarantees permanent immunity across all historical blunder instances (46 verified blunder remediations).
18. **Infinite Mind Product Owner Mode & Atomic Admission-to-Dispatch Chaining:**
    - Tier 0 Mind operates as an Infinite Product Owner governing backlog lifecycle across Mode A (Autonomous Self-Evolution on empty queue) and Mode B (External Intake).
    - Admitting feedback atomically converts and dispatches into `TASK_QUEUE.jsonl` with ZERO paused admitted items (`reconcilePausedAdmittedFeedbacks`).
    - Enforces 1:1 Isolated Task Dispatch (Anti-Batching Rule: each task must be single-implementer and single-validator isolated with disjoint write scopes).
    - Supports concurrent multi-orchestrator pre-planning with Brent Work/Span ($W, S, P = \lceil W / S \rceil$) tracking.
19. **Active 4-Tier Hierarchical Parent-Child Supervision:**
    - Strict top-down parent-child supervision across all 4 tiers: Tier 0 Mind -> Tier 1 Orchestrator -> Tier 2 Coordinator & Meta-Auditor -> Tier 3 Workers.
    - Tier-bypassing and cross-tier spawning (e.g. Mind spawning Coordinators or Implementers, Orchestrators spawning Implementers) is strictly prohibited and mechanically blocked.
20. **Cognitive Validator Hard-Lock Interlock:**
    - Cognitive Validators (domain: `code-quality`, `product`, `security`, `system-design`, `ui-design`, and general `validator`) are strictly locked out of command execution (0 `run:exec`, 0 tests, 0 bash scripts, 0 build tools), dedicating 100% bandwidth to code reading and Socratic critique.
    - Mechanic Validators (`mechanic-validator`) retain test execution and shell authority (`run:exec`, `tsc --noEmit`, AST static audits, AGPs).
    - Implementers own 100% of unit test execution.
21. **Script-Backed Scheduler Diagnostics Engine:**
    - Scheduler pulses and coordination loops execute deterministic script-backed diagnostics (`doctor`, `health`, `dag`, `report`) before generating telemetry.
    - Embeds live CLI receipts with SHA-256 cryptographic hashes and ASCII DAG badges into pulse briefs and coordination reports.
22. **Zero-Exploration Exact-Anchor Briefings & Fast Incremental Verification (`task:check`):**
    - Coordinators must dispatch workers with exact file paths, line ranges (`StartLine`, `EndLine`), symbols, and drop-in replacements (`task:brief`), driving immediate Turn 1 edits with 0 exploratory discovery reads.
    - Implementers and Mechanic Validators utilize `task:check` (`--task <id> --run <run>` or `--file <paths>`) for fast in-process incremental TypeScript type checking (`tsc --noEmit`) and AST static invariant audits (strict 0 `any`, 0 compiler suppressions, zero-fallback error codes) to verify targeted changes in milliseconds without full test suite overhead.
23. **Tier 2 Meta-Auditor Deep Behavioral Forensics & Autonomous Injection (`meta-audit`):**
    - Independent Tier 2 supervisory forensics role (`meta-auditor`, domain: `forensics`) inspects raw event streams (`events.jsonl`), state ledgers (`state.json`), transcripts, and tool executions post-wave and post-run.
    - Scans coordination traces against 7 behavioral heuristics: `TOKEN_BURNING`, `FALSE_SERIALIZATION`, `ROLE_BOUNDARY_DEVIATION`, `POLLING_WASTE`, `CONTEXT_OVERFLOW`, `GHOST_LEASE`, and `STRAGGLER`.
    - Computes deterministic behavioral efficiency scores ($0.0\% - 100.0\%$) and quantitative operational metrics.
    - Autonomously synthesizes structured remediation proposals and injects them directly into the canonical feedback queue (`.olt/backlog.jsonl`) via `meta-audit --inject` and the Mind candidate pool (`mind:candidate`).
    - Strictly prohibited from making direct code edits, claiming leases, running tests, or rubber-stamping unevidenced passes.
24. **Elastic Dynamic Hierarchy Scaling & Fast-Path Compaction**:
    - **Fast-Path Compaction ($N = 1$)**: When an active queue or plan has exactly 1 task, the Tier 1 Orchestrator directly supervises the Implementer and Cognitive Validator pair, skipping Tier 2 Coordinator middleman overhead.
    - **Multi-Coordinator Partitioning ($N > 5$ or Multi-Stack)**: Waves with $> 5$ parallel lanes or distinct domain stacks are partitioned across specialized Tier 2 Coordinators (max 5 lanes per coordinator, e.g. `coordinator_core`, `coordinator_cli`, `coordinator_ui`).
25. **Hard-Coded Anti-Serialization Mechanical Interlock (`FALSE_SERIALIZATION_BLUNDER`)**:
    - When a wave has $N \ge 2$ ready disjoint lanes, single-subagent dispatches are mechanically blocked. The harness throws `[FALSE_SERIALIZATION_BLUNDER] Wave contains N ready disjoint lanes. You MUST invoke all N subagents in parallel via Subagents: [...]`.
    - Coordinators and Orchestrators must dispatch full parallel wave arrays using 1-shot batch prompts.
26. **Streamlined 5 Golden Roles & Deterministic CLI Gates**:
    - Core personas are streamlined to 5 Golden Roles: `mind` (Tier 0), `orchestrator` (Tier 1), `coordinator` (Tier 2), `implementer` (Tier 3), `validator` (Tier 3), plus `completeness-critic` (Tier 3) and `meta-auditor` (Tier 2).
    - `mechanic-validator` is permanently retired as an LLM subagent role; all typechecks and AST static invariant audits (0 any, 0 suppressions) are anchored in the deterministic CLI tool `task:check`.
    - `repairer` is permanently retired as a separate subagent role; repairs are executed directly by the active Implementer through 1-hop in-lease micro-cycles (`task:reject --in-lease`).
27. **Canonical `olt/` Repository Directory & Persistent Governance**:
    - Project governance, backlog, defect remediation logs, and telemetry are persisted in the committed `olt/` directory (`olt/policy.json`, `olt/backlog.jsonl`, `olt/completed-tasks.jsonl`, `olt/defects.jsonl`, `olt/completed-defects.jsonl`, `olt/telemetry.jsonl`).
    - Runtime capsule workspaces remain gitignored under `capsules/` (and legacy `.olt/capsules/`).
28. **Hard-Coded Mechanical RBAC Engine & Shielded Shell (`harness.ts shell`)**:
    - All subagent command executions are verified through the hybrid static + dynamic deny-list compiler (`verifyCommandAuthorization`).
    - Cognitive Validators have `can_execute_shell: false` (Hard-lock interlock: 0 commands allowed).
    - Implementers are forbidden from un-targeted whole-suite test runs (`^npm test$`, `^bun test$`, `^pytest$`, `^cargo test$`) and git mutations.
    - Commands must be executed via `bun harness.ts shell --actor <id> -- <cmd>` which emits cryptographically signed receipts into `evidence/` and `olt/telemetry.jsonl`.
29. **Smart Neighborhood Read Scope & Dynamic Scope Expansion (`harness.ts scope:expand`)**:
    - Read scope is bounded to target files and direct directory neighborhoods (default depth: 2).
    - Subagents requiring access to out-of-neighborhood files must dynamically expand their declared read scope using `bun harness.ts scope:expand --actor <id> --read <path>`.
30. **Root Directory Hygiene & Scratch Confinement (`scratch/`)**:
    - All temporary test scripts, one-off patches, debugging tools, scratch payloads, repair files, or experiment artifacts MUST strictly reside inside the gitignored `scratch/` (or `.olt/scratch/`) directory.
    - Writing, creating, or leaving temporary `.ts`, `.js`, `.cjs`, `.json`, `.py`, or `.log` scratch files in the repository root is strictly prohibited (`ROOT_HYGIENE_VIOLATION`). Subagents must keep the repository root clean.
31. **4 Canonical Hosts, Models, Thinking Levels & Schedulers:**
    - The monorepo strictly standardizes across 4 Canonical Hosts:
      - **`antigravity`**: `gemini-3.7-flash` (high thinking supervisory, medium thinking execution/implementer); 5m scheduler.
      - **`claude_code`**: `claude-5-opus` / `claude-opus-5` (high thinking supervisory); `claude-5-sonnet` / `claude-sonnet-5` (medium thinking execution/implementer); 15m scheduler. (Zero references to 3.7 for Claude Code).
      - **`codex`**: `gpt-5.6-sol` (high thinking supervisory); `gpt-5.6-terra` (medium thinking execution/implementer); 15m scheduler.
      - **`cursor`**: Cursor latest stable model (high thinking supervisory, medium thinking execution/implementer); 5m scheduler.
    - **No Generic Fallback Invariant**: Host configurations must strictly resolve to one of the 4 canonical hosts. Generic fallback models, heuristic fallbacks, and speculative aliases are strictly forbidden.
    - **CLI and IDE Parity**: CLI and IDE environments share 100% identical configuration.
32. **Subdomain Staging Safety Check (Reflog Protection) & Crash Resilience:**
    - Upon completion of any subdomain, intermediate wave, or task group within an OLT run, all modified files must immediately be staged (`git add -A`) into the Git index.
    - Staging immediately commits file blobs into `.git/objects/`, ensuring permanent reflog recovery and full immunity against local OS crashes, power loss, battery failure, or unexpected terminal disconnects.
33. **5-Minute Parallelization & Straggler SLA Rule:**
    - When any subagent task takes >5 minutes to complete, it violates the Straggler SLA and must be decomposed into multiple parallel subagents ($P = \lceil W / S \rceil$).
    - Oversized implementations must be partitioned into atomic sub-tasks bounded to 1–2 target files per subagent.
34. **Supervisor Zero Direct Code Edits & Zero Main-Thread Implementation:**
    - Strict prohibition against main thread or supervisory tiers doing code edits or taking on worker tasks. All code modifications must be delegated to leased Tier 3 Implementers with exact-anchor briefings and disjoint write scopes.
35. **Quota Freeze & Cron Suspension (Zero-Kill Invariant & <10% Circuit-Breaker):**
    - When remaining quota drops below 10% (`QUOTA_EXHAUSTED_CIRCUIT_BROKEN`) or provider rate limit (429) is encountered, supervisory agents gracefully suspend recurring background crons (`mind:pulse`, live auditors, round supervisors).
    - **Zero-Kill Invariant:** Active subagents are NEVER terminated or killed (`manage_subagents kill` strictly forbidden during freeze). Subprocesses sleep in RAM in an IDLE state, preserving uncommitted working tree changes and in-memory epistemic context.
    - **Auto-Wake Resume:** A single one-shot sentinel timer is scheduled (`resetTime + 60s` buffer). Upon sentinel wakeup, supervisory agents re-register stopped crons, restore DAG coordinates from `.olt/quota-dag-snapshot.json`, and resume multi-round convergence.

---

## 2. Multi-Agent Architecture & Role Boundaries

The repository enforces a strict **4-Tier Host-Agnostic Architecture** to isolate context, eliminate cognitive anchoring, and ensure deterministic long-task execution:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       4-TIER AGENT ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 0: Mind Supervisor & Infinite Product Owner ]                       │
│    • 30,000-ft strategic consciousness, candidate admission & PO mode       │
│    • Atomic Admission-to-Dispatch Chaining (Zero paused admitted items)      │
│    • Concurrent multi-orchestrator pre-planning & Work/Span tracking         │
│    • Dispatches ONLY Tier 1 Orchestrators; NEVER spawns Tier 2/3 directly   │
│                          │                                                  │
│                          ▼                                                  │
│  [ Tier 1: Meta-Orchestrator & Loop Runner ]                                │
│    • Multi-round capsule chaining (up to 10 rounds) & defect synthesis      │
│    • Background watchdog monitoring & auto-wake                              │
│    • Dispatches ONLY Tier 2 Coordinators; NEVER spawns Tier 3 directly      │
│                          │                                                  │
│                          ▼                                                  │
│  [ Tier 2: Background Run Coordinator & Meta-Auditor Forensics ]             │
│    • coordinator: Owns capsule lifecycle, wave dispatch & Tier 3 supervision │
│    • meta-auditor: Deep behavioral forensics, 7 heuristics & efficiency score│
│    • Autonomous remediation injection (--inject) to FEEDBACK_QUEUE.jsonl    │
│    • Employs Zero-Exploration Exact-Anchor Briefings (task:brief)           │
│    • Direct parental supervision over Tier 3 Workers (hard resets on kill)  │
│    • Enforces Cognitive Validator Hard-Lock (0 commands) & Mechanic tasks   │
│                          │                                                  │
│                          ▼                                                  │
│  [ Tier 3: Ephemeral Specialized Subagents & Workers ]                      │
│    • planner: Decomposes requirements into tasks, gates, and DAG edges      │
│    • plan-validator: Adversarial auditor of compiled planning topology      │
│    • implementer: Leased worker executing within disjoint write scope       │
│    • validator: Cognitive reviewer executing Socratic analysis (0 commands) │
│    • mechanic-validator: Typechecks, AST static audits & AGP (runs tests)  │
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

### Canonical Hosts, Models, Thinking Levels & Schedulers

The repository standardizes across 4 Canonical Host Platforms with strict model, thinking level, and scheduler assignments. Generic fallbacks and speculative model aliasing are strictly prohibited; CLI and IDE share 100% identical configuration:

| Host Platform     | Supervisory Tier Roles (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) | Execution Tier Roles (Tier 3 Implementer, Validator, Critic, Subagents) | Thinking Level | Scheduler Cadence              | Consistency Contract                                        |
| :---------------- | :---------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :------------- | :----------------------------- | :---------------------------------------------------------- |
| **`antigravity`** | `gemini-3.7-flash` (High Thinking)                                            | `gemini-3.7-flash` (Medium Thinking)                                    | High (Supervisory) / Medium (Execution) | 5m scheduler (`*/5 * * * *`)   | CLI & IDE share identical configuration                     |
| **`claude_code`** | `claude-5-opus` (`claude-opus-5`) (High Thinking)                             | `claude-5-sonnet` (`claude-sonnet-5`) (Medium Thinking)                 | High (Supervisory) / Medium (Execution) | 15m scheduler (`*/15 * * * *`) | CLI & IDE share identical configuration (No 3.7 references) |
| **`codex`**       | `gpt-5.6-sol` (High Thinking)                                                 | `gpt-5.6-terra` (Medium Thinking)                                       | High (Supervisory) / Medium (Execution) | 15m scheduler (`*/15 * * * *`) | CLI & IDE share identical configuration                     |
| **`cursor`**      | Cursor latest stable model (High Thinking)                                    | Cursor latest stable model (Medium Thinking)                            | High (Supervisory) / Medium (Execution) | 5m scheduler (`*/5 * * * *`)   | CLI & IDE share identical configuration                     |

#### Canonical Host Directives:

1. **Zero Generic Fallback Invariant:** Every agent deployment must explicitly bind to one of the 4 canonical host platforms (`antigravity`, `claude_code`, `codex`, `cursor`) and its prescribed model tier. Falling back to generic, un-versioned, or heuristic default models is strictly prohibited.
2. **CLI / IDE Configuration Parity:** Host configurations in CLI environments (e.g. `antigravity-cli`, `cursor-cli`, `codex-cli`) and IDE extensions (e.g. `antigravity-ide`, `cursor-ide`) must maintain identical model strings, thinking budgets, and scheduler intervals without configuration drift.
3. **Thinking Effort Governance:** Supervisory tiers operate with High Thinking enabled for deep strategic reasoning, while Execution and Implementer tiers operate with Medium Thinking for fast, cost-efficient, high-precision code and validation cycles.

### Role Contracts & Prohibitions

| Role                      | Tier | Key Responsibilities                                                                                                                                                                                                          | Non-Negotiable Prohibitions (`must_not`)                                                                                                                          |
| :------------------------ | :--: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`mind`**                |  0   | Infinite Product Owner, candidate admission, atomic dispatch chaining, multi-orchestrator scaling, macro DAG diagnostics, queue governance (`.olt/`), memory persistence, non-idle autonomous discovery.                      | **Must not** write repository code, execute unit tests, spawn Tier 2/3 agents directly, or permit paused admitted items to linger. Strict zero direct code edits. |
| **`orchestrator`**        |  1   | Multi-round orchestration, capsule chaining, convergence governance, watchdog cadence, final synthesis, release syncing.                                                                                                      | **Must not** implement tasks directly, run raw test suites, spawn Tier 3 workers directly, or spill work onto main thread. Strict zero direct code edits.         |
| **`coordinator`**         |  2   | Run lifecycle ownership, agent registration, 1-shot exact-anchor briefings, wave dispatching, hard resets, git commits/pushes/sync, Tier 3 supervision.                                                                       | **Must not** write repository code, claim tasks, assign commands to Cognitive Validators, or execute raw test suites (`bun test`). Strict zero direct code edits. |
| **`meta-auditor`**        |  2   | Post-wave and post-run deep behavioral forensics, 7 anomaly detection heuristics, deterministic efficiency scoring (0.0% - 100.0%), autonomous remediation injection (`--inject`), zero-exploration exact-anchor enforcement. | **Must not** make direct source code edits, claim code write leases, execute task tests directly, rubber-stamp passes, or bypass 4-tier hierarchy.                |
| **`planner`**             |  3   | Prompt decomposition, DAG generation, gate assignment.                                                                                                                                                                        | **Must not** implement code or execute task write scopes.                                                                                                         |
| **`plan-validator`**      |  3   | Adversarial inspection of compiled plan topology.                                                                                                                                                                             | **Must not** touch task implementation or alter runtime code.                                                                                                     |
| **`implementer`**         |  3   | Leased task implementation within assigned write scope; 1-hop micro-cycles; file-scoped testing; Turn 1 exact edits.                                                                                                          | **Must not** edit outside write scope, self-validate work, or run whole-repo test suites (`bun test`).                                                            |
| **`validator`**           |  3   | Cognitive verification, adversarial probing, 1-hop micro-cycle critique, Socratic review.                                                                                                                                     | **Must not** execute ANY bash/test commands (`run:exec`, 0 command privileges), pass without probe round, or validate own work.                                   |
| **`mechanic-validator`**  |  3   | Typechecks (`tsc --noEmit`), AST static invariant audits, fast incremental checks (`task:check`), Adversarial Gate Proofs (AGP).                                                                                              | **Must not** re-run implementer unit tests, write application code, run whole-repo test suites, or validate tasks without direct execution receipts.              |
| **`repairer`**            |  3   | Targeted remediation of specific validator findings.                                                                                                                                                                          | **Must not** expand scope beyond reported finding remediations.                                                                                                   |
| **`completeness-critic`** |  3   | Whole-run verification against original user prompt.                                                                                                                                                                          | **Must not** approve runs with unmapped requirements or failing gates.                                                                                            |
| **`sub-implementer`**     |  3   | Narrow branch sub-task execution.                                                                                                                                                                                             | **Must not** exceed parent's write scope subset.                                                                                                                  |
| **`sub-validator`**       |  3   | Command execution and evidence gathering.                                                                                                                                                                                     | **Must not** render verdicts (`pass`/`fail`) or close findings.                                                                                                   |
| **`sub-investigator`**    |  3   | Read-only diagnosis and root-cause analysis.                                                                                                                                                                                  | **Must not** modify filesystem state or write code.                                                                                                               |

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
6. **No Generic Host Fallback & Identical CLI/IDE Configuration Invariant:**
   - Host configurations must strictly resolve to one of the 4 canonical hosts (`antigravity`, `claude_code`, `codex`, `cursor`) and their assigned model tiers.
   - Generic fallback models, heuristic fallbacks, and CLI/IDE configuration drift are strictly prohibited.

---

## 4. 2-Key Validator Pairing, 1-Hop Micro-Cycles & Adversarial Triads

To eliminate sycophantic bias and accelerate execution convergence, validation enforces the **Two-Key Principle** augmented with **1-Hop In-Lease Micro-Cycles**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│              2-KEY VALIDATOR PAIRING & 1-HOP MICRO-CYCLE LOOP               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Implementer Agent (Key 1) ] ──────────► Produces Code & File-Scoped Tests │
│             ▲                                       │                       │
│             │ (In-Lease Micro-Cycle:               │                       │
│             │  task:reject --micro-cycle)           ▼                       │
│             │                          [ Context Isolation Pipeline ]       │
│             │                            • Strips excuses / confidence      │
│             │                            • Retains objective diffs & gates  │
│             │                                       │                       │
│             │                                       ▼                       │
│  [ Independent Validator (Key 2) ] ◄───► [ Mechanic Validator ]             │
│    • Socratic cognitive critique           • Fast incremental task:check    │
│    • 1-hop micro-cycle feedback            • Produces structured receipts   │
│    • Mandatory adversarial probe           • Adversarial Gate Proofs (AGP)  │
│    • Signs off (task:review pass)                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1-Hop In-Lease Micro-Cycle Protocol

1. **In-Lease Critique Delivery:**
   - When a validator identifies a remediation item or missing assertion during validation, it issues structured critique via `task:reject --micro-cycle --reason "<critique>" --remediation "<fix>"` (or alias `--in-lease`) or `task:review --micro-cycle --status fail`.
   - The implementer's lease is **preserved in active state** (`leased`), bypassing expensive full-cycle lease release, replanning, and re-claiming.
2. **Direct Implementer Remediation:**
   - The implementer receives the critique directly, modifies files strictly within write scope, verifies changes using file-scoped test commands (`bun test <path.test.ts>`) and fast incremental verification (`task:check`), and re-submits (`task:submit`).
3. **Bounded Micro-Cycle Rounds:**
   - In-lease micro-cycles are bounded to a maximum of 3 rounds (`max_micro_cycles: 3`).
   - If findings remain unresolved after 3 micro-cycle hops, the task transitions to formal `changes_requested` for full repair replanning.

### Core Validator Pairing Invariants

1. **Strict Identity Independence:**
   - The validator **must not** be the task's original implementer (`original_implementer !== validator`).
   - The validator **must not** have contributed to any implementation attempt for the task.
   - **Fresh Validator per Round:** Reusing a validator on the same task across subsequent repair rounds is forbidden (`INVALID_STATE`).
2. **Mandatory Adversarial Probe Round (`min_adversarial_probes >= 1`):**
   - A task pass (`task:review --status pass`) is refused until at least one adversarial probe demand (`task:probe`) is formally recorded.
   - **Probe vs. Defect Distinction:**
     - `task:probe`: Demands rigorous proof (e.g. "Prove logic handles empty sets"). Does not increment repair round or push task to `changes_requested`.
     - `task:reject`: Documents genuine defects where the mechanical gate is green but requirements are unfulfilled. Moves task to `changes_requested`.
3. **Multi-Domain Standing Checklist Verification:**
   - Tasks undergo independent validation across applicable checklist domains (`code-quality`, `ui-design`, `system-design`, `product`, `security`).
   - **All applicable domains must record an independent pass** before the task transitions to `validated`.
4. **Transitive Bypass Prevention:**
   - Dependency DAGs must maintain strict topological integrity. Downstream consumer tasks cannot bypass intermediate validator nodes to directly depend on implementer tasks.

---

## 5. Anti-Blunder Guidelines & Operational Guardrails

To protect repository state and prevent common LLM blunder modes:

1. **Main-Thread Restraint Guard & Supervisor Zero Direct Code Edits / Zero Main-Thread Implementation:**
   - Interactive main-thread sessions and supervisory tiers (Mind, Orchestrators, Coordinators, Meta-Auditors) must never perform direct task implementations, source code edits, or take on worker tasks in their own thread.
   - All code modifications must be delegated to leased Tier 3 Implementers.
   - Unauthorized direct edits trigger automated blunder logging (`defect:audit`) and immediate delegation to background subagents.
2. **Zero-Exploration Exact-Anchor Briefing Mandate:**
   - Subagents must never be spawned without complete task context. Always issue `task:brief` or `agent:brief` containing exact target files, line ranges (`StartLine`, `EndLine`), concrete symbols, and drop-in code replacements. Implementers must achieve Turn 1 edits with 0 exploratory discovery reads. Flag $>5$ exploratory reads before first edit as `TOKEN_BURNING`.
3. **Strict Test Ban on Coordinators / Orchestrators & Turn 1 Dispatch Invariant:**
   - **Turn 1 is strictly reserved for planning, charter decomposition, and 1-shot batch subagent dispatch. 0 broad test runs (`bun test`, `npm test`) are allowed at Turn 1.**
   - Coordinators and Orchestrators must never execute raw test suites (`bun test`). All unit test runs must be delegated to leased Tier 3 Implementers.
4. **Hard Subagent Reset Discipline:**
   - Always terminate completed subagents (`manage_subagents` Action: 'kill') at wave or subgroup completion to eliminate stale context and ghost leases.
5. **Subdomain Staging Safety Check (Reflog Protection), Per-Task Commit, Push & Global Sync:**
   - **Subdomain Staging Safety Check (Reflog Protection):** Upon completion of any subdomain or intermediate task group within an OLT run, all modified files must immediately be staged (`git add -A`) into the Git index.
   - Staging immediately writes and records all blobs into `.git/objects/`, ensuring full immunity and recovery against local OS crashes, battery failure, or unexpected terminal disconnects.
   - Keep working tree clean and synchronized by executing Conventional Commits (`feat(...)`, `fix(...)`), `git push origin main`, and `bun scripts/sync-global.ts` upon task verification.
6. **Compact CLI Help Over Giant JSON Dumps:**
   - **Never** read, parse, or inject a whole reference tree at once (e.g. every file under `references/cli-capabilities/`).
   - Always discover commands via targeted CLI help: `bun harness.ts help <command>`, a single grep of `references/cli-capabilities/index.jsonl`, or error diagnostics via `bun harness.ts explain <ERROR_CODE>`.
7. **Monolithic Default Output & Step Guidance:**
   - Rely on unified status views (`summary:view` / `report` / `run:status`) which automatically integrate the Sugiyama DAG, live doctor checks, task metrics, and subagent allocations.
   - Always follow the structured `nextRecommendedCommand` guidance emitted in CLI briefs.
8. **Bearer Token Confidentiality & Hygiene:**
   - Bearer tokens (`--token <token>`) are authorization credentials that must **only** appear as CLI arguments in direct harness invocations.
   - **Never** leak tokens in commit messages, log files, PR descriptions, markdown reports, or chat outputs.
9. **Lease Heartbeat Discipline:**
   - Implementers holding active leases must periodically issue `task:heartbeat` before lease expiry.
   - Expired leases are automatically reclaimed by `recover` / `orchestrator:supervise` to prevent orphaned dead-agent blocking.
10. **Git Hygiene & Ephemeral State:**
    - Dynamic plan state belongs strictly in `.olt/capsules/<run-id>/`, never committed to `docs/planning/` or root git history.
    - Temporary testing artifacts must be directed to designated `.tmp/` or scratch directories.
11. **Canonical Mind Queue & Strict Non-Idle Discovery Invariant:**
    - Mind queue data lives strictly under `<repo-root>/.olt/` (and `.olt/`) using standardized lowercase kebab-case files: `feedback-queue.jsonl`, `completed-tasks.jsonl`, `blunders.jsonl`, `completed-blunders.jsonl`, `observations.jsonl`, `watchdogs.json`, alongside indexed cognitive memory at `.olt/memory.json`.
    - When feedback queue count is 0, Mind is strictly forbidden from sitting idle or reporting "waiting in standby"; it must immediately trigger autonomous discovery (0 any checks, charter gap audits, blunder regression tests, Work/Span P = W / S optimizations).
    - Mind queue operations must execute via `mind:queue:*` or alias `todo:*` CLI commands (`list`, `add`, `drain`, `seal`, `clean`).
12. **Role Boundary Watchdog & Persona Deduplication:**
    - Continuous watchdog auditing (`watchdog:role-boundary`, `createRoleBoundaryWatchdog`) ensures no agent violates its tier constraints, leaks write scopes, or runs forbidden test suites.
    - Dynamic personas are deterministically hashed (`computePersonaSignature`) and deduplicated to prevent persona sprawl across multi-orchestrator deployments.
13. **Empirical Blunder Resolution Invariant:**
    - Every recorded blunder in `blunders.jsonl` requires empirical proof to resolve (`blunder:resolve` / `defect:audit` with `commit_sha`, `test_assertion`, and `task_id`).
    - Speculative assertions, verbal dismissals, and unevidenced status overrides are strictly prohibited.
14. **Brent Work/Span Optimization, Edge Decoupling & 5-Minute Parallelization SLA:**
    - Wave execution plans must maximize concurrency ($P = \lceil W / S \rceil$) by pruning artificial dependencies between tasks with disjoint write scopes.
    - **5-Minute Parallelization & Straggler SLA Rule:** When a subagent task takes >5 minutes (or is estimated to require >5 minutes of effort), it must be decomposed into multiple parallel subagents ($P = \lceil W / S \rceil$).
    - Tasks must never enforce artificial serialization unless dataflow or artifact coupling is explicitly documented.
15. **Active Coordinate Badge Traceability:**
    - All dispatched subagents must display coordinate badges `[W<wave>:L<lane>]` corresponding to their Sugiyama DAG wave and parallel lane assignments during telemetry pulses (`mind:pulse`).
16. **Dynamic Wave Decoupling Overlap Invariant:**
    - Candidate partitioning, self-evolution task graphs, and feedback batching must strictly use dynamic write-scope overlap checking (`detectScopeOverlap`) to avoid artificial serial edges. Disjoint tasks must be assigned parallel wave coordinates without forced sequential constraints.
17. **Multi-Attribute Semantic Memory Querying:**
    - Historical pattern retrieval must leverage `memory:query` / `memory:search` with targeted `--kind`, `--generation`, `--tags`, and `--pattern` filters to search indexed cognitive memory across all generations before planning new objectives or declaring solutions.
18. **Automated Blunder Promotion & Regression Suite Maintenance:**
    - Every resolved blunder in `blunders.jsonl` must be promoted via `defect:audit --auto-promote` into `completed-blunders.jsonl` with empirical proof and regression test assertions (`--generate-tests`, `--output-tests`), maintaining 100% regression immunity across all 46 blunder instances.
19. **Fast Incremental Verification Discipline (`task:check`):**
    - Implementers and mechanic validators must execute `task:check` (`--task <id> --run <run>` or `--file <paths>`) for instant in-process TypeScript type checking and AST invariant audits (strict 0 `any`, 0 suppressions) before submitting or passing tasks.
20. **Autonomous Meta-Auditor Forensics & Closed-Loop Remediation:**
    - Post-wave and post-run reviews must execute `meta-audit --run <run> --inject` to detect coordination defects across 7 behavioral heuristics, compute quantitative efficiency scores, and autonomously enqueue remediation proposals directly into `.olt/backlog.jsonl`.
21. **Subdomain Staging Safety Check (Reflog Protection):**
    - Staging modified files (`git add -A`) immediately upon finishing any subdomain or intermediate work group ensures all git objects and blobs are safely captured in `.git/objects/` prior to commit. This eliminates risk of data loss from terminal drops, process kills, or system failures.
22. **5-Minute Parallelization & Straggler SLA Discipline:**
    - Coordinators and Planners must monitor task execution latencies. Any task exceeding the 5-minute SLA must be broken into smaller disjoint units and executed concurrently across parallel subagents ($P = \lceil W / S \rceil$).
23. **Supervisor Zero Direct Code Edits & Zero Main-Thread Implementation Policy:**
    - Main thread and supervisory tiers strictly refrain from direct source file modifications and test suite executions. Zero main-thread implementation is an absolute repository invariant.
24. **4 Canonical Hosts, Models & Thinking Levels Governance:**
    - Strictly use the 4 canonical host configurations (`antigravity`: `gemini-3.7-flash` (high thinking supervisory, medium thinking execution/implementer), 5m; `claude_code`: `claude-5-opus` (high thinking supervisory) / `claude-5-sonnet` (medium thinking execution/implementer), 15m; `codex`: `gpt-5.6-sol` (high thinking supervisory) / `gpt-5.6-terra` (medium thinking execution/implementer), 15m; `cursor`: Cursor latest stable model (high thinking supervisory, medium thinking execution/implementer), 5m). Generic fallbacks are strictly banned.

---

## 6. Monorepo Quality Gates & Code Standards

All contributions to the `@onurseckin/skills` monorepo must strictly satisfy all repository quality gates:

1. **Strict TypeScript (Zero `any`):**
   - Exactly **0 TypeScript `any`** types allowed across production code and test suites (`: any`, `as any`, `<any>`, `Record<string, any>`).
   - External boundaries must use strict runtime schema validations or TypeScript type guards.
2. **Zero Compiler & Linter Suppressions:**
   - Exactly **0 compiler/linter suppressions** (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`) are permitted anywhere in the repository.
3. **Context-Friendly File Size Budgets:**
   - Production source files must remain compact and modular: $\le 200$ lines for production sources, $\le 250$ lines for unit test suites.
4. **100% Host-Agnostic & Zero Runtime Dependencies:**
   - Harness and scripts must run using native runtime APIs (`bun` / `node` built-ins). No external runtime `node_modules` or runtime `npm install` requirements.
5. **File-Scoped Falsifiable Test Coverage:**
   - Execute ONLY file-scoped test commands (`bun test <path.test.ts>`) matching the modified scope. Whole-repo test suites are strictly prohibited during task execution.

---

## 7. Standard Harness Workflows & Step Machine

### A. Task Execution & Validation Step-Machine

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STANDARD HARNESS STEP-MACHINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Generate Zero-Exploration Exact-Anchor Briefing:                        │
│     bun harness.ts task:brief --run <run> --task <id> --agent <agent> \     │
│       --role implementer                                                    │
│                                                                             │
│  2. Claim Task:                                                             │
│     bun harness.ts task:claim --run <run> --task <id> --agent <agent> \     │
│       --role implementer                                                    │
│                                                                             │
│  3. Execute Implementation within Write Scope:                              │
│     (Implement code & verify with file-scoped: bun test <file.test.ts>)     │
│                                                                             │
│  4. Fast Incremental Verification (Typecheck + AST Invariants):             │
│     bun harness.ts task:check --run <run> --task <id>                       │
│                                                                             │
│  5. Maintain Live Lease:                                                    │
│     bun harness.ts task:heartbeat --run <run> --task <id> --agent <agent> \ │
│       --token <token>                                                       │
│                                                                             │
│  6. Submit Completed Task:                                                  │
│     bun harness.ts task:submit --run <run> --task <id> --agent <agent> \    │
│       --token <token> --summary "<SUMMARY>" --files-changed <FILES>         │
│                                                                             │
│  7. Independent Validator Takes Over:                                       │
│     bun harness.ts task:validate-start --run <run> --task <id> \            │
│       --validator <val-agent> --validator-domain code-quality               │
│                                                                             │
│  8. 1-Hop Micro-Cycle (if critique needed without lease teardown):          │
│     bun harness.ts task:reject --run <run> --task <id> \                    │
│       --validator <val-agent> --token <val-token> --micro-cycle \           │
│       --reason "<CRITIQUE>" --remediation "<FIX>"                           │
│                                                                             │
│  9. Validator Adversarial Probe:                                            │
│     bun harness.ts task:probe --run <run> --task <id> \                     │
│       --validator <val-agent> --token <val-token> --demand "<DEMAND>"       │
│                                                                             │
│  10. Validator Sign-off:                                                    │
│      bun harness.ts task:review --run <run> --task <id> \                   │
│        --validator <val-agent> --token <val-token> --status pass            │
│                                                                             │
│  11. Subdomain Staging Safety Check, Commit, Push & Global Sync:            │
│      git add -A  # Reflog protection: records all blobs into .git/objects/  │
│      git commit -m "feat(scope): complete task <id>"                        │
│      git push origin main                                                   │
│      bun scripts/sync-global.ts                                             │
│                                                                             │
│  12. Hard Agent Reset:                                                      │
│      (manage_subagents with Action: 'kill' for completed subagents)         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### B. Mind Queue & Feedback Lifecycle Step-Machine

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MIND QUEUE & FEEDBACK LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Ingest Feedback / Directive:                                            │
│     bun harness.ts mind:queue:add --title "<TITLE>" --content "<CONTENT>" \ │
│       --priority HIGH_ARCHITECTURAL_FEATURE --category ARCHITECTURE         │
│     (alias: bun harness.ts todo:add ...)                                    │
│                                                                             │
│  2. List & Inspect Pending Queue:                                           │
│     bun harness.ts mind:queue:list --status PENDING --all                   │
│     (alias: bun harness.ts todo:list ...)                                   │
│                                                                             │
│  3. Drain Queue Item for Intake:                                            │
│     bun harness.ts mind:queue:drain --limit 1 --mark-as ADMITTED            │
│     (alias: bun harness.ts todo:drain ...)                                  │
│                                                                             │
│  4. Seal Completed Item with Empirical Proof:                               │
│     bun harness.ts mind:queue:seal --id <id> --resolution "<PROOF>" \       │
│       --commit <SHA> --test-path <PATH> --assertions <COUNT>                │
│     (alias: bun harness.ts todo:seal ...)                                   │
│                                                                             │
│  5. Clean / Archive Resolved Items to completed-tasks.jsonl:                │
│     bun harness.ts mind:queue:clean                                         │
│     (alias: bun harness.ts todo:clean)                                      │
│                                                                             │
│  6. Autonomous Discovery on Empty Queue (0 Pending):                        │
│     (Trigger 0 any scan, charter gap audits, blunder regression, P = W / S)  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### C. Work/Span Dynamic Scaling & Role Boundary Watchdog Step-Machine

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│       WORK/SPAN DYNAMIC SCALING & ROLE BOUNDARY WATCHDOG STEP-MACHINE       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Dynamic Work/Span Topology Rebalancing & Edge Decoupling:               │
│     bun harness.ts dag --run <run> --detailed                        │
│     (Decouples non-overlapping serial edges, calculates P = ceil(W / S))   │
│                                                                             │
│  2. Live Cognitive Telemetry & Active Agent Coordinates:                    │
│     bun harness.ts mind:pulse --run <run>                                   │
│     (Displays W, S, P, optimal/active concurrency, [W<wave>:L<lane>] badges)│
│                                                                             │
│  3. Blunder Audit & Candidate Admission:                                    │
│     bun harness.ts defect:audit --run <run> --filter-status open           │
│     bun harness.ts defect:audit --run <run> --auto-admit --actor coordinator│
│                                                                             │
│  4. Continuous Role Boundary Watchdog Verification:                         │
│     bun harness.ts watchdog:verify --generation 1 --all                     │
│     bun harness.ts watchdog:probe --run <run>                               │
│                                                                             │
│  5. Empirical Blunder Resolution:                                           │
│     (Resolves defects citing task ID, commit SHA, and test assertions)      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### D. Multi-Attribute Semantic Memory & Cross-Generational Search Step-Machine

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│             MULTI-ATTRIBUTE SEMANTIC MEMORY & PATTERN RETRIEVAL             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Multi-Attribute Semantic Querying:                                      │
│     bun harness.ts memory:query --query "<QUERY>" --kind <KIND> \           │
│       --generation <GEN> --tags "<TAG1>,<TAG2>"                             │
│     (Searches memory across tasks, captures, decisions, blunder promotions) │
│                                                                             │
│  2. Regex Pattern Search across Cognitive Memory:                           │
│     bun harness.ts memory:query --pattern "<REGEX>" --all                   │
│                                                                             │
│  3. Historical Blunder Search & Pattern Grounding:                          │
│     bun harness.ts memory:query --kind blunder --tags "anti-pattern"         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### E. Automated Blunder Promotion & Regression Suite Maintenance Step-Machine

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│          AUTOMATED BLUNDER PROMOTION & REGRESSION SUITE GENERATION          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Audit and Auto-Promote Resolved Blunders:                               │
│     bun harness.ts defect:audit --auto-promote                             │
│     (Promotes resolved entries to completed-blunders.jsonl with proof)      │
│                                                                             │
│  2. Generate Automated Regression Tests:                                    │
│     bun harness.ts defect:audit --generate-tests \                         │
│       --output-tests tests/unit/mind/blunder-remediation-46.test.ts          │
│                                                                             │
│  3. Verify Blunder Regression Immunity:                                     │
│     bun test tests/unit/mind/blunder-remediation-46.test.ts                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### F. Meta-Auditor Deep Behavioral Forensics & Autonomous Injection Step-Machine

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│          META-AUDITOR DEEP BEHAVIORAL FORENSICS & AUTONOMOUS INJECTION      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Run Deep Behavioral Forensics Analysis:                                 │
│     bun harness.ts meta-audit --run <run> --format markdown                 │
│     (Scans 7 behavioral heuristics, computes efficiency score 0.0%-100.0%)  │
│                                                                             │
│  2. Filter Forensics by Specific Agent & Enable Verbose Output:             │
│     bun harness.ts meta-audit --run <run> --agent <agent-id> --verbose      │
│                                                                             │
│  3. Autonomous Closed-Loop Feedback Queue Injection:                        │
│     bun harness.ts meta-audit --run <run> --inject                          │
│     (Synthesizes PlanInjectionProposals into .olt/backlog.jsonl) │
│                                                                             │
│  4. Fast Incremental Verification on Targeted Scope (task:check):           │
│     bun harness.ts task:check --run <run> --task <id>                       │
│     bun harness.ts task:check --file <path1>,<path2> --typecheck --lint     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Deep Behavioral Forensics Taxonomy & Exact-Anchor Protocol

### The 7 Behavioral Forensics Heuristics & Root Cause Taxonomy

The Meta-Auditor (`meta-auditor`, domain: `forensics`) systematically audits run event streams (`events.jsonl`), state ledgers (`state.json`), and transcripts across seven core heuristics:

| Root Cause Category           | Detection Heuristic & Threshold                                                                                                                                                                                                    |    Severity     | Impact                                                                                                   | Prescribed Remediation                                                                                                                                     |
| :---------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------: | :------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`TOKEN_BURNING`**           | $>5$ consecutive exploratory read/browse tool calls (`view_file`, `list_dir`, `find_by_name`, `grep_search`) before first write (`write_to_file`, `replace_file_content`), or aggregate read/write ratio $>10:1$ with $>15$ reads. | High / Critical | Input token waste, context window pollution, delayed time-to-first-edit.                                 | Mandate Exact-Anchor task briefings (`task:brief`) with explicit line ranges and drop-in code replacements.                                                |
| **`FALSE_SERIALIZATION`**     | $\ge 2$ tasks with disjoint write scopes executed sequentially across consecutive timestamps instead of concurrently.                                                                                                              |  Medium / High  | Artificial span inflation, under-utilization of Brent Work/Span concurrency ($P = \lceil W / S \rceil$). | Group ready disjoint tasks into parallel wave dispatches via host native batching (`Subagents: [...]`).                                                    |
| **`ROLE_BOUNDARY_DEVIATION`** | Tier 1/2 supervisors invoke file write tools; cognitive validators execute code edits or arbitrary shell commands outside test runner.                                                                                             | Critical / High | Collapse of 4-tier separation of concerns, loss of verification integrity.                               | Strict tool grant isolation and lease tokens; delegate code edits strictly to Tier 3 implementers.                                                         |
| **`POLLING_WASTE`**           | Frequent, short-interval status polling calls (`manage_task status`, `schedule` loops) with count $\ge 4$.                                                                                                                         |  Medium / High  | Token consumption, tool call noise, CPU overhead during async waits.                                     | Mandate `WaitMsBeforeAsync: 10000` on async tool calls; await automatic reactive resumption.                                                               |
| **`CONTEXT_OVERFLOW`**        | Subagent consumes $>150,000$ prompt input tokens within a single active grant session.                                                                                                                                             | High / Critical | Imminent context overflow, attention degradation, instruction drift, session crash.                      | Granular task decomposition ($\le 1\text{--}2$ files), Cowan-chunked context limits, stream chunking.                                                      |
| **`GHOST_LEASE`**             | Task remains in `leased` or `stale` status assigned to an agent whose grant status is `released` or dead.                                                                                                                          |      High       | Task deadlock blocking wave completion and subsequent implementer claims.                                | Autonomously reclaim task leases upon agent release or heartbeat expiration; re-queue tasks.                                                               |
| **`STRAGGLER`**               | Task execution duration exceeds $3\times$ run's average task duration or $>5$ minutes ($>300$ seconds).                                                                                                                            |  Medium / High  | Long-tail serial bottleneck stalling subsequent wave lanes and inflating run span.                       | 5-Minute Parallelization SLA: Decompose oversized tasks into multiple parallel subagents ($P = \lceil W / S \rceil$) bounded to 1–2 target files per task. |

### Deterministic Efficiency Scoring Model

The Meta-Auditor computes an objective behavioral efficiency score ($0.0\% - 100.0\%$):

$$\text{Score} = \max\left(0.0, \min\left(100.0, 100.0 - \sum \text{Deductions}\right)\right)$$

1. **Incident Severity Deductions**:
   - **CRITICAL Incident**: $-25.0$ points each
   - **HIGH Incident**: $-15.0$ points each
   - **MEDIUM Incident**: $-8.0$ points each
   - **LOW Incident**: $-3.0$ points each

2. **Operational Penalties**:
   - **High Read-to-Write Ratio**: If $\text{Ratio} > 15.0$, deduct $\min\left(20.0, (\text{Ratio} - 15.0) \times 1.5\right)$
   - **Excessive Polling Calls**: If $\text{Count} > 5$, deduct $\min\left(15.0, (\text{Count} - 5) \times 2.0\right)$
   - **Sequential Bottlenecks**: If $\text{Bottlenecks} > 0$, deduct $\min\left(15.0, \text{Bottlenecks} \times 5.0\right)$

### Closed-Loop Autonomous Feedback Queue Injection (`--inject`)

When executed with `--inject` (`bun harness.ts meta-audit --run <run> --inject`), the forensics engine automatically:

1. Synthesizes structured `PlanInjectionProposal` records for detected high/critical incidents.
2. Formats remediation directives containing exact file targets, prescribed behavioral fixes, and priority levels.
3. Appends proposals to `.olt/backlog.jsonl` (and `mind:candidate` pool) with cryptographic title/category deduplication.
4. Feeds directly into Tier 0 Mind's atomic admission-to-dispatch loop for the subsequent wave or run cycle.

### Zero-Exploration Exact-Anchor Briefings & Fast Incremental Verification (`task:check`)

1. **Exact-Anchor Briefing Protocol**:
   - Coordinators must dispatch Tier 3 workers using `task:brief` containing:
     - Exact absolute and relative target file paths.
     - Precise `StartLine` and `EndLine` coordinates.
     - Concrete TypeScript symbol names, interfaces, and function signatures.
     - Ready-to-apply drop-in replacement chunks.
   - Implementers target immediate Turn 1 edits with 0 exploratory discovery calls.

2. **Fast Incremental Verification Engine (`task:check`)**:
   - In-process TypeScript type checking (`performIncrementalTypecheck`) and AST invariant linting (`performAstLintCheck`).
   - Scopes verification directly to task write scopes (`--task <id> --run <run>`) or modified files (`--file <path1>,<path2>`).
   - Enforces strict monorepo quality gates (0 TypeScript `any`, 0 compiler suppressions, zero-fallback error codes) in milliseconds.

3. **1-Shot Batch Auto-Deployment of Mind and Mind-Auditor (`/olt mind`)**:
   - Dispatches both Tier 0 `mind` and Tier 1 `mind-auditor` companions concurrently in a single atomic batch invocation.
