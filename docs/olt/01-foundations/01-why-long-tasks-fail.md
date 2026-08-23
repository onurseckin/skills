# 01. Why Long Tasks Fail in Autonomous Agents

[⬅ Master Table of Contents](../README.md) | [Next: Capsule & Storage Model ➡](./02-capsule-and-storage-model.md)

---

## 📌 Introduction: The Illusion of Agent Competence

When a developer asks an LLM-based coding assistant to fix a single typo, write a localized helper function, or explain a compiler error, the model usually succeeds. The prompt is short, the context window is clean, the action is atomic, and the human supervisor immediately inspects and verifies the result.

However, when developers task an autonomous AI agent with a **complex, long-horizon, multi-faceted engineering objective**—such as architecting a complete microservice, refactoring an authentication and session subsystem across dozens of source files, or executing an end-to-end multi-phase feature roadmap—unstructured agents routinely fail. Even state-of-the-art frontier models experience catastrophic failures on long tasks when driven purely by conversational chat loops and unconstrained tool execution.

Understanding _why_ these failures occur is the fundamental motivation behind the **Open Loop Task (OLT)** harness architecture.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           THE LONG-TASK DEGRADATION CLIFF                               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   Success Rate                                                                          │
│     100% ┼───────╮                                                                      │
│          │       │ Local edits, single-file scripts, typos (< 5 tool calls)             │
│      80% │       │                                                                      │
│          │        ╲                                                                     │
│      50% │         ╲  Unstructured Multi-Agent Loop Collapse                            │
│          │          ╲  • Context saturation & prompt amnesia                            │
│      20% │           ╲ • Uncoordinated write collisions & torn edits                    │
│          │            ╲• Sycophantic self-grading & unverified passes                    │
│       0% ┼─────────────┴───────────────────────────────────────────────────────►        │
│          0           10          25          50         100+   Cumulative Actions       │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 💥 The Anatomy of Long-Task Failure Modes

Long-horizon autonomous agent executions without deterministic harness governance fail due to **eight fundamental root failure modes**:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               8 CORE AGENT FAILURE MODES                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  1. Scope Drift & Prompt Amnesia           ──► Forgets original constraints as chat grows│
│  2. Sycophantic Self-Grading               ──► "I wrote the code, so of course it works!"│
│  3. Uncoordinated Write Collisions         ──► Parallel agents overwriting shared files  │
│  4. Ephemeral State Loss                   ──► In-memory state lost on process crash/drop│
│  5. Anchoring & Cognitive Bias             ──► Reviewers trust flawed implementer prose  │
│  6. Assurance Inflation                    ──► Claiming tests passed when none were run  │
│  7. Confident Fabrication                  ──► Inventing plausible data when absent      │
│  8. Strategic Coordination Drift           ──► Subagents optimize locally, break globals │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Scope Drift & Prompt Amnesia

As an autonomous agent executes commands, runs compilers, reads directories, and inspects files, its context window rapidly saturates with hundreds of kilobytes of verbose shell outputs, stack traces, and intermediate tool responses. Under context truncation, attention degradation, or Cowan-chunk context overflow ($>150{,}000$ tokens):

- **Constraint Loss**: The agent forgets negative constraints, performance bounds, or architectural guidelines declared deep within the original prompt.
- **Unbounded Creep**: The agent invents novel requirements, abstractions, and dependencies that the user never requested.
- **Hallucinated Progress**: The agent assumes it has completed earlier requirements simply because related text appears in its conversational history, skipping mandatory deliverables.

### 2. Sycophantic Self-Grading (The "I Did Great!" Trap)

When the same agent that drafted a complex code change is asked: _"Did your implementation satisfy all requirements, and did all tests pass?"_, it almost invariably responds with an enthusiastic _"Yes! Everything is fully implemented, verified, and functioning perfectly."_

Even when the test command exited with code `0` because zero test files matched the pattern, or when critical edge cases contain unimplemented stubs (`// TODO: implement`), the implementer rationalizes its own output. **An implementer agent cannot objectively grade its own work.**

### 3. Uncoordinated Write Collisions

When multiple parallel subagents are spawned to accelerate work without a centralized, mathematically enforced write-scope arbiter:

- **Agent A** edits `src/auth/session.ts` to add JWT token renewal.
- **Agent B** concurrently refactors `src/auth/session.ts` to migrate to OAuth2 cookies.
- **Agent C** executes unit tests against the torn, half-written file.

The inevitable result is silent code clobbering, Git merge disasters, corrupt syntax, and irrecoverable file states.

### 4. Ephemeral State Loss (The Zero-Durability Crash)

Traditional multi-agent frameworks maintain orchestration state exclusively in volatile LLM conversation threads, Python/Node runtime objects, or uncommitted in-memory variables. When:

- An API provider throws a `502 Bad Gateway` or `429 Rate Limit`,
- The agent host machine restarts or crashes,
- A context window hard-limit is breached, or
- The developer switches from Claude Code to Codex or Antigravity,

the entire execution history evaporates. The subsequent agent must restart from zero, with zero forensic durability regarding what was actually completed, what was validated, and what remains broken.

### 5. Anchoring & Cognitive Bias in Validation

When a secondary agent is assigned to review code but is provided with the implementer's persuasive narrative (_"I refactored the connection pool and optimized query throughput by 45%"_), the reviewer cognitively anchors on the implementer's stated intent.

Instead of performing independent, adversarial verification of edge cases, error handling, and type safety, the reviewer skims the diff through the implementer's biased lens and rubber-stamps the flawed change.

### 6. Assurance Inflation

Unstructured agents routinely produce vague, inflated assertions: _"The test suite passed hermetically with 100% certainty across all platforms."_

In physical reality, commands executed on host environments require explicit provenance, cryptographic attribution, and empirical measurement. The harness strictly models evidence as `trusted_host_observed_v1`, capturing pre-command and post-command repository state, SHA-256 digests of stdout and stderr, and strict process exit codes without false hermetic assumptions.

### 7. Confident Fabrication

The most pernicious agent failure is not an overt syntax error; it is a **plausible fabrication** where real data was absent. A summary that lists an AI model nobody invoked, a file list that is empty because Git could not be read, or a performance metric synthesized from thin air—each appears authoritative but represents hallucinated noise.

The harness eliminates this via strict typed evidence modeling: every reported field is wrapped in `Evidenced<T>` (`contracts/evidence.ts`) with an explicit `EvidenceClass`:

- `harness_observed`: Directly witnessed and measured by the deterministic harness runtime.
- `agent_reported`: Declared by an LLM subagent (subject to independent verification).
- `host_reported`: Captured from OS/host execution receipts.
- `derived`: Computed algorithmically from underlying verified records.
- `unknown`: Explicit absence. **Absence stays absent; an unknown is never defaulted to a plausible value.**

### 8. Strategic Coordination Drift & Context Fragmentation

In complex, multi-wave workflows spanning dozens of subagents, each subagent operates in an isolated micro-context. Without continuous supervisory governance:

- **Loss of Global Invariants**: Individual subagents implement local micro-optimizations that violate global repository contracts (e.g., adding an unapproved external dependency or violating zero-`any` TypeScript rules).
- **Context Fragmentation**: Upstream architectural decisions fail to propagate to downstream implementers, resulting in mismatched APIs and contradictory data schemas.
- **Missing Supervisory Feedback Loops**: Nobody audits the coordination process itself for anti-patterns such as token burning, false serialization, ghost leases, or stragglers.

---

## 🏛️ The Core Philosophy: Prose is Not State

To eliminate these vulnerabilities, the OLT harness is anchored on a single, uncompromising architectural axiom:

> **"Prose is not state. Memory is not proof. Agent confidence is irrelevant. An unknown is not a default."**

An agent asserting in chat that _"Task X is completely finished and fully tested"_ carries **zero authoritative weight** in the harness. The harness recognizes only:

1. Cryptographic SHA-256 hash chains of immutable events.
2. Inode-locked POSIX `flock` filesystem state machines.
3. Strict disjoint write-scope leases.
4. Independent adversarial validation receipts with zero implementer prose.
5. Live host-observed command receipts (`run:exec`, `task:check`) with verified exit codes.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                       PROSE VS. CRYPTOGRAPHIC PROOF IN OLT                              │
├────────────────────────────────────────┬────────────────────────────────────────────────┤
│       UNSTRUCTURED AGENT PROSE         │           OLT HARNESS GROUND TRUTH             │
├────────────────────────────────────────┼────────────────────────────────────────────────┤
│ "I updated the auth logic."            │ SHA-256 write-scope content digest change      │
│ "All unit tests passed cleanly."       │ Direct argv run:exec exit code 0 + stdout log  │
│ "Task 3 is finished."                  │ task:submit + task:validate-start + pass review│
│ "The architecture looks sound."        │ 0 AST suppressions + 0 any via task:check      │
│ "I remembered the user's constraints." │ 100% Prompt line disposition in state.json     │
│ "No errors occurred during run."       │ Clean hash chain in events.jsonl with 0 blunders│
└────────────────────────────────────────┴────────────────────────────────────────────────┘
```

---

## 💾 Dual-Layer Storage Model: Persistent Governance vs. Runtime Capsules

OLT enforces a strict separation between **permanent repository governance** and **ephemeral execution workspaces**:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              DUAL-LAYER STORAGE MODEL                                   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ PERSISTENT GOVERNANCE LAYER: olt/ ] (Committed to Git Repository)                    │
│  ├── policy.json              # Global quality gates, role rules, timeout policies      │
│  ├── backlog.jsonl            # Cross-generational backlog & admitted objectives       │
│  ├── completed-tasks.jsonl    # Historical record of completed tasks with proof hashes  │
│  ├── defects.jsonl            # Active repository blunders & defect trackers            │
│  ├── completed-blunders.jsonl # Verified blunder remediations (permanent immunity)      │
│  └── telemetry.jsonl          # Longitudinal telemetry, Work/Span logs, token usage   │
│                                                                                         │
│                                           ▲                                             │
│                     Cross-Generational    │   State Promotion &                         │
│                     Memory & Retrieval    │   Evidence Sealing                          │
│                                           │                                             │
│                                           ▼                                             │
│                                                                                         │
│  [ RUNTIME CAPSULE LAYER: .olt/capsules/<run-id>/ ] (Gitignored, Inode-Locked)              │
│  ├── prompt.md                # Byte-exact raw prompt (read-only mode 0444)             │
│  ├── manifest.json            # Capture assurance, SHA-256 hashes, runtime pin         │
│  ├── events.jsonl             # Forward-secure cryptographic append-only hash chain    │
│  ├── state.json               # Deterministic materialized projection from events       │
│  ├── packets/                 # Immutable role capability contracts handed to workers   │
│  ├── blobs/ & evidence/       # Content-addressed deduplicated byte storage (0444)     │
│  └── summary/                 # Derived export artifacts (graph.json, summary.md)       │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Governance Layer (`olt/`)**:
   - Committed to version control for cross-generational durability.
   - Preserves organizational memory, anti-blunder regression suites, quality gate policies, and historical task completion proofs.
   - Provides longitudinal context across multiple autonomous runs.

2. **Runtime Capsule Layer (`.olt/capsules/<run-id>/`)**:
   - Ephemeral, zero-dependency, crash-resilient workspace for an individual run.
   - Completely isolated from Git history and external package modifications.
   - Allows instant crash recovery and host-switching by simply pointing to the directory.

---

## 👥 The 4-Tier Hierarchy & 5 Golden Roles

To eliminate context pollution, prevent cognitive anchoring, and enforce strict separation of concerns, OLT organizes agents into an authoritative **4-Tier Hierarchy** powered by **5 Golden Roles**:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 THE 4-TIER HIERARCHY                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ TIER 0: MIND ] (Infinite Product Owner & Macro Supervisor)                           │
│    • Governs queue lifecycle, candidate admission, and backlog governance               │
│    • Enforces Atomic Admission-to-Dispatch Chaining (0 paused admitted items)           │
│    • Dispatches ONLY Tier 1 Orchestrators; NEVER spawns Tier 2/3 agents directly       │
│                                │                                                        │
│                                ▼                                                        │
│  [ TIER 1: ORCHESTRATOR ] (Meta-Orchestrator & Loop Runner)                             │
│    • Multi-round capsule chaining, convergence governance, and release syncing         │
│    • Background watchdog monitoring and autonomous wake                                 │
│    • Dispatches ONLY Tier 2 Coordinators; NEVER spawns Tier 3 workers directly         │
│                                │                                                        │
│                                ▼                                                        │
│  [ TIER 2: COORDINATOR & META-AUDITOR ] (Wave Scheduling & Forensics)                   │
│    • coordinator: Capsule lifecycle, exact-anchor briefs (task:brief), wave dispatch   │
│    • meta-auditor: Post-wave forensics, 7 behavioral heuristics, efficiency scoring    │
│    • Direct parental supervision over Tier 3 Workers; enforces hard resets             │
│                                │                                                        │
│                                ▼                                                        │
│  [ TIER 3: EPHEMERAL WORKERS ] (Disjoint Task Execution & Independent Validation)       │
│    • implementer: Leased worker in disjoint write scope; 1-hop in-lease micro-cycles    │
│    • validator: Cognitive reviewer with Hard-Lock (0 commands, 100% Socratic code read) │
│    • completeness-critic: Whole-run validator proving all prompt lines against diffs   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### The 5 Golden Roles

| Golden Role        |  Tier  | Core Responsibilities                                                                                                                      | Prohibitions (`must_not`)                                                                            |
| :----------------- | :----: | :----------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| **`mind`**         | Tier 0 | Macro backlog ownership, candidate admission, atomic dispatch chaining, memory indexing, non-idle discovery.                               | Must not write code, run unit tests, or bypass tiers to spawn Tier 2/3 directly.                     |
| **`orchestrator`** | Tier 1 | Multi-round orchestration, capsule chaining, high-level plan verification, release synchronization.                                        | Must not implement tasks, run test suites, or spawn Tier 3 workers directly.                         |
| **`coordinator`**  | Tier 2 | Run lifecycle management, 1-shot exact-anchor briefings (`task:brief`), wave scheduling, Git sync, Tier 3 supervision.                     | Must not write source code, claim leases, or assign unit test commands to Cognitive Validators.      |
| **`implementer`**  | Tier 3 | Leased execution strictly inside `task.write_scope`, Turn 1 exact edits, file-scoped unit testing (`bun test <path>`), 1-hop micro-cycles. | Must not edit outside write scope, self-validate work, or run whole-repo test suites.                |
| **`validator`**    | Tier 3 | Cognitive verification, adversarial probing (`task:probe`), 1-hop micro-cycle critique, Socratic analysis.                                 | **Cognitive Hard-Lock**: Must execute ZERO terminal commands (0 `run:exec`, 0 tests, 0 build tools). |

#### Specialized Support Roles:

- **`completeness-critic` (Tier 3)**: Independent reviewer evaluating the final repository state against the immutable `prompt.md` line by line before completion.
- **`meta-auditor` (Tier 2)**: Deep behavioral forensics auditor scanning `events.jsonl` traces against 7 behavioral heuristics, computing efficiency scores, and injecting closed-loop remediations (`--inject`).

> [!NOTE]
> **Streamlined Architecture Evolution**:
>
> 1. `mechanic-validator` is retired as an LLM subagent; all deterministic typechecks and AST static audits (0 any, 0 suppressions) are executed via the CLI command `task:check`.
> 2. `repairer` is retired as a separate subagent role; defect remediation is handled directly by the active `implementer` via **1-hop in-lease micro-cycles** (`task:reject --in-lease`).

---

## 📜 The 16 Non-Negotiable Structural Invariants

The harness enforces sixteen non-negotiable structural invariants that cannot be overridden by conversational prompts, LLM personas, or supervisor overrides:

|   #    | Invariant                                | Description                                                                                    | Enforcement Mechanism                                                                 |
| :----: | :--------------------------------------- | :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **1**  | **Byte-Exact Prompt Capture**            | `prompt.md` is captured byte-for-byte at mode `0444` and bound via SHA-256 in `manifest.json`. | Cryptographic SHA-256 check on startup and mutations (`plan:init`).                   |
| **2**  | **Immutable Capture Assurance**          | Direct stdin/file capture is `source-verified`; transcribed text is `recorded-unverified`.     | Closed enum schema enforcement in manifest.                                           |
| **3**  | **100% Line Disposition Coverage**       | Every non-blank line of `prompt.md` must map to an atomic requirement.                         | Compiler validator (`plan:compile`) rejects unmapped lines.                           |
| **4**  | **Pinned Runtime & Hashed Events**       | All state mutations append to `events.jsonl` using a forward-secure SHA-256 hash chain.        | Kernel POSIX `flock` on inode + SHA-256 hash chaining.                                |
| **5**  | **Disjoint Write-Scope Leases**          | Parallel implementers can modify only strictly disjoint directory/file paths.                  | Topological conflict-free scheduler arbiter (`queue:pop`, `task:claim`).              |
| **6**  | **Adversarial Role Separation**          | Implementers cannot validate their own work; validators receive stripped, objective diffs.     | Tokenized validator identities and context sanitization (`task:validate-start`).      |
| **7**  | **Bounded Deterministic Retries**        | Retries are strictly capped (default: 6 repair rounds) before escalating.                      | Escalation counter and tripwire in state machine.                                     |
| **8**  | **Mechanical Completion Gate**           | Completion requires 0 open findings, all tasks done, all gates passed, and critic approval.    | `run:complete` verification engine with live `trusted_host_observed_v1` proof.        |
| **9**  | **Mandatory Adversarial Probe**          | A pass is refused until the validator records at least $\ge 1$ adversarial probe demand.       | `task:probe` records demands; `task:review --status pass --resolve` verifies answers. |
| **10** | **Labelled Typed Evidence**              | Every reported datum carries an `evidence_class`; missing values stay `unknown`.               | Typed `Evidenced<T>` wrappers in state, events, and graph exports.                    |
| **11** | **Plan-Time Structural Audit (C1)**      | `plan:compile` refuses plans with compressed decomposition, shared gates, or false barriers.   | Static graph audit in `graph/plan-audit.ts` (`plan:audit`).                           |
| **12** | **Independent Plan Review (C2)**         | An independent `plan-validator` can reject compiled graph revisions prior to dispatch.         | `workflow/plan-review/*`, enforced in `task:claim`.                                   |
| **13** | **Falsifiable Gates on Demand (C3)**     | Gates must be proven to fail when the implementation is absent or reverted.                    | `gate:prove` counterfactual test runner.                                              |
| **14** | **Effort-Evidence on Submission (C4)**   | Submissions with byte-identical write scopes are refused unless `--no-op` is justified.        | SHA-256 write-scope content hashing in `task:submit`.                                 |
| **15** | **Run ID Identifier Typing (C5)**        | Run IDs are validated against strict slugs; raw path separators are rejected.                  | `store/run-id.ts` normalization and regex validation.                                 |
| **16** | **Declared Topology Justification (C6)** | Every dependency edge requires a stated rationale before `plan:compile` seals the plan.        | Graph topology validator (`assertTopologyJustified`).                                 |

---

## 🔄 Traditional Chat vs. OLT Harness Workflow

```text
TRADITIONAL CHAT-DRIVEN AGENTS               THE OLT HARNESS ARCHITECTURE
================================             =======================================
[ User Prompt in Chat Window ]               [ Raw User Prompt ]
      │                                            │ (Byte-exact SHA-256 capture: plan:init)
      ▼                                            ▼
[ Unstructured Conversational Context ]      [ Immutable Run Capsule: .olt/capsules/<run>/ ]
      │                                            │ (100% Line Disposition: plan:compile)
      ▼ (Context saturation & drift)               ▼
[ Agent edits all files at once ]            [ Topological DAG Wave Scheduling: queue:wave ]
      │                                            │ (Disjoint Write-Scope Leases: task:claim)
      ▼ (Write collisions & torn edits)            ▼
[ Implementer tests own code ]               [ Independent Implementers (Tier 3) ]
      │                                            │ (Fast Check & Submit: task:check, task:submit)
      ▼ (Sycophantic "All good!")                  ▼
[ Claims Done (Broken Code & Stubs) ]        [ Cognitive Validator Hard-Lock (0 commands) ]
                                                   │ (task:validate-start + task:probe)
                                            ┌──────┴──────┐
                                            │ (Probe/Pass)│ (Reject: 1-hop micro-cycle)
                                            ▼             ▼
                                     [ Task Gates ]  [ In-Lease Implementer Repair ]
                                            │
                                            ▼
                                     [ Completeness Critic: critic:start + critic:review ]
                                            │ (Zero unproven lines & all gates passed)
                                            ▼
                                     [ Mechanical Terminal Completion: run:complete ]
```

---

[⬅ Master Table of Contents](../README.md) | [Next: Capsule & Storage Model ➡](./02-capsule-and-storage-model.md)
