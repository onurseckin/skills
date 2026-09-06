# Role Boundaries & Supervisory Responsibility Division

This document evaluates the division of labor across agent tiers, diagnoses supervisory overloading in Tiers 0, 1, and 2, and formalizes the necessity, contract, and lifecycle of a dedicated Tier 3 **`publisher`** (Release Subagent).

---

## 1. The Supervisory Overloading Problem

In the current repository implementation, high-level supervisory agents are burdened with low-level operational plumbing:

```text
CURRENT OVERLOADED ARCHITECTURE:
┌─────────────────────────────────────────────────────────────────────────────┐
│ Tier 0 Mind / Tier 1 Orchestrator / Tier 2 Coordinator                      │
│                                                                             │
│  [ High-Level Cognition ]                                                   │
│    • Autonomous Product Roadmap, Backlog Grooming, Wave Planning            │
│                                                                             │
│  [ Low-Level Operational Plumbing (LEAKAGE) ]                               │
│    • git add -A (Reflog staging)                                            │
│    • worktree:land (Branch rebase, merge, and directory teardown)           │
│    • git commit -m "feat(...)" (Conventional Commit generation)             │
│    • Pre-push hook verification (modularity:staged, lint, typecheck)        │
│    • git push origin main (Network I/O, remote credential checks)           │
│    • bun scripts/sync-global.ts (Global ~/.agents/ skills synchronization)  │
│                                                                             │
│  ⚠️ DANGERS: Token burning on git diffs; context pollution; stalled loops    │
│              on push conflicts; supervisors attempting inline code fixes!   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Forensic Evidence of Supervisory Drift:

1. **Tool Permission Drift**: [mind.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/mind.yaml#L13), [orchestrator.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml#L13), and [coordinator.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/coordinator.yaml#L13) all grant `enable_write_tools: true`. This directly contradicts [§12](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L49-L52) and [§34](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L130-L132) ("Supervisor Zero Direct Code Edits").
2. **Plumbing Commands in Coordinator Manifest**: [coordinator.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/coordinator.yaml#L98) explicitly includes `worktree:land`, `worktree:clean`, and in [olt/policy.json](file:///Users/onurseckinsenoglu/repos/skills/olt/policy.json#L156-L157) grants `git commit` and `git push`.
3. **Cognitive Degradation During Failures**: If a pre-push gate (such as `modularity:staged`) fails during landing, a Tier 2 Coordinator running on High Thinking is forced to inspect git staging status, diagnose whitespace or line counts, and attempt manual git resets. This frequently triggers fatal boundary violations (`ROLE_BOUNDARY_DEVIATION`).

---

## 2. Strict Separation of Concerns Axiom

Supervisory tiers must remain strictly detached from execution and filesystem mutations:

```text
┌──────────────┬──────────────────────────────────────────┬────────────────────────────────────────┐
│ Tier         │ Authorized Cognitive Mandate             │ Non-Negotiable Operational Prohibition  │
├──────────────┼──────────────────────────────────────────┼────────────────────────────────────────┤
│ **Tier 0**   │ Strategic vision, backlog, charter goals │ 0 code edits, 0 git landing/pushes     │
│ **Tier 1**   │ Multi-round loop, defect fan-in          │ 0 code edits, 0 git landing/pushes     │
│ **Tier 2**   │ Wave DAG dispatch, 1-shot briefs         │ 0 code edits, 0 git landing/pushes     │
│ **Tier 3**   │ Exact code implementation (Implementer)  │ Confined to leased write_scope         │
│ **Tier 3**   │ Cognitive Socratic review (Validator)    │ 0 bash commands (can_execute_shell=0)  │
│ **Tier 3**   │ Worktree landing & push (**Publisher**)  │ 0 feature authoring, 0 task claiming   │
└──────────────┴──────────────────────────────────────────┴────────────────────────────────────────┘
```

---

## 3. Dedicated Release Subagent (`publisher`) Specification

To liberate Tier 1 and Tier 2 supervisors from git plumbing and ensure hermetic pre-push verification, we specify a dedicated Tier 3 role: **`publisher`** (or `release_subagent`).

### Role Lifecycle in Wave Execution:

1. **Wave Convergence**: Coordinator dispatches parallel Implementer/Validator pairs across ready lanes.
2. **Two-Key Approval**: All tasks in the wave obtain passing cognitive and mechanic validation receipts.
3. **Publisher Lease**: Coordinator dispatches the `publisher` subagent to finalize the wave:
   `invoke_subagent(Role: "publisher", Subagents: [{ task_id: "release-<wave>", track_id: "track-1" }])`
4. **Autonomous Release Pipeline**:
   - Executes reflog safety staging: `git add -A`
   - Runs pre-push quality gates: `bun run modularity:staged` and `task:check`
   - Reconciles worktree track: `bun harness.ts worktree:land --track <id> --target-branch main`
   - Authors Conventional Commit message synthesizing task IDs and summaries: `git commit`
   - Pushes to remote repository: `git push origin main`
   - Executes global skill mirror: `bun scripts/sync-global.ts`
5. **Receipt Emission**: Emits a cryptographic `ReleaseCertificate` back to Coordinator via mailbox IPC:
   `msg:send --to coordinator --body "RELEASE_COMPLETE: sha=4f9b2c..."`
6. **Hard Reset**: Coordinator kills the publisher subagent (`manage_subagents kill`) upon wave close.

### Manifest Definition (`olt/agents/publisher.yaml`):

```yaml
name: "publisher"
role: "publisher"
tier: 3
provider:
  - "antigravity"
  - "claude"
  - "codex"
  - "cursor"
tools:
  enable_subagent_tools: false
  enable_write_tools: true # Needed for git index staging & commit blobs
interface:
  display_name: "Tier 3 Wave Release & Publishing Subagent"
  short_description: "Owns hermetic worktree landing, pre-push verification gates, conventional commits, and upstream publishing"
communication_contract:
  mandatory_turn_completion_actions:
    - "doctor:verify"
  protocol: "mailbox_ipc"
  mailbox_path: ".olt/mailboxes/{agent_id}/"
  lock_path: ".olt/locks/mailboxes/{agent_id}.lock"
  allowed_channels:
    - "msg:send"
    - "msg:recv"
permissions:
  may:
    - "Execute worktree:land, worktree:clean, and worktree:status"
    - "Execute pre-push verification gates (modularity:staged, task:check, bun test <file>)"
    - "Stage modified files into Git index (git add -A) for reflog protection"
    - "Generate structured Conventional Commits (git commit)"
    - "Push verified commits to upstream remote (git push origin main)"
    - "Synchronize global skill mirrors via bun scripts/sync-global.ts"
  must_not:
    - "Modify application source code files directly (zero source code editing)"
    - "Claim implementation task leases or execute feature development"
    - "Render validator verdicts or approve task deliverables"
    - "Bypass pre-push verification gates"
    - "Push un-gated or failing working tree changes to remote"
  commands:
    - "worktree:land"
    - "worktree:clean"
    - "worktree:status"
    - "task:check"
    - "doctor"
    - "whoami"
    - "msg:send"
    - "msg:recv"
invariants:
  - "RELEASE_GATE_ZERO_FALLBACK"
  - "REFLOG_PROTECTION_MANDATE"
  - "ZERO_FEATURE_CODE_MUTATION"
```

---

## 4. Evaluation: Dedicated Subagent vs Deterministic CLI Tool

An essential architectural trade-off is whether releasing should be a **dedicated LLM subagent** or a **pure deterministic CLI tool**:

```text
┌───────────────────────────┬────────────────────────────────────────────────────────────────────────┐
│ Approach                  │ Architectural Trade-Off Analysis                                       │
├───────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ **Option A: Pure CLI**    │ • Coordinator runs `bun harness.ts release:land --wave <w>`            │
│ (`release:land`)          │ • Pro: Zero LLM token cost; instantaneous execution; 100% deterministic.│
│                           │ • Con: Cannot intelligently synthesize natural conventional commit      │
│                           │   messages from multi-task requirements without hard-coded templates.   │
├───────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ **Option B: Pure Agent**  │ • LLM runs arbitrary git commands via shell                            │
│ (`publisher`)             │ • Pro: High flexibility in authoring descriptive commit narratives.     │
│                           │ • Con: Vulnerable to command hallucination (`git reset --hard`, etc.). │
├───────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ **Option C: Hybrid (SSoT)│ • Dedicated `publisher` agent executes deterministic CLI tools:         │
│ (RECOMMENDED)**           │   `task:check`, `worktree:land`, `release:commit --msg ...`, `git push`.│
│                           │ • Pro: Combines semantic commit narrative authoring with 100%           │
│                           │   deterministic gate enforcement and shell isolation.                   │
└───────────────────────────┴────────────────────────────────────────────────────────────────────────┘
```

### Recommendation: Option C (Hybrid Pattern)

- Under the Hybrid pattern, the `publisher` subagent is deployed with a narrow RBAC profile. It uses an in-process CLI command `release:publish --message <msg>` that wraps pre-push gates, worktree landing, and remote push in a single atomic transaction.
- If pre-push gates pass, the commit lands and pushes automatically.
- If pre-push gates fail, the publisher inspects the error brief, determines whether it is an unformatted file or a test failure, and reports a clean rejection receipt back to Coordinator for targeted Implementer re-dispatch.

---

## 5. Supervisor Manifest Hardening Actions

To enforce strict role boundaries, the following edits must be executed in `olt/agents/`:

1. **`mind.yaml`**:
   - Set `tools.enable_write_tools: false`.
   - Purge any commands relating to file mutation.
2. **`orchestrator.yaml`**:
   - Set `tools.enable_write_tools: false`.
   - Remove `worktree:land` from `commands` list.
3. **`coordinator.yaml`**:
   - Set `tools.enable_write_tools: false`.
   - Remove `worktree:land`, `worktree:clean` from `commands` list.
   - Update `spawns` to include `publisher`.
4. **`olt/policy.json`**:
   - Revoke `git commit` and `git push` from `coordinator.rbac.allowed_commands`.
   - Register `publisher` in `policy.json` agents dictionary.

---

## 6. Hierarchical Escalation Dispatch Protocol & Journey Audit Trail

When an autonomous auditor (such as the permanent singleton `skill-auditor` or `meta-auditor`) discovers an invariant violation, physical line length breach, wildcard export defect, or regression for any file, task, or lane:

### 6.1 The Upward Traversal Ladder

If the auditor cannot find the directly responsible agent, it must systematically traverse up the parent tree until an active supervisory recipient is reached:

```text
AUDITOR DEFECT DISCOVERY (e.g. Invariant Violation / LOC Breach in Task 4)
  │
  ├─▶ Step 1: Direct Target Dispatch ───▶ [Implementer] (implementer_task4)
  │                                           │ (Status: NOT_FOUND / INACTIVE)
  ▼                                           ▼
  ├─▶ Step 2: Immediate Parent Fallback ─▶ [Coordinator] (coordinator_wave2)
  │                                           │ (Status: NOT_FOUND / INACTIVE)
  ▼                                           ▼
  ├─▶ Step 3: Meta-Orchestrator Fallback ─▶ [Orchestrator] (orchestrator_feature)
  │                                           │ (Status: NOT_FOUND / INACTIVE)
  ▼                                           ▼
  └─▶ Step 4: Sovereign Root Escalation ──▶ [Mind] (mind / Tier 0 Product Owner)
                                              (Status: DELIVERED / ACTIVE)
```

1. **Step 1 (Direct Worker Target)**: Attempt direct mailbox IPC dispatch to the active worker leasing that write scope (`implementer_<task>`).
2. **Step 2 (Wave Coordinator)**: If the implementer is not found, has no active mailbox, or has completed/terminated, find its direct parent `coordinator_<wave>`.
3. **Step 3 (Feature Orchestrator)**: If the coordinator is not found or inactive, traverse up to `orchestrator_<feature>`.
4. **Step 4 (Sovereign Mind Supervisor)**: If the orchestrator is not found or inactive, escalate to Tier 0 `mind` (`sovereign-mind`).

### 6.2 Mandatory Routing Journey Audit Trail

Every escalation message payload MUST embed a machine-verifiable routing audit trail documenting each step attempted:

```text
[ROUTING_JOURNEY]
- Attempt 1: Target: implementer_task-156ubw (implementer) -> Status: NOT_FOUND / TERMINATED
- Attempt 2: Parent: coordinator_wave2 (coordinator) -> Status: NOT_FOUND / COMPLETED
- Attempt 3: Parent: orchestrator_core (orchestrator) -> Status: INACTIVE / UNKNOWN
- Attempt 4: Root: mind-gen-4 (mind) -> Status: DELIVERED
```

This prevents silent delivery drops, guarantees that defect escalations always land at an active decision-making authority, and leaves a complete forensic breadcrumb trail of why a supervisor was alerted.
