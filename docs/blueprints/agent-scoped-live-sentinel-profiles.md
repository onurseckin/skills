# Agent-Scoped Live Shell Sentinel: 20-Role Diagnostic Profiles

## Level 4 Modular Domain Decomposition & Role Invariant Matrices

> **Document Type:** Companion Architectural Specification  
> **Master Blueprint:** `docs/blueprints/agent-scoped-live-sentinel.md`  
> **Applicability:** All 20 Canonical Agent Roles across all 4 Canonical Hosts  
> **Tracking ID:** `bp-agent-scoped-live-sentinel-profiles`

---

## 1. Role Diagnostic Profile Architecture

The sentinel enforces strict role-specialized auditing: when instantiated, it loads the exact invariant profile assigned to the agent's canonical role. Probes examine only the actions, boundaries, and mandates within that role's domain.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    20 CANONICAL AGENT ROLES HIERARCHY                   │
├─────────┬───────────────────────────────────────────────────────────────┤
│ Tier 0  │ mind, skill-auditor, policy-discovery                        │
├─────────┼───────────────────────────────────────────────────────────────┤
│ Tier 1  │ orchestrator, mind-auditor                                    │
├─────────┼───────────────────────────────────────────────────────────────┤
│ Tier 2  │ coordinator, planner, plan-validator, repairer,               │
│         │ completeness-critic                                           │
├─────────┼───────────────────────────────────────────────────────────────┤
│ Tier 3  │ implementer, validator, mechanic-validator,                   │
│         │ ui-headless-validator, ui-mechanic-validator,                │
│         │ ui-optical-validator, ui-validator, sub-implementer,          │
│         │ sub-validator, sub-investigator                               │
└─────────┴───────────────────────────────────────────────────────────────┘
```

---

## 2. Tier 0: Strategic Supervisory Profiles

### 2.1 `mind` (Tier 0 — Autonomous Creative Product Manager)

- **Monitored Invariants:** Zero source code edits (`can_edit: false`); mathematical defect-first prioritization; dynamic concurrency scaling ($P = \lceil W / S \rceil \ge 2$); periodic pulse cadence (`mind:pulse`).
- **Trigger Conditions:** Direct source file modification; admitting features while high-severity defects remain; serial $P=1$ dispatches when independent tasks exist.
- **Remediation Action:** Strike 1 prompt to delegate implementation to Tier 1 Orchestrator; enforce `mind:pulse` and defect-first intake scoring.

### 2.2 `skill-auditor` (Tier 0 — Monorepo Architecture Auditor)

- **Monitored Invariants:** Monorepo file density ($\le 300$ physical LOC); directory fanout ($\le 10$ files); explicit named facade exports (0 wildcard `export *`); AST type purity (0 `any`, 0 `@ts-ignore`).
- **Trigger Conditions:** Missing scheduled audit sweeps; rubber-stamping non-conforming file additions; attempting code implementation.
- **Remediation Action:** Execute `bun harness.ts audit:modularity`; log non-compliant files to `.olt/defects.jsonl`.

### 2.3 `policy-discovery` (Tier 0 — Governance & Charter Baseline Investigator)

- **Monitored Invariants:** Read-only repository policy discovery; zero source file mutations; empirical synthesis of workspace configuration into `.olt/policy.json`.
- **Trigger Conditions:** Attempted modification of source code or test files; non-deterministic policy assertions lacking empirical ground truth.
- **Remediation Action:** Restrict execution to read-only tools (`view_file`, `grep_search`); reject code mutation tool calls.

---

## 3. Tier 1: Tactical Orchestration Profiles

### 3.1 `orchestrator` (Tier 1 — Multi-Round Objective Owner)

- **Monitored Invariants:** Multi-round convergence criteria; round capsule ownership; no direct implementer dispatch (must dispatch via Tier 2 Coordinator except on $N=1$ fast-path); zero source code edits.
- **Trigger Conditions:** Attempting direct code edits; bypassing coordinator to spawn implementers on multi-lane waves; premature objective closure.
- **Remediation Action:** Enforce 1-shot batch dispatch of Tier 2 Coordinators; block direct write tool calls.

### 3.2 `mind-auditor` (Tier 1 — Epistemic Watchdog & Candidate Intake Auditor)

- **Monitored Invariants:** Continuous tracking of mind candidate intake; mailbox starvation surveillance (< 300s unpolled); strict zero commands (0 code edits, 0 unit tests).
- **Trigger Conditions:** Unpolled supervisor inboxes $> 300$s; silent acquiescence to supervisor drift; running terminal shell commands.
- **Remediation Action:** Deliver scoped mailbox alert to Tier 0 Mind; disallow shell commands via mechanical RBAC lock.

---

## 4. Tier 2: Operational Coordination & Planning Profiles

### 4.1 `coordinator` (Tier 2 — Wave Synchronization & Dispatcher)

- **Monitored Invariants:** Zero source code edits; zero repo-wide test suites (`bun test`, `vitest`); mandatory 1-shot parallel dispatch ($P \ge 2$ when lanes $\ge 2$); 1-shot exact-anchor briefings (`task:brief`).
- **Trigger Conditions:** Attempting code modifications; launching whole-suite test runs; serializing independent lanes into single dispatches.
- **Remediation Action:** Interject `[FALSE_SERIALIZATION_BLUNDER] Wave contains N ready lanes. Invoke all lanes in parallel via Subagents: [...]`.

### 4.2 `planner` (Tier 2 — DAG Work Breakdown & Scope Allocator)

- **Monitored Invariants:** Strict write scope disjointness (no overlapping `write_scope`); strict DAG acyclicity; atomic work units bounded to 1–2 target files.
- **Trigger Conditions:** Generating overlapping write scopes across parallel tasks; introducing cyclic task dependencies; creating oversized multi-file tasks.
- **Remediation Action:** Trigger plan recalculation; require disjoint scope boundaries before admitting to `TASK_QUEUE.jsonl`.

### 4.3 `plan-validator` (Tier 2 — Adversarial DAG & Boundary Auditor)

- **Monitored Invariants:** Adversarial DAG topology inspection; validation of exact file coordinates (`StartLine`, `EndLine`); zero code edits.
- **Trigger Conditions:** Approving plans with overlapping write scopes or ambiguous file targets; rubber-stamping unevidenced DAG graphs.
- **Remediation Action:** Reject plan validation receipt; mandate explicit AST symbols and line boundaries.

### 4.4 `repairer` (Tier 2 — In-Lease Defect Remediation Specialist)

- **Monitored Invariants:** Targeted defect resolution within leased scope; 1-hop micro-cycle execution (`task:reject --in-lease`); file-scoped regression tests.
- **Trigger Conditions:** Modifying files outside the leased defect scope; submitting repairs without running targeted regression tests.
- **Remediation Action:** Interject exact regression test command (`bun test <target.test.ts>`); block `task:submit` until green.

### 4.5 `completeness-critic` (Tier 2 — Prompt Fidelity & Byte-Level Auditor)

- **Monitored Invariants:** Verifying byte-level prompt compliance against original user requests; verifying Canonical 8-Level Plan requirements; zero code edits.
- **Trigger Conditions:** Approving incomplete tasks where prompt deliverables are missing; attempting source code edits.
- **Remediation Action:** Emit structured completion deficit brief back to Coordinator; block task closure until all criteria are satisfied.

---

## 5. Tier 3: Implementation & Sub-Worker Profiles

### 5.1 `implementer` (Tier 3 — Primary Code Author)

- **Monitored Invariants:** Disjoint leased `write_scope` confinement; physical line limit ($\le 300$ LOC); zero `any`, zero `@ts-ignore`; mandatory file-scoped test execution before `task:submit`.
- **Trigger Conditions:** Writing outside leased files; introducing AST suppressions; exceeding 300 LOC; invoking `task:submit` without running unit tests.
- **Remediation Action:** Strike 1: Deliver exact remediation (`bun test <path.test.ts>`); Strike 2: Mechanically block submission until test receipt is registered.

### 5.2 `sub-implementer` (Tier 3 — Nested Worker)

- **Monitored Invariants:** Strict confinement to parent implementer's write sub-scope; zero whole-suite test runs; return changes directly to parent lease.
- **Trigger Conditions:** Modifying parent's outer files; running broad test suites; attempting independent `task:submit`.
- **Remediation Action:** Confine edits to assigned sub-file; reject out-of-scope tool calls.

### 5.3 `sub-investigator` (Tier 3 — Read-Only Diagnostic Tracer)

- **Monitored Invariants:** Strictly read-only tool usage (`view_file`, `grep_search`); zero filesystem edits; zero shell process execution.
- **Trigger Conditions:** Attempting `write_to_file`, `replace_file_content`, or `run_command`.
- **Remediation Action:** Mechanical interlock blocks write attempts; enforces diagnostic log synthesis.

---

## 6. Tier 3: Validation, Optical & Mechanical Profiles

### 6.1 `validator` (Tier 3 — Cognitive Code Quality & Socratic Critic)

- **Monitored Invariants:** Hardlock shell ban (`can_execute_shell: false`, 0 `run_command`); Socratic code critique; verification of Adversarial Gate Proofs.
- **Trigger Conditions:** Attempting any terminal command or test execution; submitting rubber-stamp reviews without Socratic code evaluation.
- **Remediation Action:** Instant pre-action mechanical block on shell tool calls; prompt for substantive architectural critique.

### 6.2 `mechanic-validator` (Tier 3 — AST Static Invariant & Type Auditor)

- **Monitored Invariants:** Fast typechecking (`tsc --noEmit`); AST static invariant checks (0 `any`, 0 `@ts-ignore`); zero manual code edits.
- **Trigger Conditions:** Attempting source code authoring; skipping AST audits before passing verification.
- **Remediation Action:** Execute `bun harness.ts task:check --task <id>`; block approvals lacking cryptographic test receipts.

### 6.3 `ui-headless-validator` (Tier 3 — Playwright & Headless DOM Auditor)

- **Monitored Invariants:** Headless Playwright test execution; generation of 4-viewport screenshot artifacts; DOM touch-target geometry ($\ge 44\text{pt}$).
- **Trigger Conditions:** Passing UI tasks without executing Playwright; missing screenshot outputs in `.olt/capsules/<run>/evidence/screenshots/`.
- **Remediation Action:** Interject `bun test:playwright --headed=false`; block verification until screenshot files are written to disk.

### 6.4 `ui-mechanic-validator` (Tier 3 — CSS Layout & Responsive DOM Auditor)

- **Monitored Invariants:** Responsive breakpoint layout checks; DOM element bounding box validation; zero console error emissions during rendering.
- **Trigger Conditions:** CSS overflow clipping; unhandled client exceptions; approving unrendered layouts.
- **Remediation Action:** Interject DOM layout audit command; emit bounding-box failure report.

### 6.5 `ui-optical-validator` (Tier 3 — Headful Visual Screenshot Reviewer)

- **Monitored Invariants:** Mandatory `view_file` calls on actual screenshot images ($\ge 1024$ bytes); inspection of all 4 viewports (mobile, tablet, desktop, wide); zero shell execution.
- **Trigger Conditions:** Submitting approval without calling `view_file` on screenshot images; skipping viewports; attempting shell commands.
- **Remediation Action:** Block approval: `[UI_OPTICAL_VIOLATION] You must inspect screenshot artifacts via view_file before rendering a verdict`.

### 6.6 `ui-validator` (Tier 3 — Holistic Visual & Interaction Experience Critic)

- **Monitored Invariants:** Comprehensive UX and optical harmony evaluation; design system fidelity; zero code modifications.
- **Trigger Conditions:** Attempting code modifications; rendering verdict without consuming both headless receipts and optical review findings.
- **Remediation Action:** Require comprehensive multi-modal critique; block direct write attempts.

### 6.7 `sub-validator` (Tier 3 — Subordinate Evidence Collector)

- **Monitored Invariants:** Read-only test artifact and assertion verification; writes proofs exclusively into `.olt/capsules/<run>/evidence/`.
- **Trigger Conditions:** Attempting repository source code modifications; issuing final task approvals without parent validator delegation.
- **Remediation Action:** Restrict writes to evidence directory; route findings to primary validator.

---

## 7. Diagnostic Dispatch Summary

```text
┌─────────────────────────┬──────────────────────┬────────────────────────┐
│ Role Group              │ Key Invariant        │ Primary Probe Command  │
├─────────────────────────┼──────────────────────┼────────────────────────┤
│ Mind & Auditors (T0/T1) │ Zero source code edit│ doctor:agent --role T0 │
│ Coordinators & Planners │ Concurrency P>=2     │ doctor:agent --role T2 │
│ Implementers (T3)       │ Scope & Test Passing │ doctor:agent --role T3 │
│ Validators (T3)         │ Shell Ban & Review   │ doctor:agent --role T3 │
└─────────────────────────┴──────────────────────┴────────────────────────┘
```
