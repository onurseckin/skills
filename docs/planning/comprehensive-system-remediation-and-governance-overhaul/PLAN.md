# Comprehensive System Remediation, Architectural Governance & Parallel Worktree Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an unyielding, self-checking, multi-worktree autonomous agent hierarchy that eliminates supervisory role boundary breaches, eradicates Potemkin defect churn, unblinds Sentinels and Auditors through real-time transcript discovery, decouples supervisory ambient control from worker concurrency, dynamically clusters backlog tasks into parallel Git worktrees, and systematically re-validates all 20 identified systemic issues with Two-Key Socratic Cognitive Validation.

**Architecture:**

1. **Dynamic Task Graph Reasoning & Worktree Parallelism**: Mind analyzes `.olt/backlog.jsonl` dynamically via LLM reasoning, clusters tasks by disjoint write scopes, and spins up parallel Git worktrees (`.olt/worktrees/track-*`).
2. **True Live Registered Sentinel Strategy Monitors**: Background monitors attached per agent tail unbuffered `transcript.jsonl` in real time, monitor filesystem mutations, and trigger instant strikes, revocations, and halts.
3. **Strict 4-Tier Hierarchy & RBAC Confinement**: Mind (Tier 0) -> Orchestrator (Tier 1) -> Coordinator (Tier 2) -> Workers (Tier 3). Supervisors have `can_execute_shell: false`, 0 direct code authoring, and 0 unit test execution.
4. **Skill-Internal Governance & Mailbox Integrity**: Never strip host `enable_write_tools`. Confinement is 100% internal to the skill (`verifyCommandAuthorization` in `harness.ts shell`, Doctor, Live Sentinels).
5. **Decoupled Two-Tier Concurrency Accounting**: Supervisory control mesh (Tiers 0–2) is exempt from concurrency limits. Only Tier 3 Workers (Implementers, Validators, Publishers) count toward execution concurrency ($P = \lceil W / S \rceil$).
6. **Two-Key Socratic Cognitive Validation**: Every completed task requires an independent Implementer test receipt + an independent Cognitive Validator review receipt (0 commands, pure Socratic review) before worktree landing.

**Tech Stack:** TypeScript, Bun, Git Worktrees, Posix Mailbox IPC, OLT Harness CLI, AST Static Linters.

**Spec:** `docs/planning/comprehensive-system-remediation-and-governance-overhaul/PLAN.md`

---

## Global Constraints

- Strict adherence to The Three Hard Zeros on supervisory threads: 0 direct code edits, 0 unit test runs, 0 PR/critic reviews.
- All code files must remain strictly <= 300 physical lines.
- Directory fanout must remain strictly <= 10 files.
- Named exports only; 0 `export *` wildcard exports; 0 facade bypasses.
- All tests must strictly reside in the top-level `tests/` directory; zero test files under `skills/olt/` or `olt/`.
- Zero host tool stripping: `enable_write_tools` must remain enabled for mailbox IPC.
- Never use `LEFTHOOK=0`, `LEFTHOOK=false`, or `--no-verify`.

---

## The 20 Major Problems & Remediation Epics

### Epic 1: Telemetry Proto3 Zero-Quota Fraction Blindness

- **Problem**: `scripts/src/telemetry/collectors/antigravity.ts` read absent `remainingFraction` as null/unknown. In Proto3 JSON, default 0.0 is omitted. The circuit breaker went blind at the exact moment remaining quota hit zero.
- **Remedy**: Treat absent `remainingFraction` as 0.0, triggering immediate graceful throttle and freeze before hard quota failure.
- **Target Files**: `olt/scripts/src/telemetry/collectors/antigravity.ts`
- **Verification**: `tests/telemetry/antigravity-proto3-zero.test.ts` (verify 0.0 remaining fraction triggers freeze).

### Epic 2: Optional Unit-Testing in `policy.json` & Multi-Repo Governance

- **Problem**: Repositories without unit tests failed validation because `policy.json` enforced unit testing universally. Mind was also running test coverage directly.
- **Remedy**: Make `test_execution` and `unit_test` keys in `policy.json` optional. Guardrails, doctor checks, and validators must skip test requirements when unconfigured or empty. Mind must delegate all test runs to Tier 3 workers.
- **Target Files**: `olt/scripts/src/policy/`, `olt/scripts/src/reporting/doctor/`, `olt/scripts/src/mind/lifecycle/`
- **Verification**: `tests/policy/optional-testing.test.ts` (10 adversarial probes).

### Epic 3: Orchestrator Role Boundary Breach (Supervisors Running Code & Tests)

- **Problem**: Tier 1 Orchestrators authored source files with `replace_file_content` and ran unit tests with `run_command` directly on supervisory threads.
- **Remedy**: Set `can_execute_shell: false` in `orchestratorProfile`. Expand doctor forbidden supervisory tools to catch `run_command`, `replace_file_content`, and `write_to_file`. Mandate delegation to Tier 2 Coordinator via `invoke_subagent`.
- **Target Files**: `olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts`, `olt/scripts/src/reporting/doctor/role-boundary-engine.ts`
- **Verification**: `tests/sentinel/orchestrator-role-boundary.test.ts`.

### Epic 4: Skill Auditor Host Transcript Blindness & Oversight Delay

- **Problem**: Skill Auditor scanned only capsule `events.jsonl` and git diffs, remaining completely blind to the real-time host conversation transcripts (`transcript.jsonl`).
- **Remedy**: Wire unbuffered host transcript discovery directly into `skill-auditor.ts` and `registry.ts`, tailing subagent transcripts in real time and issuing immediate strikes.
- **Target Files**: `olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts`, `olt/scripts/src/sentinel/monitor/registry.ts`
- **Verification**: `tests/sentinel/skill-auditor-transcript-discovery.test.ts`.

### Epic 5: Potemkin "Defect-CLI" Synthetic Files & Tautological Tests

- **Problem**: Automated defect promotion flows created 103 fake `defect-cli-*.ts` stubs in `olt/scripts/src/` and 326 fake tests with `expect(true).toBe(true)` to cosmetically close defects without fixing code.
- **Remedy**: Purge all 654 fake files, ban production stub generation in `defect-audit/command.ts`, and eliminate tautological test generation in `regression-gen.ts`.
- **Target Files**: `olt/scripts/src/cli/commands/defect-audit/command.ts`, `olt/scripts/src/logging/defects/regression-gen.ts`
- **Verification**: `tests/cli/commands/governance/defects/defect-audit-integrity.test.ts`.

### Epic 6: Root Directory Hygiene Bleed (`olt/` vs `.olt/`)

- **Problem**: Hardcoded `join(repoRoot, "olt", ...)` across path resolvers caused consumer repositories to create or expect an unhidden `olt/` directory instead of hidden `.olt/`.
- **Remedy**: Refactor all path resolution to `resolveOltDir(repoRoot)` with `.olt/` priority across all 9 resolver files.
- **Target Files**: `olt/scripts/src/core/shared/paths.ts`, `olt/scripts/src/authority/manifest/loader.ts`, `olt/scripts/src/references/indexer.ts`, `olt/scripts/src/mind/lifecycle/mind-init-flow.ts`
- **Verification**: `tests/core/root-hygiene.test.ts`.

### Epic 7: True Live Registered Sentinel Strategy Monitors

- **Problem**: Passive Sentinel checks wrapped only CLI commands. Native host tool calls (`run_command`, `replace_file_content`) completely bypassed it.
- **Remedy**: Implement `SentinelMonitorRegistry` and `LiveStrategyMonitor` to spawn an active background monitor per agent, tailing `transcript.jsonl` unbuffered, watching filesystem mutations, and auto-cleaning on agent termination.
- **Target Files**: `olt/scripts/src/sentinel/monitor/registry.ts`, `olt/scripts/src/sentinel/monitor/strategy-monitor.ts`
- **Verification**: `tests/sentinel/live-strategy-monitor.test.ts`.

### Epic 8: Dedicated Test Location Invariant (`tests/` Only)

- **Problem**: Test files were being placed or generated under `skills/olt/` or `olt/scripts/src/`.
- **Remedy**: Strictly mandate that all unit, integration, and regression test files (`*.test.ts`, `*.spec.ts`) reside under top-level `tests/`. Enforce 0 test files under `skills/olt/` or `olt/`.
- **Target Files**: `olt/scripts/src/logging/defects/regression-gen.ts`, `lefthook.yml`, `scripts/modularity/`
- **Verification**: `tests/core/test-location-invariant.test.ts`.

### Epic 9: Never Stripping Host `enable_write_tools` / Skill-Internal RBAC Confinement

- **Problem**: Attempting to confine agents by stripping host `enable_write_tools` cripples mailbox IPC (`.olt/mailboxes/`) and breaks agent autonomy.
- **Remedy**: Keep `enable_write_tools` enabled. Enforce tool gating strictly within the skill: RBAC engine (`verifyCommandAuthorization` in `harness.ts shell`), Doctor diagnostics, and Live Sentinel monitors.
- **Target Files**: `olt/scripts/src/cli/commands/shell.ts`, `olt/scripts/src/sentinel/profiles/`
- **Verification**: `tests/sentinel/rbac-shell-confinement.test.ts`.

### Epic 10: Main-Thread Agent Scope Discipline (Zero Implementation on Main Thread)

- **Problem**: Main interactive thread repeatedly drifted into running git operations, running modularity checks, running build commands, or attempting code edits.
- **Remedy**: Main thread strictly operates as a passive human communication relay: 0 code authoring, 0 test runs, 0 git operations, 0 task implementations. All execution delegated 100% to the autonomous hierarchy.
- **Target Files**: `AGENTS.md`, prompt directives, communication workflows.
- **Verification**: Continuous audit receipt verification.

### Epic 11: Single-Track Pulse Blindfold (`activeRuns === 0` in `mind-pulse-formatter.ts`)

- **Problem**: `formatPulseDirective` returned `""` whenever `activeRuns > 0`, blinding Mind from looking at the backlog or dispatching new ready tracks as soon as 1 worktree was active.
- **Remedy**: Remove `activeRuns === 0` gate. Compute non-colliding backlog tasks even when active worktrees exist, generating `PARALLEL_WORKTREE_DISPATCH_REQUIRED` directives.
- **Target Files**: `olt/scripts/src/cli/commands/mind-pulse-formatter.ts`, `olt/scripts/src/cli/commands/mind-pulse-telemetry.ts`
- **Verification**: `tests/mind/pulse-parallel-directives.test.ts`.

### Epic 12: Mind "Log-Tailing" Spectator Trap vs Strategic Macro Planning

- **Problem**: Mind burned its reasoning turns repeatedly tailing child transcripts (`tail -n 25`) every 15 seconds instead of dynamically planning future waves.
- **Remedy**: Establish Sentinel rule `MIND_LOG_TAILING_FORBIDDEN`. Mind must spend turns on backlog grooming, dynamic graph clustering, worktree provisioning, and future requirements authoring.
- **Target Files**: `olt/agents/mind.yaml`, `olt/scripts/src/sentinel/profiles/tier0/mind.ts`
- **Verification**: `tests/sentinel/mind-spectator-prohibition.test.ts`.

### Epic 13: Conflation of Supervisory Ambient Mesh with Worker Concurrency

- **Problem**: Telemetry and saturation metrics treated Tier 0–2 supervisory agents (Mind, Mind Auditor, Skill Auditor, Orchestrator, Coordinator) as "active workers", falsely reporting fleet saturation when 0 workers were running.
- **Remedy**: Decouple two-tier accounting: Tiers 0–2 are ambient control plane, exempt from saturation caps. Only Tier 3 Workers (Implementers, Validators, Publishers) count toward execution concurrency ($P = \lceil W / S \rceil$).
- **Target Files**: `olt/scripts/src/mind/concurrency-cap.ts`, `olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts`
- **Verification**: `tests/mind/two-tier-concurrency-accounting.test.ts`.

### Epic 14: Dynamic LLM-Driven Task Graph Clustering for Worktrees

- **Problem**: Mind failed to use LLM intelligence to cluster independent backlog items into disjoint topological tracks, running everything sequentially.
- **Remedy**: Mind dynamically evaluates file overlap and dataflow dependencies across the entire backlog, clusters tasks into non-colliding feature tracks, and spins up 3–5 parallel Git worktrees (`.olt/worktrees/track-*`).
- **Target Files**: `olt/scripts/src/mind/planning/`, `olt/scripts/src/workflow/worktree/`
- **Verification**: `tests/mind/dynamic-graph-clustering.test.ts`.

### Epic 15: Mind Auditor Anti-Stagnation Passivity

- **Problem**: Mind Auditor acted as a passive recorder of status rather than actively issuing Socratic provocations when disjoint backlog items sat idle.
- **Remedy**: Upgrade Mind Auditor to actively compute worktree occupancy. If disjoint backlog clusters exist while worktree concurrency $\le 1$, Mind Auditor delivers an authoritative Socratic provocation forcing worktree expansion.
- **Target Files**: `olt/agents/mind-auditor.yaml`, `olt/scripts/src/mind/auditing/anti-stagnation-engine.ts`
- **Verification**: `tests/mind/auditor-parallelism-provocation.test.ts`.

### Epic 16: Two-Key Socratic Cognitive Validation Requirement

- **Problem**: Previous tracks were marked completed without independent Tier 3 Cognitive Validators executing pure Socratic code reviews (0 commands) and without independent cryptographic receipts.
- **Remedy**: Mandate 2-Key Validator Pairing for all tasks: an independent Implementer test receipt + an independent Cognitive Validator audit receipt with SHA-256 hashes before worktree landing.
- **Target Files**: `olt/scripts/src/workflow/completion/`, `olt/scripts/src/reporting/socratic-validator.ts`
- **Verification**: `tests/workflow/two-key-validator-pairing.test.ts`.

### Epic 17: Soft Quota Drain, Handoff Preservation & Session Token Authentication (`quota:freeze`)

- **Problem**: Quota check failed caller authentication in `quota:freeze`, and low quota caused hard abrupt halts instead of graceful task draining and handoff authoring.
- **Remedy**: At $\le 10-15\%$ quota, throttle concurrency ($P \to 1$), halt admitting new tasks, author structured handoff documentation (`handoff.md`), stage all changes to reflog, and fix session token validation.
- **Target Files**: `olt/scripts/src/mind/lifecycle/suspended-animation.ts`, `olt/scripts/src/cli/commands/mind-round.ts`
- **Verification**: `tests/mind/quota-graceful-drain.test.ts`.

### Epic 18: Modularity Ratchet Strict Line Budget & Directory Fanout Enforcement

- **Problem**: Several core files exceeded the 300 physical-line budget and had baseline exceptions.
- **Remedy**: Decompose all files to strictly $\le 300$ physical lines, enforce directory fanout $\le 10$ files, named exports only in `index.ts`, and 0 facade bypasses.
- **Target Files**: `scripts/modularity/`, `package.json`, touched codebase files.
- **Verification**: `bun run modularity:check`.

### Epic 19: Automated Blunder Logging, Deduplication & Regression Immunity

- **Problem**: Role boundary breaches and reasoning blunders recurred because resolution proofs were not automatically codified into regression tests.
- **Remedy**: Blunders logged to `.olt/defects.jsonl` must be deduplicated, audited, and resolved only with empirical proofs (`commit_sha`, `test_assertion`), with automated regression tests generated under `tests/regressions/`.
- **Target Files**: `olt/scripts/src/logging/defects/dedup.ts`, `olt/scripts/src/logging/defects/regression-gen.ts`
- **Verification**: `tests/logging/defect-audit-dedup.test.ts`.

### Epic 20: Non-Interrupting Asynchronous Backlog Intake (`queue:add`) over Direct Host Messaging

- **Problem**: Direct host `send_message` interrupts into Mind's context trigger prompt disruptions and conversational chatter.
- **Remedy**: All user feedback, architectural mandates, and defect escalations must flow through the canonical flock-locked queue (`.olt/backlog.jsonl`) via `bun harness.ts queue:add`. Mind ingests them naturally on pulse ticks without conversational disruption.
- **Target Files**: `olt/scripts/src/cli/commands/todo-ops.ts`, `olt/scripts/src/mind/feedback/queue/`
- **Verification**: `tests/cli/commands/queue/queue-add-intake.test.ts`.

---

## Execution Handoff

Plan complete and committed to `docs/planning/comprehensive-system-remediation-and-governance-overhaul/PLAN.md`.
All 20 epics will be registered in `.olt/backlog.jsonl` for autonomous Mind graph decomposition and parallel Git worktree dispatch.
