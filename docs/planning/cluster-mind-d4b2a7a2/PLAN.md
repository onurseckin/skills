# Mind Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-mind-d4b2a7a2`  
> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/mind/`, `tests/unit/mind/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-08-29

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the MIND domain cluster.
It addresses 8 backlog requirement(s) and 43 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    MIND DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-mind-d4b2a7a2                                                       │
│  Planned At: 2026-08-29T15:05:58.831Z                                                    │
│  Backlog Count: 8                                                                        │
│  Defect Count:  43                                                                       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars & Design Specifications

1. **Zero TypeScript `any` & Zero Suppressions**: Strictly enforced across all domain components.
2. **Subdomain Git Staging Invariant (Reflog Safety)**: Execute `git add -A` upon task verification.
3. **5-Minute Straggler SLA**: Partition any work exceeding 300s into parallel subagents ($P = \lceil W/S \rceil$).
4. **Deterministic Traceability**: Every requirement and defect maps to verified unit and integration tests.

---

## 3. Work Breakdown & Disjoint Task Specifications

### Task 1.1: Feature: Unified Master Reporting Dashboard & Canonical Sugiyama Visual DAG Engine

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-1787971784118-1aghp`
- **Write Scope:** `olt/scripts/src/mind/fb-1787971784118-1aghp.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: Comprehensive single-dashboard reporting architecture: 1) Canonical Sugiyama DAG Engine: All topological renderings across the CLI and exports must strictly use the existing Sugiyama hierarchical algorithm (olt/scripts/src/reporting/sugiyama-dag.ts) with layered ranking, barycenter crossing minimization, orthogonal ASCII routing, Tarjan cycle detection, and subagent expansion. 2) Implementer-Validator Relation & Pushback Tracking: Default 'bun harness.ts report' must explicitly track and display all lane tasks, the number of mandatory cognitive feedback rounds (Pushes: X/Y), adversarial probe reports/findings, micro-cycle iterations (Attempts: X/Y, In-Lease Repairs: Z), and coordinator-level ownership of the implementer-validator relationship flow and success metrics. 3) Hard-Coded Doctor Policy Validation: Hardcode Doctor checks to actively audit and fail if mandatory cognitive/adversarial pushback quotas from repo configuration are unmet. 4) Dedicated Auto-Healing Doctor: 'doctor' remains separate for active diagnostics and auto-healing. 5) Zero-LLM Self-Contained CLI Visibility: Enable human users and agents to inspect complete runtime state without prompting an LLM.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-1787971784118-1aghp.test.ts` (100% PASS).

### Task 1.2: Feature: Aggressive Doctor Command Enhancement: Default Auto-Healing, Unified Check Integration & Defect Lifecycle Sync

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-olt-unified-master-doctor-engine`
- **Write Scope:** `olt/scripts/src/mind/fb-olt-unified-master-doctor-engine.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: Transform 'bun harness.ts doctor' into a comprehensive, self-healing Master Diagnostic & Standards Engine: 1) Default Auto-Healing: 'doctor' runs auto-repair by default for all repairable state (re-deriving state projections, quarantining torn event tails, restoring missing runtime ledgers and indices). 2) Severity-Tiered Reporting: Non-repairable findings are surfaced with explicit severity levels (INFO for advisory metrics, WARN for approaching quota thresholds, ERROR for hard invariant violations). 3) Autonomous Defect Lifecycle & Regression Re-Opening: Doctor automatically pushes non-repaired findings to .olt/defects.jsonl. It deduplicates existing defects in-place without duplicate row churn. If a defect was previously COMPLETED but recurs, doctor automatically re-opens the defect (COMPLETED -> OPEN) with empirical failure proofs so the self-evolution Mind picks it up immediately. 4) Aggregate All Internal Verification Systems: Wires all 8 check engines into Doctor (Planning DAG Acyclic/Gate/Node validation via graph/validate-*.ts, AST-based zero-any/zero-suppression linter via validation/ast/ast-linter.ts, Anti-Mock & Mutation Gates via validation/mutation/mutation-gate.ts, Anti-Batching & 1:1 Isolation via validation/batching/anti-batching.ts, Dual-Channel UI validation via validation/channel/dual-channel-analyzer.ts, Cognitive Validator Command Hard-Lock via packets/command-authority-*.ts, Role Boundary Interlock via validation/leak/anti-leak.ts, and Mandatory Pushback Quotas MIN_ADVERSARIAL_PROBES=5 / MANDATORY_COGNITIVE_PUSHBACKS=5). 5) Sequential Lifecycle Command Ordering: Doctor enforces strict phase prerequisites (e.g. plan:init -> plan:enhance -> plan:add -> plan:compile).
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-olt-unified-master-doctor-engine.test.ts` (100% PASS).

### Task 1.3: Feature: Central Authoritative Policy JSON Configuration Engine, Per-Validator Custom Quotas, Docker Capture Auth Profiles & Dynamic Auto-Redeployment

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-central-repo-policy-json-engine`
- **Write Scope:** `olt/scripts/src/mind/fb-central-repo-policy-json-engine.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: Architect and enforce 'olt/policy.json' (or '.olt/policy.json') as the Central Authoritative Source of Truth and Single Configuration Engine for any target repository where OLT runs: 1) Mandatory Policy Creation & Default Encoding: On repo init or startup, if policy.json does not exist or has missing fields, automatically populate it with full default configurations. 2) Host-Based Agent Profiles & Thinking Effort Configuration: Default model for Antigravity CLI and Antigravity IDE across all agents (mind, orchestrator, coordinator, implementer, validator, planner, critic) is strictly Gemini 3.7 Flash (High) with high thinking effort. For Claude and OpenAI Codex, use their canonical configurations from claude.yaml (Claude 3.7 Sonnet/Opus with thinking) and codex.yaml/openai.yaml (o3-mini/o1/GPT-4o). 3) Per-Validator Custom Pushback & Adversarial Quotas (No Flat Global Settings): Cognitive pushback numbers (default: 5 mandatory rounds) and adversarial probe limits (optional, max 20) must be configurable per-agent and per-validator specialization (validator_code_quality, validator_ui_design, validator_security, validator_system_design, validator_product) directly inside their individual policy configs. Total validator turn limit = mandatory cognitive pushbacks + optional adversarial probes, capped at 20 turns. 4) Dynamic LLM Policy Generator for Repo Test Discovery: Global policy generator uses the LLM to inspect the target repository and automatically discover/encode custom command profiles for unit tests, integration tests, and end-to-end automation test suites. 5) Capture System & Local Docker Multi-User Auth Profiles: policy.json must encode the repository's visual capture system and local environment configuration (Docker container names, ports, mock database) and pre-configured test user personas/credentials across all role types (admin, standard_user, invited_member, guest) along with auth workflow paths (login, signup, logout, session cookies). This allows UI Validators (ui_validator, ui_mechanic_validator) to autonomously perform authenticated multi-viewport and cross-user testing in local Docker containers without ever asking the human user for credentials. 6) Per-Agent Schedulers & Cadence Governance: policy.json explicitly configures the recurring cron expressions and intervals per supervisory/companion agent (mind_supervisor: */5 * * * *, mind_auditor: */3 * * * *, skill_auditor: */3 * * * *, autonomic_watchdog: 30s heartbeats). Dynamic drift detection automatically cancels and re-registers timers/crons if these values are modified. 7) Dynamic Policy Drift Detection & Auto-Re-Deployment: If policy.json is modified (e.g. changing model tiers, validator pushback quotas, thinking budgets, auth profiles, or command permissions), the OLT harness automatically detects configuration drift, updates agent definitions (agent:define), terminates active out-of-sync agents (manage_subagents kill), and redeploys new agents instantiated with the latest policy definitions. 8) Tiered Command Authority Matrix (RBAC): Replace flat repo-wide forbidden_commands with granular, per-tier RBAC rules (Coordinators/Orchestrators have git commit/push authority for wave landing; Implementers are strictly forbidden from whole-repo tests and git commits; Cognitive Validators have 0-command hard-lock). 9) Cross-Repository Bridging & Skill Home Path: Embed 'skill_home_repo_root' pointing to the canonical skills repo (~/.agents/skills/olt or ~/repos/skills) so that when OLT executes in external repositories (e.g. limo, proxai_web), framework defects, blunder promotions, and learnings are automatically synchronized back to the skill source repository. 10) Dynamic Policy Health Certification in Doctor: Wire comprehensive policy schema validation into 'doctor' and 'plan:init' to audit policy completeness, auto-heal missing fields with defaults, and ensure runtime harness agent definitions dynamically reflect policy.json.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-central-repo-policy-json-engine.test.ts` (100% PASS).

### Task 1.4: Feature: Comprehensive docs/olt/ Architecture Chapters and Reference Overhaul

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-1787995932981-yc49l`
- **Write Scope:** `olt/scripts/src/mind/fb-1787995932981-yc49l.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: Restructure docs/olt/ into two pristine domains: architecture/ (numbered chapter folders with index.md, rich ASCII diagrams, algorithms, and deep educational visual content) and reference/ (direct user guides for mind and single task mode, CLI reference, error codes). Prune outdated tutorials/how-to folders.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-1787995932981-yc49l.test.ts` (100% PASS).

### Task 1.5: Feature: Mind Plan Efficiency Optimization & Mind Auditor Granularity Gate Engine

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-mind-plan-efficiency-optimization-and-auditor-granularity-gate`
- **Write Scope:** `olt/scripts/src/mind/fb-mind-plan-efficiency-optimization-and-auditor-granularity-gate.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: USER-DIRECTED GOVERNANCE POLICY. Simply creating large plan files is insufficient. Tier 0 Mind must relentlessly question existing plan efficiency, calculate Work/Span (P=W/S), and recursively decompose multi-subsystem features into modular, atomic sub-plans (<=3 files, <=5 minutes execution SLA). Simultaneously, Mind Auditor must be enhanced beyond time-based stagnation to actively audit Plan Granularity and Topology (PLAN_GRANULARITY_AUDIT), flagging MONOLITHIC_PLAN_DEFECT and pushing back on Mind whenever a plan bundles multiple subsystems or exceeds atomic boundaries. Update mind.yaml and mind-auditor.yaml manifests, AGENTS.md, and harness auditing engines to enforce this contract permanently.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-mind-plan-efficiency-optimization-and-auditor-granularity-gate.test.ts` (100% PASS).

### Task 1.6: Feature: Mind Orchestrator Lifecycle Reconciliation, Ghost Detection & Bound Capsule Enforcement

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-mind-orchestrator-lifecycle-reconciliation-and-ghost-detection`
- **Write Scope:** `olt/scripts/src/mind/fb-mind-orchestrator-lifecycle-reconciliation-and-ghost-detection.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: Owner-reported defect and critical architectural enhancement: Eliminate silent orchestrator dropping by: (1) Requiring every spawned Tier 1 Orchestrator to register its PID and run_id in Mind's state ledger; (2) Requiring Mind Auditor to perform live OS subagent roster reconciliation (flagging UNREGISTERED_GHOST_ORCHESTRATOR or ORPHAN_TASK); (3) Guaranteeing every orchestrator binds a permanent capsule under .olt/capsules/<run_id>/ so meta-audit and defect logging catch crashes and teardowns.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-mind-orchestrator-lifecycle-reconciliation-and-ghost-detection.test.ts` (100% PASS).

### Task 1.7: Feature: Mind Stagnation & Agentic Loop Interruption: Auditor Wakeup Failed to Shock Mind Into Non-Stop Loop

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-1788010306731-r4apu`
- **Write Scope:** `olt/scripts/src/mind/fb-1788010306731-r4apu.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: why the system destroyed all agents and kept only the mind agents, also are some tasks that are completed up to this point so far completed, committed and pushed. also, mind auditor woke up now, messages to mind agent and slept. but that did not caused any behavioral change on this mind, shock them to wake up and do their tasks properly and make the agentic loop of mind continue in non stop loop, also save this current prompt as defect.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-1788010306731-r4apu.test.ts` (100% PASS).

### Task 1.8: Feature: Chronic Mind Stagnation, Low-Quality Auditor Feedback & Inactive Supervisory Agents

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-1788014300272-djnhy`
- **Write Scope:** `olt/scripts/src/mind/fb-1788014300272-djnhy.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: CRITICAL OPERATOR REPORT: Mind does not wake up or execute real work; chronic failure to maintain active execution loop. Mind Auditor feedbacks are boilerplate/low-quality and fail to shock Mind into real execution. Mind agent forgets its responsibilities and only drops conversational status without CLI action. Mind Auditor and Skill Auditor are failing to run active continuous deep behavioral audits. Demands immediate pick-up and full remediation.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/fb-1788014300272-djnhy.test.ts` (100% PASS).

### Task 1.9: Defect Remediation: Supervisory tiers narrate per-step progress to the main interactive thread, burning the owner's finite session budget with information they did not ask for and cannot act on

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-main-thread-chatter-burns-owner-context` (Error Code: `SUPERVISORY_PROGRESS_NARRATION_TO_HUMAN_RELAY_SEAT`)
- **Write Scope:** `olt/scripts/src/mind/defect-main-thread-chatter-burns-owner-context.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Owner-reported, and reported for the SECOND time - the same feedback was given in a prior session and did not stick, which is itself the evidence that guidance is the wrong instrument here. MECHANISM: supervisory tiers (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) relay per-step progress, lane-start announcements and running status updates INTO THE MAIN INTERACTIVE THREAD. The main thread is a HUMAN-FACING RELAY SEAT, not a supervisory bus: its only legitimate functions are issuing owner rulings and relaying finished outcomes. THREE DISTINCT COSTS, and the third is the one that ends sessions. (1) It burns the OWNER'S context with information they did not ask for. Standing owner directive 5 is explicit: no status reports unless asked, silence is the correct output when work is proceeding. (2) The information is UNACTIONABLE at that seat - a lane-start announcement or a mid-flight status line gives the owner nothing to decide, because the decision it would inform belongs to the tier that sent it. Directive 4: the owner walks away for hours and will not read a live feed; problems become RECORDED DEFECTS, not chat. (3) It COMPETES FOR THE SAME FINITE SESSION BUDGET WHOSE EXHAUSTION KILLED THE PREVIOUS FLEET. This is not an aesthetic complaint about verbosity. The fleet that died at approximately 14:15Z did not degrade as it approached the API session limit - it ran at full concurrency until the API refused and every agent died at once, several mid-write. Every token of unrequested narration spent in the main thread was budget unavailable to the work, and the main thread was THE PRINCIPAL OFFENDER in that session. Method canon rule from the same engagement applies directly: BUDGET, NOT WALL-CLOCK, IS THE CONSTRAINT. CORRECT BEHAVIOUR: peer-to-peer messaging between agents for coordination; recorded defects and backlog items for problems; the main thread receives a SINGLE finished synthesis at terminal state, or an escalation that genuinely requires an owner ruling, and nothing else.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-main-thread-chatter-burns-owner-context.test.ts` (100% PASS).

### Task 1.10: Defect Remediation: Loose executable/runtime files detected in repository root and olt/ (fix-pulse.ts, olt/defects.jsonl)

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-root-hygiene-loose-files-detected` (Error Code: `ROOT_HYGIENE_VIOLATION`)
- **Write Scope:** `olt/scripts/src/mind/defect-root-hygiene-loose-files-detected.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Root hygiene watchdog scan detected loose files violating Invariant 30: (1) 'fix-pulse.ts' located directly in repo root instead of scratch/ or scripts/; (2) 'olt/defects.jsonl' located in static package root instead of canonical '.olt/'. Wave completion blocked until scrubbed.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-root-hygiene-loose-files-detected.test.ts` (100% PASS).

### Task 1.11: Defect Remediation: Unresolved import '../../mind/archival.ts' in engine/store/index.ts and mind/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-engine-store-unresolved-mind-archival-import` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_STORE`)
- **Write Scope:** `olt/scripts/src/mind/defect-engine-store-unresolved-mind-archival-import.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/engine/store/index.ts imports '../../mind/archival.ts' and olt/scripts/src/mind/index.ts imports './archival.ts', but archival.ts was split into mind/archival/archival-chunk[1-7].ts without barrel/facade exports. This breaks CLI harness startup and live audits.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-engine-store-unresolved-mind-archival-import.test.ts` (100% PASS).

### Task 1.12: Defect Remediation: Unresolved import './aggregator.ts' in mind/defects/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-defects-unresolved-aggregator-import` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_DEFECTS`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-defects-unresolved-aggregator-import.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/defects/index.ts imports './aggregator.ts', but aggregator was relocated to mind/defects/slices/ without a facade export. This breaks harness doctor.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-defects-unresolved-aggregator-import.test.ts` (100% PASS).

### Task 1.13: Defect Remediation: Unresolved import '../../engine/scheduler/diagnostics.ts' in cli/commands/mind-pulse.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-mind-pulse-unresolved-diagnostics-import` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_CLI`)
- **Write Scope:** `olt/scripts/src/mind/defect-cli-mind-pulse-unresolved-diagnostics-import.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/cli/commands/mind-pulse.ts imports '../../engine/scheduler/diagnostics.ts', which was moved to engine/scheduler/diagnostics/diagnostics.ts. This breaks harness dag.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-cli-mind-pulse-unresolved-diagnostics-import.test.ts` (100% PASS).

### Task 1.14: Defect Remediation: Missing module 'core/config/constants.ts' imported across 6 workflow and task files

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-core-config-constants-unresolved-module` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW`)
- **Write Scope:** `olt/scripts/src/mind/defect-core-config-constants-unresolved-module.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: workflow/review/coordinator-pushback.ts, workflow/completion/begin-completeness-critic.ts, workflow/completion/critic-feedback-loop.ts, task/pushback.ts, orchestrator/recursive-critic-feedback.ts, and workflow/review/record-review.ts attempt to import MAX_REPAIR_ROUNDS from non-existent 'core/config/constants.ts'.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-core-config-constants-unresolved-module.test.ts` (100% PASS).

### Task 1.15: Defect Remediation: Missing 'node:path' imports in mind/auditing/slices/group0/slice_28.ts causing runtime Fatal Internal Error

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-auditing-slices-missing-node-path-imports` (Error Code: `MISSING_NODE_PATH_IMPORTS`)
- **Write Scope:** `olt/scripts/src/mind/defect-auditing-slices-missing-node-path-imports.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: slice_28.ts calls resolve(), join(), basename() without importing them from 'node:path', causing 'Fatal Internal Error: resolve is not defined' when running skill:audit:live.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-auditing-slices-missing-node-path-imports.test.ts` (100% PASS).

### Task 1.16: Defect Remediation: Missing exported member 'RoleBoundaryWatchdog' in mind/role-auditing.ts for verify-gen5.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-verify-gen5-unresolved-role-boundary-watchdog` (Error Code: `UNEXPORTED_MEMBER_IMPORT`)
- **Write Scope:** `olt/scripts/src/mind/defect-verify-gen5-unresolved-role-boundary-watchdog.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: scripts/verify-gen5.ts imports named member 'RoleBoundaryWatchdog' from '../olt/scripts/src/mind/role-auditing.ts', but role-auditing.ts exports 'createRoleBoundaryWatchdog'.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-verify-gen5-unresolved-role-boundary-watchdog.test.ts` (100% PASS).

### Task 1.17: Defect Remediation: Property 'prescribed_remediation' does not exist on type 'DefectEntry'

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-task-discovery-defective-property-access` (Error Code: `NON_EXISTENT_PROPERTY_ACCESS`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-task-discovery-defective-property-access.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/task-discovery.ts:1442 accesses 'prescribed_remediation' on DefectEntry, triggering TypeScript TS2339 compiler error.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-task-discovery-defective-property-access.test.ts` (100% PASS).

### Task 1.18: Defect Remediation: Implicit 'any' parameter 'd' in reporting/doctor/planning-dag-engine.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-doctor-planning-dag-implicit-any` (Error Code: `IMPLICIT_ANY_PARAMETER`)
- **Write Scope:** `olt/scripts/src/mind/defect-doctor-planning-dag-implicit-any.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/reporting/doctor/planning-dag-engine.ts:111 has parameter 'd' implicitly typed as 'any', violating 0 TypeScript any cognitive contracts.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-doctor-planning-dag-implicit-any.test.ts` (100% PASS).

### Task 1.19: Defect Remediation: Property 'bl.observation' possibly undefined in mind/task-discovery.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-task-discovery-optional-observation-guard` (Error Code: `POSSIBLY_UNDEFINED_PROPERTY_ACCESS`)
- **Write Scope:** `olt/scripts/src/mind/defect-task-discovery-optional-observation-guard.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/task-discovery.ts:1431, 1439 accesses bl.observation without null/undefined guard, causing TypeScript TS18048 errors.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-task-discovery-optional-observation-guard.test.ts` (100% PASS).

### Task 1.20: Defect Remediation: Stale relative imports in mind/auditing/cognitive/ chunk files after modularization

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-auditing-cognitive-unresolved-relative-imports` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-auditing-cognitive-unresolved-relative-imports.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk1.ts and chunk2.ts import './last-pulse.ts' and './meta-auditor.ts' which are located in parent directory, and witness.ts imports unexported collectCapsuleSearchRoots.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-auditing-cognitive-unresolved-relative-imports.test.ts` (100% PASS).

### Task 1.21: Defect Remediation: Missing barrel/facade modules for mind/pulse-reclaim.ts and mind/value.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-facade-missing-pulse-reclaim-and-value` (Error Code: `MISSING_FACADE_RE_EXPORT`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-facade-missing-pulse-reclaim-and-value.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cli/commands/mind-wake.ts and mind-pulse.ts import mind/pulse-reclaim.ts and mind/value.ts which were split into sub-files without retaining barrel re-exports.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-facade-missing-pulse-reclaim-and-value.test.ts` (100% PASS).

### Task 1.22: Defect Remediation: Syntax errors (TS1005, TS1128) in split task discovery and proposal chunks

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-tasks-partitioning-syntax-errors` (Error Code: `SYNTAX_ERRORS_DURING_PARTITIONING`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-tasks-partitioning-syntax-errors.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Automated partitioning produced unbalanced closing braces and statement syntax errors across mind/tasks/smart/, mind/tasks/discovery/, and mind/proposals/.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-tasks-partitioning-syntax-errors.test.ts` (100% PASS).

### Task 1.23: Defect Remediation: Missing export 'executeQuiesceLane' in archival/quiesce/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-archival-quiesce-missing-export` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-archival-quiesce-missing-export.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/quiesce.ts and harness import 'executeQuiesceLane' from './archival/quiesce/index.ts' which does not export it.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-archival-quiesce-missing-export.test.ts` (100% PASS).

### Task 1.24: Defect Remediation: Duplicate identifier 'rebalanceTasksWithBrentLimits' in smart-task-chunk9.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-smart-task-duplicate-identifier-rebalance-tasks` (Error Code: `DUPLICATE_IDENTIFIER_DECLARATION`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-smart-task-duplicate-identifier-rebalance-tasks.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/tasks/smart/smart-task-chunk9.ts:104 declares 'rebalanceTasksWithBrentLimits' twice, triggering TypeScript TS2300 compiler error.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-smart-task-duplicate-identifier-rebalance-tasks.test.ts` (100% PASS).

### Task 1.25: Defect Remediation: Missing export 'deployHierarchy' in lifecycle/deploy/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-lifecycle-deploy-missing-export` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-lifecycle-deploy-missing-export.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/deploy.ts and harness import 'deployHierarchy' from './lifecycle/deploy/index.ts' which does not export it.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-lifecycle-deploy-missing-export.test.ts` (100% PASS).

### Task 1.26: Defect Remediation: Duplicate export 'atomicAdmissionToDispatch' in mind/tasks/smart/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-tasks-smart-duplicate-export-atomic-admission` (Error Code: `DUPLICATE_EXPORT_DECLARATION`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-tasks-smart-duplicate-export-atomic-admission.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/tasks/smart/index.ts exports 'atomicAdmissionToDispatch' multiple times, causing runtime SyntaxError in bun execution.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-tasks-smart-duplicate-export-atomic-admission.test.ts` (100% PASS).

### Task 1.27: Defect Remediation: Undeclared identifier 'mapFeedbackPriorityToTaskPriority' in smart-task-chunk9.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-smart-task-missing-map-feedback-priority` (Error Code: `UNDECLARED_IDENTIFIER_REFERENCE`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-smart-task-missing-map-feedback-priority.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/tasks/smart/smart-task-chunk9.ts:193 references undeclared function 'mapFeedbackPriorityToTaskPriority', triggering TypeScript TS2304 error.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-smart-task-missing-map-feedback-priority.test.ts` (100% PASS).

### Task 1.28: Defect Remediation: Missing export 'auditLiveMindStagnation' in cognitive-auditors-chunk1.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-auditing-cognitive-missing-audit-live-mind-stagnation` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-auditing-cognitive-missing-audit-live-mind-stagnation.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/mind/auditing/cognitive/index.ts imports 'auditLiveMindStagnation' from './cognitive-auditors-chunk1.ts' which does not export it.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-auditing-cognitive-missing-audit-live-mind-stagnation.test.ts` (100% PASS).

### Task 1.29: Defect Remediation: Missing export 'SkillAuditorEngine' in mind/auditing/cognitive/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-auditing-cognitive-missing-skill-auditor-engine` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-auditing-cognitive-missing-skill-auditor-engine.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: orchestrator/companion-auditor.ts imports 'SkillAuditorEngine' from '../mind/auditing/cognitive/index.ts' which does not export it.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-auditing-cognitive-missing-skill-auditor-engine.test.ts` (100% PASS).

### Task 1.30: Defect Remediation: Stale imports to mind/auditing/index.ts and mind/lifecycle/pulse/index.ts in CLI commands

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-commands-stale-mind-modularization-imports` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_CLI_COMMANDS`)
- **Write Scope:** `olt/scripts/src/mind/defect-cli-commands-stale-mind-modularization-imports.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cli/commands/mind-audit.ts and mind-pulse.ts import mind/auditing/index.ts and mind/lifecycle/pulse/index.ts which are missing or incomplete.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-cli-commands-stale-mind-modularization-imports.test.ts` (100% PASS).

### Task 1.31: Defect Remediation: Duplicate exports for AuditorCursorStore and checkProposalRateLimits in mind barrels

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-duplicate-exports-auditor-cursor-and-proposal-limits` (Error Code: `DUPLICATE_EXPORT_DECLARATION`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-duplicate-exports-auditor-cursor-and-proposal-limits.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: mind/ barrel re-exports AuditorCursorStore and checkProposalRateLimits multiple times, causing runtime SyntaxError.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-duplicate-exports-auditor-cursor-and-proposal-limits.test.ts` (100% PASS).

### Task 1.32: Defect Remediation: Missing sub-chunk partition files referenced in mind chunk facades

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-subchunk-missing-partitions` (Error Code: `UNRESOLVED_SUBCHUNK_MODULE_IMPORT`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-subchunk-missing-partitions.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: proposal-chunk5.ts, memory-chunk3.ts, and feedback-queue-chunk1.ts reference sub-partitions before they are written to disk.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-subchunk-missing-partitions.test.ts` (100% PASS).

### Task 1.33: Defect Remediation: SyntaxError unexpected closing brace in feedback-queue-chunk2.ts:7:3

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-feedback-queue-syntax-error` (Error Code: `SYNTAX_ERROR_UNBALANCED_BRACE`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-feedback-queue-syntax-error.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Partitioned feedback-queue-chunk2.ts contains dangling closing brace triggering SyntaxError.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-feedback-queue-syntax-error.test.ts` (100% PASS).

### Task 1.34: Defect Remediation: Syntax errors in task-queue chunk split and duplicate renderCharterLine export

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-task-queue-chunk-split-errors` (Error Code: `SYNTAX_ERROR_IN_SUBCHUNK_SPLIT`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-task-queue-chunk-split-errors.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: task-queue-chunk1.ts and chunk2.ts contain incomplete block statements and unexpected EOF, lifecycle/charter has duplicate export.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-task-queue-chunk-split-errors.test.ts` (100% PASS).

### Task 1.35: Defect Remediation: Missing export 'isRecord' in mind/core/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-core-missing-is-record-export` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-core-missing-is-record-export.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: mind/core/index.ts does not export 'isRecord', triggering SyntaxError in mind modules and harness CLI.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-core-missing-is-record-export.test.ts` (100% PASS).

### Task 1.36: Defect Remediation: Missing renderers.ts and table.ts referenced during proposals domain semantic migration

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-proposals-semantic-renaming-missing-files` (Error Code: `UNRESOLVED_SEMANTIC_MODULE_IMPORT`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-proposals-semantic-renaming-missing-files.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: mind/proposals/builder/index.ts and mind/proposals/brief/index.ts import newly planned semantic modules before file creation completes.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-proposals-semantic-renaming-missing-files.test.ts` (100% PASS).

### Task 1.37: Defect Remediation: Unterminated string literal in similarity.ts:12 and missing resolveTaskQueuePath export in storage.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-similarity-syntax-and-storage-export` (Error Code: `SYNTAX_ERROR_UNTERMINATED_STRING`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-similarity-syntax-and-storage-export.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: mind/auditing/roles/similarity.ts line 12 has an unterminated string literal and mind/tasks/queue/storage.ts is missing resolveTaskQueuePath.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-similarity-syntax-and-storage-export.test.ts` (100% PASS).

### Task 1.38: Defect Remediation: Missing export formatCitation in formatter.ts during proposals semantic refactor

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-brief-missing-format-citation-export` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-brief-missing-format-citation-export.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: mind/proposals/brief/index.ts re-exports formatCitation from ./formatter.ts, which is missing from formatter.ts.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-brief-missing-format-citation-export.test.ts` (100% PASS).

### Task 1.39: Defect Remediation: Missing quality-scanner.ts referenced in tasks discovery engine.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-tasks-discovery-missing-quality-scanner` (Error Code: `UNRESOLVED_SEMANTIC_MODULE_IMPORT`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-tasks-discovery-missing-quality-scanner.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: mind/tasks/discovery/engine.ts imports ./quality-scanner.ts which is not yet created on disk.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-tasks-discovery-missing-quality-scanner.test.ts` (100% PASS).

### Task 1.40: Defect Remediation: Missing PERPETUAL_NON_STOPPING_CADENCE export in mind/lifecycle/evolution/types.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-lifecycle-evolution-missing-constant` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-lifecycle-evolution-missing-constant.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: mind/lifecycle/evolution/types.ts is missing the export for PERPETUAL_NON_STOPPING_CADENCE.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-lifecycle-evolution-missing-constant.test.ts` (100% PASS).

### Task 1.41: Defect Remediation: Tier 0 Mind Stagnation Detected

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-1787994561107-294wxo` (Error Code: `LIVE_STAGNATION_DETECTED`)
- **Write Scope:** `olt/scripts/src/mind/defect-1787994561107-294wxo.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Tier 0 Mind has been idle for 229s (threshold: 120s). Mode B wakeup injection synthesized.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-1787994561107-294wxo.test.ts` (100% PASS).

### Task 1.42: Defect Remediation: Banned `as any` type assertions in tests/unit/telemetry/quota-lifecycle.test.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-quota-lifecycle-test-ast-any-suppression` (Error Code: `AST_PURITY_ANY_VIOLATION`)
- **Write Scope:** `olt/scripts/src/mind/defect-quota-lifecycle-test-ast-any-suppression.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Doctor diagnostic checkAstPurity detected AST purity invariant violations at lines 55 and 85 in tests/unit/telemetry/quota-lifecycle.test.ts: banned `as any` usage violates 0 TypeScript any cognitive contracts.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-quota-lifecycle-test-ast-any-suppression.test.ts` (100% PASS).

### Task 1.43: Defect Remediation: Mind creates monolithic multi-subsystem plans instead of optimizing and decomposing into atomic sub-plans; Mind Auditor passively checks file existence instead of auditing plan efficiency and modularity

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-monolithic-plan-clustering-and-auditor-blindness` (Error Code: `SUPERFICIAL_PLAN_CLUSTERING_AND_AUDITOR_BLINDNESS`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-monolithic-plan-clustering-and-auditor-blindness.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Owner-reported defect: Mind blindly bundles disparate subsystems into massive 50KB+ monolithic plans (violating Work/Span P=W/S and the 5-Minute Straggler SLA) rather than questioning existing plan efficiency and recursively decomposing them into atomic sub-plans (<=3 files each). Simultaneously, Mind Auditor passively verifies file existence and byte counts without auditing plan topology, granularity, or modularity. Fix required: (1) Enhance Mind to relentlessly question plan efficiency and decompose multi-subsystem features into atomic sub-plans. (2) Enhance Mind Auditor to enforce PLAN_GRANULARITY_AUDIT flagging MONOLITHIC_PLAN_DEFECT on oversized or multi-subsystem plans.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-monolithic-plan-clustering-and-auditor-blindness.test.ts` (100% PASS).

### Task 1.44: Defect Remediation: Monolithic multi-subsystem bundling in docs/planning/mind-continuous-preplanning-factory-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-monolithic-preplanning-factory` (Error Code: `MONOLITHIC_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/mind/defect-plan-granularity-monolithic-preplanning-factory.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Mind Continuous Pre-Planning Engine & Asynchronous Assembly Pipeline" bundles 6 orthogonal subsystems (Backlog clusterer, Plan factory & bridge state, Straggler watchdog, Velocity rebalancer, Station landing & staging, Cognitive auditors) into a single monolithic plan. Requires decomposition into atomic sub-plans.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-plan-granularity-monolithic-preplanning-factory.test.ts` (100% PASS).

### Task 1.45: Defect Remediation: Plan scope exceeds 5-Minute Execution SLA (>3 files) in docs/planning/mind-continuous-preplanning-factory-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-straggler-preplanning-factory` (Error Code: `STRAGGLER_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/mind/defect-plan-granularity-straggler-preplanning-factory.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Mind Continuous Pre-Planning Engine & Asynchronous Assembly Pipeline" spans 26 files without sub-plan partitioning, violating the <=3 files per sub-plan invariant and exceeding the 5-Minute Execution SLA.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-plan-granularity-straggler-preplanning-factory.test.ts` (100% PASS).

### Task 1.46: Defect Remediation: Mind and Mind Auditor lack epistemic awareness of out-of-band/detached orchestrators, causing silent process drops without capsule failure records

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-detached-orchestrator-drop-and-capsule-isolation-gap` (Error Code: `DETACHED_ORCHESTRATOR_LIFECYCLE_DROP`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-detached-orchestrator-drop-and-capsule-isolation-gap.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: When Tier 1 Orchestrators or long-running tasks are spawned directly without being registered in Mind's capsule state ledger (.olt/capsules/mind-gen-*/state.json), Mind remains completely unaware of their lifecycle, PIDs, or tasks. When subagent teardowns, manifest reloads, or process exits occur, Mind does not detect the termination, does not trigger task recovery, and records no failure events. Concurrently, Mind Auditor only checks pulse recurrence rather than reconciling active OS subagents against the capsule ledger. Fix required: (1) Enforce strict registration of all spawned orchestrators in the Mind state machine; (2) Implement subagent roster reconciliation in Mind Auditor to detect ghost or detached orchestrators; (3) Ensure all orchestrators initialize a bound capsule under .olt/capsules/<run_id>/ with persistent event telemetry.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-detached-orchestrator-drop-and-capsule-isolation-gap.test.ts` (100% PASS).

### Task 1.47: Defect Remediation: Multiple redundant skill auditor instances spawned instead of a single consolidated fleet auditor across all sub-tiers

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-redundant-multi-instance-skill-auditor-spawning` (Error Code: `REDUNDANT_FLEET_AUDITOR_SPAWNING`)
- **Write Scope:** `olt/scripts/src/mind/defect-redundant-multi-instance-skill-auditor-spawning.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Multiple instances of skill_auditor were spawned concurrently, burning session quota and creating competing audit loops. Under the canonical 2-Auditor Paradigm, there must be exactly ONE Mind Auditor companion for Tier 0, and exactly ONE consolidated Skill Auditor companion monitoring all execution tiers (Tiers 1-3). Spawning per-orchestrator or duplicate skill auditors violates the 2-auditor architecture. Fix required: (1) Enforce a strict singleton lifecycle constraint for skill_auditor in the harness and spawn policies; (2) Ensure one unified Skill Auditor handles all active runs across all orchestrators simultaneously.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-redundant-multi-instance-skill-auditor-spawning.test.ts` (100% PASS).

### Task 1.48: Defect Remediation: Mind Stagnation & Agentic Loop Interruption: Auditor Wakeup Failed to Trigger Behavioral Execution

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-stagnation-auditor-shock-failure` (Error Code: `MIND_STAGNATION_LOOP_INTERRUPT`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-stagnation-auditor-shock-failure.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: User reported: why the system destroyed all agents and kept only the mind agents, also are some tasks that are completed up to this point so far completed, committed and pushed. also, mind auditor woke up now, messages to mind agent and slept. but that did not caused any behavioral change on this mind, shock them to wake up and do their tasks properly and make the agentic loop of mind continue in non stop loop, also save this current prompt as defect.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-stagnation-auditor-shock-failure.test.ts` (100% PASS).

### Task 1.49: Defect Remediation: Tier 0 Mind responds to chat pulses without writing mind:pulse timestamp to disk, causing repeated auditor stagnation false-positives

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-pulse-disk-state-desync` (Error Code: `MIND_PULSE_DISK_STATE_DESYNC`)
- **Write Scope:** `olt/scripts/src/mind/defect-mind-pulse-disk-state-desync.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Tier 0 Mind acknowledges pulses and coordinates subagents in conversation context but fails to execute `bun harness.ts mind:pulse --run .olt/capsules/mind-gen-6` to update last_pulse.json on disk. Consequently, the independent Mind Auditor reads the stale on-disk timestamp (e.g. 2026-08-29T01:55:01.227Z), computes an idle duration of >45,000s, and repeatedly raises false-positive stagnation alerts. Fix required: Enforce that Mind must execute the CLI command mind:pulse on every supervisory tick to write its timestamp to last_pulse.json.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-mind-pulse-disk-state-desync.test.ts` (100% PASS).

### Task 1.50: Defect Remediation: Chronic Mind Stagnation, Low-Quality Auditor Feedback Loops & Inactive Supervisory Agents

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-chronic-mind-stagnation-low-quality-auditor-loop` (Error Code: `CHRONIC_MIND_STAGNATION_AND_LOW_QUALITY_AUDITOR_FEEDBACK`)
- **Write Scope:** `olt/scripts/src/mind/defect-chronic-mind-stagnation-low-quality-auditor-loop.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: The Mind agent exhibits chronic stagnation, acknowledging pulses in conversational prose without executing CLI commands or dispatching actual worker fleets. Concurrently, Mind Auditor emits repetitive boilerplate warnings that fail to provide high-quality structural critique or shock Mind into action, and Skill Auditor / Mind Auditor do not maintain active continuous runtime deep behavioral inspections. Immediate mandatory pickup and structural remediation required.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-chronic-mind-stagnation-low-quality-auditor-loop.test.ts` (100% PASS).

### Task 1.51: Defect Remediation: Harness CLI doctor diagnostics and stagnation alerts lack an automated active execution interlock to break repetitive idle loops

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-doctor-stagnation-unactionable-gap` (Error Code: `DOCTOR_STAGNATION_UNACTIONABLE_GAP`)
- **Write Scope:** `olt/scripts/src/mind/defect-doctor-stagnation-unactionable-gap.ts`
- **Read-Only Scope:** `olt/scripts/src/mind/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Harness CLI doctor and Mind Auditor report stagnation based on disk state but lack an automated active shock / self-repair interlock that forces Mind to execute CLI commands or re-instantiates stalled supervisory state machines. As a result, the system remains trapped in a passive reporting loop where stagnation is continually logged without inducing operational action. Fix required: Introduce an automated execution interlock in doctor/watchdog that transitions from passive reporting to active CLI command enforcement and hard subagent re-initialization upon 3 consecutive stagnant pulses.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/mind/defect-doctor-stagnation-unactionable-gap.test.ts` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Order: [Task 1.1] ──► [Verification] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID | Resolved By Task | Verification Test File |
| :--- | :--- | :--- |
| `fb-1787971784118-1aghp` | Task 1.x | `tests/unit/mind/fb-1787971784118-1aghp.test.ts` |
| `fb-olt-unified-master-doctor-engine` | Task 1.x | `tests/unit/mind/fb-olt-unified-master-doctor-engine.test.ts` |
| `fb-central-repo-policy-json-engine` | Task 1.x | `tests/unit/mind/fb-central-repo-policy-json-engine.test.ts` |
| `fb-1787995932981-yc49l` | Task 1.x | `tests/unit/mind/fb-1787995932981-yc49l.test.ts` |
| `fb-mind-plan-efficiency-optimization-and-auditor-granularity-gate` | Task 1.x | `tests/unit/mind/fb-mind-plan-efficiency-optimization-and-auditor-granularity-gate.test.ts` |
| `fb-mind-orchestrator-lifecycle-reconciliation-and-ghost-detection` | Task 1.x | `tests/unit/mind/fb-mind-orchestrator-lifecycle-reconciliation-and-ghost-detection.test.ts` |
| `fb-1788010306731-r4apu` | Task 1.x | `tests/unit/mind/fb-1788010306731-r4apu.test.ts` |
| `fb-1788014300272-djnhy` | Task 1.x | `tests/unit/mind/fb-1788014300272-djnhy.test.ts` |
| `defect-main-thread-chatter-burns-owner-context` | Task 1.x | `tests/unit/mind/defect-main-thread-chatter-burns-owner-context.test.ts` |
| `defect-root-hygiene-loose-files-detected` | Task 1.x | `tests/unit/mind/defect-root-hygiene-loose-files-detected.test.ts` |
| `defect-engine-store-unresolved-mind-archival-import` | Task 1.x | `tests/unit/mind/defect-engine-store-unresolved-mind-archival-import.test.ts` |
| `defect-mind-defects-unresolved-aggregator-import` | Task 1.x | `tests/unit/mind/defect-mind-defects-unresolved-aggregator-import.test.ts` |
| `defect-cli-mind-pulse-unresolved-diagnostics-import` | Task 1.x | `tests/unit/mind/defect-cli-mind-pulse-unresolved-diagnostics-import.test.ts` |
| `defect-core-config-constants-unresolved-module` | Task 1.x | `tests/unit/mind/defect-core-config-constants-unresolved-module.test.ts` |
| `defect-auditing-slices-missing-node-path-imports` | Task 1.x | `tests/unit/mind/defect-auditing-slices-missing-node-path-imports.test.ts` |
| `defect-verify-gen5-unresolved-role-boundary-watchdog` | Task 1.x | `tests/unit/mind/defect-verify-gen5-unresolved-role-boundary-watchdog.test.ts` |
| `defect-mind-task-discovery-defective-property-access` | Task 1.x | `tests/unit/mind/defect-mind-task-discovery-defective-property-access.test.ts` |
| `defect-doctor-planning-dag-implicit-any` | Task 1.x | `tests/unit/mind/defect-doctor-planning-dag-implicit-any.test.ts` |
| `defect-task-discovery-optional-observation-guard` | Task 1.x | `tests/unit/mind/defect-task-discovery-optional-observation-guard.test.ts` |
| `defect-mind-auditing-cognitive-unresolved-relative-imports` | Task 1.x | `tests/unit/mind/defect-mind-auditing-cognitive-unresolved-relative-imports.test.ts` |
| `defect-mind-facade-missing-pulse-reclaim-and-value` | Task 1.x | `tests/unit/mind/defect-mind-facade-missing-pulse-reclaim-and-value.test.ts` |
| `defect-mind-tasks-partitioning-syntax-errors` | Task 1.x | `tests/unit/mind/defect-mind-tasks-partitioning-syntax-errors.test.ts` |
| `defect-mind-archival-quiesce-missing-export` | Task 1.x | `tests/unit/mind/defect-mind-archival-quiesce-missing-export.test.ts` |
| `defect-mind-smart-task-duplicate-identifier-rebalance-tasks` | Task 1.x | `tests/unit/mind/defect-mind-smart-task-duplicate-identifier-rebalance-tasks.test.ts` |
| `defect-mind-lifecycle-deploy-missing-export` | Task 1.x | `tests/unit/mind/defect-mind-lifecycle-deploy-missing-export.test.ts` |
| `defect-mind-tasks-smart-duplicate-export-atomic-admission` | Task 1.x | `tests/unit/mind/defect-mind-tasks-smart-duplicate-export-atomic-admission.test.ts` |
| `defect-mind-smart-task-missing-map-feedback-priority` | Task 1.x | `tests/unit/mind/defect-mind-smart-task-missing-map-feedback-priority.test.ts` |
| `defect-mind-auditing-cognitive-missing-audit-live-mind-stagnation` | Task 1.x | `tests/unit/mind/defect-mind-auditing-cognitive-missing-audit-live-mind-stagnation.test.ts` |
| `defect-mind-auditing-cognitive-missing-skill-auditor-engine` | Task 1.x | `tests/unit/mind/defect-mind-auditing-cognitive-missing-skill-auditor-engine.test.ts` |
| `defect-cli-commands-stale-mind-modularization-imports` | Task 1.x | `tests/unit/mind/defect-cli-commands-stale-mind-modularization-imports.test.ts` |
| `defect-mind-duplicate-exports-auditor-cursor-and-proposal-limits` | Task 1.x | `tests/unit/mind/defect-mind-duplicate-exports-auditor-cursor-and-proposal-limits.test.ts` |
| `defect-mind-subchunk-missing-partitions` | Task 1.x | `tests/unit/mind/defect-mind-subchunk-missing-partitions.test.ts` |
| `defect-mind-feedback-queue-syntax-error` | Task 1.x | `tests/unit/mind/defect-mind-feedback-queue-syntax-error.test.ts` |
| `defect-mind-task-queue-chunk-split-errors` | Task 1.x | `tests/unit/mind/defect-mind-task-queue-chunk-split-errors.test.ts` |
| `defect-mind-core-missing-is-record-export` | Task 1.x | `tests/unit/mind/defect-mind-core-missing-is-record-export.test.ts` |
| `defect-mind-proposals-semantic-renaming-missing-files` | Task 1.x | `tests/unit/mind/defect-mind-proposals-semantic-renaming-missing-files.test.ts` |
| `defect-mind-similarity-syntax-and-storage-export` | Task 1.x | `tests/unit/mind/defect-mind-similarity-syntax-and-storage-export.test.ts` |
| `defect-mind-brief-missing-format-citation-export` | Task 1.x | `tests/unit/mind/defect-mind-brief-missing-format-citation-export.test.ts` |
| `defect-mind-tasks-discovery-missing-quality-scanner` | Task 1.x | `tests/unit/mind/defect-mind-tasks-discovery-missing-quality-scanner.test.ts` |
| `defect-mind-lifecycle-evolution-missing-constant` | Task 1.x | `tests/unit/mind/defect-mind-lifecycle-evolution-missing-constant.test.ts` |
| `defect-1787994561107-294wxo` | Task 1.x | `tests/unit/mind/defect-1787994561107-294wxo.test.ts` |
| `defect-quota-lifecycle-test-ast-any-suppression` | Task 1.x | `tests/unit/mind/defect-quota-lifecycle-test-ast-any-suppression.test.ts` |
| `defect-mind-monolithic-plan-clustering-and-auditor-blindness` | Task 1.x | `tests/unit/mind/defect-mind-monolithic-plan-clustering-and-auditor-blindness.test.ts` |
| `defect-plan-granularity-monolithic-preplanning-factory` | Task 1.x | `tests/unit/mind/defect-plan-granularity-monolithic-preplanning-factory.test.ts` |
| `defect-plan-granularity-straggler-preplanning-factory` | Task 1.x | `tests/unit/mind/defect-plan-granularity-straggler-preplanning-factory.test.ts` |
| `defect-mind-detached-orchestrator-drop-and-capsule-isolation-gap` | Task 1.x | `tests/unit/mind/defect-mind-detached-orchestrator-drop-and-capsule-isolation-gap.test.ts` |
| `defect-redundant-multi-instance-skill-auditor-spawning` | Task 1.x | `tests/unit/mind/defect-redundant-multi-instance-skill-auditor-spawning.test.ts` |
| `defect-mind-stagnation-auditor-shock-failure` | Task 1.x | `tests/unit/mind/defect-mind-stagnation-auditor-shock-failure.test.ts` |
| `defect-mind-pulse-disk-state-desync` | Task 1.x | `tests/unit/mind/defect-mind-pulse-disk-state-desync.test.ts` |
| `defect-chronic-mind-stagnation-low-quality-auditor-loop` | Task 1.x | `tests/unit/mind/defect-chronic-mind-stagnation-low-quality-auditor-loop.test.ts` |
| `defect-doctor-stagnation-unactionable-gap` | Task 1.x | `tests/unit/mind/defect-doctor-stagnation-unactionable-gap.test.ts` |
