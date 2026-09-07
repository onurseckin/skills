# Agent-Scoped Live Shell Sentinel & Targeted Doctor Interlock

## Master Architectural Blueprint (Canonical 8-Level Plan Architecture)

> **Document Type:** Master Conceptual Blueprint  
> **Status:** RATIFIED STRATEGIC SPECIFICATION  
> **Target Subsystems:** `olt/scripts/src/sentinel/`, `olt/scripts/src/reporting/doctor/`, `olt/agents/`  
> **Applicability:** All 20 Canonical Agent Roles across all 4 Canonical Hosts (`antigravity`, `claude_code`, `codex`, `cursor`)  
> **Tracking ID:** `bp-agent-scoped-live-sentinel-doctor-interlock`

---

## 1. Executive Summary & Architectural Thesis

Autonomous multi-agent swarms frequently degrade under asynchronous drift, delayed feedback loops, and cross-tier cognitive pollution. In traditional supervisory systems, compliance verification is global, periodic, and out-of-band: background monitors scan shared ledgers every several minutes, logging violations to central defect tables or broadcasting warnings to shared channels. This induces severe operational pathologies:

1. **Late Discovery:** An implementer that skips file-scoped tests or violates line budgets only discovers the defect rounds later during formal validation.
2. **Cognitive Noise:** Low-level syntax or scope violations are broadcast to high-level coordinators and orchestrators, burning expensive reasoning tokens on issues outside their domain.
3. **Supervisory Drift:** Higher-tier agents take on manual verification tasks, violating the hard separation between strategic orchestration and worker execution.

The **Agent-Scoped Live Shell Sentinel** resolves these pathologies by embedding a private, deterministic, in-process runtime monitor alongside every deployed agent instance. Operating through native OLT harness hooks and POSIX file-locked mailboxes, the sentinel evaluates turn actions exclusively against that agent's assigned role contract. Violations trigger immediate, in-turn course corrections delivered strictly to the offending agent's mailbox, preserving complete cross-tier silence unless a strict 3-strike escalation threshold is breached.

---

## 2. Level 1: Core Problem & Value Grounding

### 2.1 Vision Unpacking

The central thesis is the transition from **post-hoc forensic auditing** to **in-situ live course correction**. Instead of relying on periodic sweeps by singleton auditors, every deployed agent process operates within a self-governing cybernetic loop:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        THE AGENT CYBERNETIC LOOP                       │
│                                                                        │
│   Agent Proposes Action ──► Sentinel Pre-Hook ──► Mechanical Allow/Deny │
│             ▲                                               │          │
│             │                                               ▼          │
│      Course Correction ◄── Sentinel Doctor ◄── Action Execution Result │
│     (Scoped Mailbox)         Evaluation                                │
└────────────────────────────────────────────────────────────────────────┘
```

The sentinel does not replace the agent's cognition; it acts as a deterministic boundary governor, ensuring that invalid operations are caught before they contaminate the repository state.

### 2.2 User Mental Models: The Dedicated Air-Traffic Controller

To reason about the system, developers and supervisors must adopt the mental model of a **Personal Air-Traffic Controller (ATC)**:

- The ATC is assigned to exactly one aircraft (the agent) for the duration of its flight (the task lease).
- The ATC speaks exclusively on a private frequency (the agent-scoped mailbox).
- If the pilot drifts off course (e.g., modifying files outside the write scope or skipping tests), the ATC provides an immediate heading correction directly to the cockpit.
- The airport control tower (Tier 1 Orchestrator) is never notified of minor heading corrections, maintaining radio silence across the broader airspace.
- Only if the pilot ignores repeated warnings (Strike 3) does the ATC declare an emergency and escalate to tower command.

### 2.3 Value Proposition & Cognitive Load Elimination

- **Zero Cross-Tier Noise:** Eliminates 100% of worker error reports from supervisory context windows.
- **Immediate Turn Recovery:** Reduces the mean-time-to-recovery (MTTR) for common agent omissions from multi-minute round cycles to single-digit seconds within the active turn.
- **Token Conservation:** Prevents multi-agent context bloat caused by global defect broadcast and repetitive clarification chatter.

### 2.4 Jobs-To-Be-Done (JTBD) Alignment

- **For Implementers:** _"Keep me within my leased write scope and remind me of mandatory test commands before I submit, so my work passes validation on the first attempt."_
- **For Cognitive Validators:** _"Block me mechanically if I attempt terminal commands or source edits, preserving my dedicated focus on Socratic code review."_
- **For Coordinators:** _"Alert me immediately if I attempt single-worker serialization or try to write code directly, ensuring I maintain high-concurrency 1-shot batch dispatches."_
- **For Orchestrators & Mind:** _"Shield my context from low-level operational failures while providing cryptographic assurance that all active lanes conform to monorepo invariants."_

---

## 3. Level 2: Strategic Constraints & Non-Goals

### 3.1 Strategic Scope Boundaries

The Sentinel is an operational enforcement harness built strictly within the runtime boundary of the `@onurseckin/skills` monorepo.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                     SYSTEM BOUNDARY SPECIFICATION                      │
├───────────────────────────────────┬────────────────────────────────────┤
│ IN SCOPE (THE SENTINEL DOMAIN)    │ OUT OF SCOPE (NON-GOALS)           │
├───────────────────────────────────┼────────────────────────────────────┤
│ • In-process action interception  │ • Code authoring / auto-generation │
│ • 1:1 Agent-scoped doctor probes  │ • Global repository static audits  │
│ • Point-to-point mailbox IPC      │ • LLM-based speculative reasoning │
│ • 3-Strike escalation state logic │ • External daemon or socket server │
│ • Process ancestry verification   │ • Cross-host proprietary shims     │
└───────────────────────────────────┴────────────────────────────────────┘
```

### 3.2 The Zero-Broadcast Invariant

Under no circumstances may a Sentinel interjection for Strikes 1 or 2 be broadcast to global defect ledgers (`.olt/defects.jsonl`), shared event buses, or supervisory mailboxes. All diagnostic receipts are point-to-point (P2P), addressed strictly to `.olt/mailboxes/<target-agent-id>/inbox.jsonl`. Violations of this invariant constitute an architectural defect (`UNAUTHORIZED_BROADCAST_POLLUTION`).

### 3.3 Universal Host Parity Invariant

The architecture operates with 100% functional parity across all 4 canonical hosts:

- **`antigravity`** (Primary supervisory & execution harness)
- **`claude_code`** (CLI command wrapper & turn lifecycle)
- **`codex`** (Autonomous execution & background sandbox)
- **`cursor`** (IDE terminal task & background watch loop)

Parity is enforced by relying exclusively on POSIX file locking (`flock`), direct process argv invocation, and standard filesystem structures. No host-proprietary APIs, background daemons, or OS-specific drivers may be introduced.

### 3.4 Explicit Non-Goals

1. **No Autonomous Code Patching by Sentinel:** The sentinel identifies violations and provides the exact CLI command or patch requirement, but it **never** alters repository source code directly.
2. **No Speculative or Probabilistic Auditing:** Probes must be 100% deterministic, backed by the harness CLI engine (`doctor:agent`). No generative LLM calls are permitted within the sentinel core.
3. **No Replacement of Human Oversight:** The sentinel enforces defined repository contracts; it does not set product policy or alter architectural charters.

---

## 4. Master Architectural Topology

The sentinel architecture integrates three core subsystems: the execution wrapper, the targeted doctor probe engine, and the scoped mailbox IPC router.

```text
                       Agent Dispatch / Turn Start
                                    │
                                    ▼
                ┌───────────────────────────────────────┐
                │        sentinel:pre-action hook       │
                │  - Leased write scope check           │
                │  - verifyCommandAuthorization         │
                └───────────────────┬───────────────────┘
                                    │ Allowed
                                    ▼
                ┌───────────────────────────────────────┐
                │          Action Tool Execution        │
                │      (Shell command or File Edit)     │
                └───────────────────┬───────────────────┘
                                    │
                                    ▼
                ┌───────────────────────────────────────┐
                │       sentinel:post-action hook       │
                │  - AST purity (0 any, 0 suppressions) │
                │  - Line budget check (<= 400 LOC)     │
                │  - Directory fanout check (<= 10)     │
                └───────────────────┬───────────────────┘
                                    │
                                    ▼
                ┌───────────────────────────────────────┐
                │        sentinel:turn-end hook         │
                │  bun harness.ts doctor:agent          │
                │  --role <role> --agent <id>           │
                └───────────────────┬───────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼ Clean                         ▼ Violation
             Turn Concluded                Evaluate Strike Ladder
                                                    │
                 ┌──────────────────────────────────┴──────────────────┐
                 ▼ Strike 1: ADVISE                                    ▼ Strike 2: BLOCK
         Deliver exact fix to agent                            Engage mechanical tool
         mailbox; non-blocking turn.                           lock; reject non-remedial calls.
                 │                                                     │
                 └──────────────────────────┬──────────────────────────┘
                                            │ Unresolved
                                            ▼ Strike 3: ESCALATE
                                    Freeze task lease (`task:freeze`).
                                    Route encrypted escalation packet
                                    to parent supervisor mailbox ONLY.
```

---

## 5. Level 8: Master Blueprint Delivery & Radical Simplification

### 5.1 Radical Simplification Principles

To ensure production durability and prevent architectural bloat, the sentinel adheres to three simplification mandates:

1. **Zero External Services:** Operates without redis, rabbitmq, sqlite, or persistent daemons. State is entirely managed via file descriptors, atomic file locks, and JSONL streams.
2. **Single Deterministic Entry Point:** All diagnostic checks converge on a single CLI verb: `bun harness.ts doctor:agent`.
3. **Strict Line and File Budgets:** Every component file adheres strictly to the $\le 400$ physical line budget, with explicit module facades and zero circular dependencies.

### 5.2 Companion Architectural Specifications

To preserve exhaustive technical depth while respecting file budget invariants, this master blueprint delegates detailed operational matrices to three canonical companion specifications:

1. **[Conceptual Failure Vectors](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/agent-scoped-live-sentinel-failure-vectors.md):**  
   Exhaustive analysis of the 8 failure vectors (empty states, timeout stagnation, actor mutations, boundaries, lifecycles, invariants, telemetry, and adversarial evasion).
2. **[20-Role Diagnostic Profiles](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/agent-scoped-live-sentinel-profiles.md):**  
   Exhaustive matrix of monitored invariants, trigger criteria, and remediation contracts across all 20 canonical agent roles.
3. **[Flow Dynamics, Value Gates & Resilience Hardening](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/agent-scoped-live-sentinel-flow-and-gates.md):**  
   Detailed hook mechanics, POSIX flock mailbox protocols, cryptographic `[ROUTING_JOURNEY]` headers, HMAC security tokens, and PPID ancestry tracking.

---

## 6. Execution Roadmap & Verification Gates

```text
┌────────────────────────────────────────────────────────────────────────┐
│                      IMPLEMENTATION ROLLOUT GATES                      │
├──────┬────────────────────────┬────────────────────────────────────────┤
│ Gate │ Subsystem              │ Acceptance Criteria                    │
├──────┼────────────────────────┼────────────────────────────────────────┤
│ G-01 │ CLI Doctor Harness     │ `doctor:agent` CLI probe executes in   │
│      │ (`doctor-agent.ts`)    │ < 100ms with deterministic JSON/MD.    │
├──────┼────────────────────────┼────────────────────────────────────────┤
│ G-02 │ Scoped Mailbox Router  │ Atomic flock IPC verifies zero leak    │
│      │ (`mailbox-router.ts`)  │ to parent/global on Strike 1 and 2.    │
├──────┼────────────────────────┼────────────────────────────────────────┤
│ G-03 │ Hook Interceptors      │ Pre/post/turn-end hooks block invalid  │
│      │ (`sentinel-hooks.ts`)  │ commands and AST breaches in RAM.      │
├──────┼────────────────────────┼────────────────────────────────────────┤
│ G-04 │ 20-Role Profile Suite  │ 100% test coverage across all 20 role  │
│      │ (`profiles/*.ts`)      │ contract invariant test suites.        │
├──────┼────────────────────────┼────────────────────────────────────────┤
│ G-05 │ 4-Host Parity Proof    │ End-to-end integration verified across │
│      │ (`tests/sentinel/`)    │ Antigravity, Claude, Codex, Cursor.    │
└──────┴────────────────────────┴────────────────────────────────────────┘
```

This blueprint establishes the immutable operational contract for the Agent-Scoped Live Sentinel, delivering immediate local self-correction while maintaining total architectural tranquility across supervisory tiers.
