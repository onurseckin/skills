# Agent-Scoped Live Shell Sentinel & Targeted Harness Doctor Interlock Plan

> **Tracking ID:** `fb-agent-scoped-live-sentinel-doctor-interlock`  
> **Status:** `PROPOSED STRATEGIC BLUEPRINT`  
> **Target Subsystems:** `olt/scripts/src/sentinel/`, `olt/scripts/src/reporting/doctor/`, `olt/agents/`, `docs/planning/`  
> **Author:** Antigravity Pair Programming (Relayed to Tier 0 Mind Supervisor)  
> **Created:** 2026-09-06

> **Path-integrity audit (2026-09-07):** this doc set is still `PROPOSED STRATEGIC BLUEPRINT` —
> unrealized paths in this file and in `host-parity.md`/`interlocks.md` (mailbox examples,
> `src/engine/dag.ts`/`tests/foo.test.ts` illustrative examples, the Host Parity test matrix,
> `.olt/sentinel-log.jsonl`) are intentional future/illustrative references, not stale ones.

---

## 1. Executive Summary & Problem Statement

Currently, architectural and contract compliance auditing within the `@onurseckinsenoglu/skills` ecosystem operates out-of-band:

- Audits are driven primarily by the singleton Tier 0 `skill-auditor` and `mind-auditor` on coarse periodic cycles (typically 300s).
- Subagents (`implementer`, `validator`, `coordinator`, `orchestrator`) can drift, forget mandatory intermediate commands (`task:check`, file-scoped test runs, screenshot reviews), or attempt out-of-boundary tool calls during their turns without immediate in-turn course correction.
- When global doctor audits or meta-audits detect a defect, the findings are often deposited into global defect ledgers (`.olt/defects.jsonl`) or broadcast to general mailboxes, creating cross-tier noise (e.g., an implementer's test omission being seen by an orchestrator).

### The Proposed Architecture

The **Agent-Scoped Live Shell Sentinel (`sentinel:watch` / `agent-sentinel`)** introduces an in-process, host-agnostic, live supervisory watchdog paired 1:1 with every deployed subagent. It continuously evaluates live turn actions against that agent's exact role contract, triggering immediate, role-scoped interjections via mailbox IPC without global broadcasting.

---

## 2. Core Architectural Axioms

1. **Role-Tailored Scope (Strict Role Specialization):**
   - The sentinel is instantiated with explicit identity parameters: `--agent-id <id> --role <role> --run <run> --task-id <task>`.
   - It only evaluates invariants that the specific agent is responsible for. It never runs whole-system audits or cross-tier checks.

2. **Scoped Interjection (Zero Broadcast Noise):**
   - An issue triggered by a Coordinator is delivered _only_ to that Coordinator's inbox (`.olt/mailboxes/<coordinator-id>/`).
   - An issue triggered by an Implementer is delivered _only_ to that Implementer's inbox (`.olt/mailboxes/<implementer-id>/`).
   - High-tier supervisors (Orchestrator, Mind) are never spammed with low-level worker omissions unless a worker exceeds the 3-strike escalation threshold.

3. **Accurate, Diagnostic-Backed Evidence (The Doctor Interlock):**
   - The sentinel does not guess, hallucinate, or rely on heuristics.
   - It invokes deterministic, fine-grained harness diagnostics (`bun harness.ts doctor:agent --role <role> --agent <id>`).

4. **Host-Agnostic Subservience (Universal OLT Skill Power):**
   - The sentinel relies exclusively on the core capabilities of the `@onurseckin/skills` harness:
     - Direct argv non-interactive CLI commands.
     - POSIX flock-protected mailboxes with HMAC authentication (`msg:send`).
     - Session authority tokens and process ancestry tracking.
   - It runs identically across all 4 canonical hosts (`antigravity`, `claude_code`, `codex`, `cursor`).

5. **Self-Healing Actionable Receipts:**
   - Every pushed interjection contains:
     - Error Code (e.g., `MISSING_FILE_SCOPED_TEST_RUN`, `OUT_OF_SCOPE_MODIFICATION`).
     - Exact remedial CLI command to run (e.g., `bun test tests/foo.test.ts`).
     - Plain-English remediation instructions.

---

## 3. Role-Specific Diagnostic Matrices

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         ROLE-TARGETED SENTINEL DIAGNOSTIC PROFILES                                │
├──────────────────────────┬───────────────────────────────────────┬───────────────────────────────┤
│ Role Target              │ Monitored Invariants & Checks         │ Immediate Interjection Trigger│
├──────────────────────────┼───────────────────────────────────────┼───────────────────────────────┤
│ implementer              │ • Disjoint write scope confinement    │ File modified outside scope,  │
│                          │ • Strict zero-any, zero-suppressions  │ @ts-ignore added,             │
│                          │ • File-scoped test execution          │ task:submit without test run, │
│                          │ • Physical line budget (<= 400 LOC)   │ File exceeds 400 LOC          │
├──────────────────────────┼───────────────────────────────────────┼───────────────────────────────┤
│ validator (cognitive)    │ • Strict zero-command lock (0 shell)  │ Attempted run:exec or test,   │
│                          │ • Headful screenshot review (for UI)  │ Approved without view_file,   │
│                          │ • Socratic critique / task:probe      │ Rubber-stamp task:review      │
├──────────────────────────┼───────────────────────────────────────┼───────────────────────────────┤
│ coordinator              │ • Zero code edits (0 source writes)   │ Attempted file mutation,      │
│                          │ • Dynamic wave concurrency (P >= 2)   │ Serial single-worker dispatch,│
│                          │ • Zero broad test suites              │ Ran bun test / vitest,        │
│                          │ • Mailbox starvation checks           │ Unread messages > 300s        │
├──────────────────────────┼───────────────────────────────────────┼───────────────────────────────┤
│ orchestrator             │ • Multi-round convergence criteria    │ Premature round closure,      │
│                          │ • No direct implementer dispatch      │ Bypassed coordinator tier,    │
│                          │ • Zero source code edits              │ Attempted file write          │
├──────────────────────────┼───────────────────────────────────────┼───────────────────────────────┤
│ publisher (Tier 3)       │ • Pre-push test suite pass (100%)     │ git push without test green,  │
│                          │ • Clean working tree before landing   │ Uncommitted working tree,     │
│                          │ • Modularity ratchet pass             │ Modularity check failed       │
└──────────────────────────┴───────────────────────────────────────┴───────────────────────────────┘
```

---

## 4. Architectural Execution Flow

```text
               Subagent Execution Step (Turn N)
                              │
                              ▼
               Harness Post-Action Hook / Wrapper
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
       Command Succeeded              Rule Violation Detected
              │                               │
              ▼                               ▼
     Record Event Log             Sentinel Evaluates Role Matrix
                                  (`bun harness.ts doctor:agent`)
                                              │
                                              ▼
                                   Format Role-Scoped Brief
                                              │
                                              ▼
                                 Dispatch Mailbox Interjection
                             (`bun harness.ts msg:send --to <agent>`)
                                              │
                                              ▼
                             Agent Receives High-Priority Message
                             & Executes Prescribed Action In-Turn
```

---

## 5. Technical Implementation Roadmap

### Phase 1: Harness CLI Command (`doctor:agent`)

- Create `olt/scripts/src/cli/commands/doctor-agent.ts`.
- Implements fine-grained, role-tailored diagnostic checks:
  - `--role <role>`: Selects the active diagnostic ruleset.
  - `--agent <agent-id>`: Binds checks to the agent's leased tasks and events.
  - `--run <capsule>`: Resolves local run context.
- Output: Returns clean JSON/Markdown findings specific only to that agent.

### Phase 2: Live Shell Sentinel Runner (`sentinel:watch`)

- Create `olt/scripts/src/sentinel/runner.ts`.
- Runs as a non-blocking background task or post-command hook.
- Detects state deltas, triggers `doctor:agent`, and immediately dispatches `msg:send` to the agent's mailbox upon violation.

### Phase 3: Manifest & Policy Integration

- Update `olt/policy.json` and agent manifests with sentinel registration:
  - Add `sentinel` capability to fleet archetypes.
  - Wire sentinel startup into `agent:register` lifecycle.

### Phase 4: Verification & Automated Tests

- Comprehensive unit tests in `tests/sentinel/`:
  - Test Implementer write-scope violation trigger.
  - Test Cognitive Validator shell-lock trigger.
  - Test Coordinator false-serialization trigger.
  - Test scoped message delivery (verifying zero cross-tier leak).
