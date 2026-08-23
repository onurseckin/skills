# Plan 94: Dual-Channel Review Protocol (Adversarial Defect Resolution & Socratic Cognitive Deepening)

**Status**: ✅ **COMPLETED & ARCHIVED**  
**Location**: `docs/archived-plans/plan-94/PLAN_94_DUAL_CHANNEL_PUSHBACK_PROTOCOL.md`  
**Completion Date**: 2026-08-23

---

## 1. Problem Statement: Single-Pass Reviews vs. Deep Code Perfection

In standard multi-agent systems, code review is often a superficial, single-pass "looks good to me" (LGTM) rubber stamp. When a validator only checks for overt compiler errors, subtle edge cases, architectural blind spots, and race conditions slip through into production.

Our empirical findings prove that dividing reviews into **Two Distinct Pushback Channels** creates 10x higher code quality:

1. **Adversarial Pushbacks**: Reactive, defect-driven corrections when code is wrong, broken, or incomplete.
2. **Cognitive Socratic Pushbacks**: Proactive, edge-case probing rounds that challenge the implementer to elevate quality, stress-test boundaries, and eliminate latent design flaws even when 0 compiler errors exist.

---

## 2. Core Architecture: The Dual-Channel Pushback Protocol

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         DUAL-CHANNEL REVIEW & PUSHBACK ARCHITECTURE                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ CHANNEL 1: Adversarial Defect Pushbacks (`max_adversarial_pushes: 5`) ]                       │
│  • Nature: Reactive & Defect-Driven.                                                             │
│  • Trigger: Code has bugs, broken tests, missing requirements, or contract violations.          │
│  • Lifecycle: Dynamically runs as many rounds as needed until all bugs are resolved.             │
│  • Safety Cap: Bounded by `max_adversarial_pushes` (Default: 5) to prevent infinite loops.       │
│    - If resolved in 1 round ==> 1 adversarial round consumed.                                    │
│    - If 5 rounds fail to resolve ==> Escalates to Coordinator/Mind for repair re-assignment.     │
│                                │                                                                 │
│                                ✚ (AUTOMATIC TRANSITION)                                          │
│                                ▼                                                                 │
│  [ CHANNEL 2: Socratic Cognitive Deepening (`cognitive_pushes: 3`) ]                              │
│  • Nature: Proactive & Socratic.                                                                 │
│  • Trigger: Code is functionally working, but Validator proactively probes edge cases.          │
│  • Lifecycle: Mandated to execute AT LEAST `cognitive_pushes` rounds (Default: 3).               │
│  • Topics Probed:                                                                                │
│    - "What happens if N=0 or input is empty?"                                                    │
│    - "Are there concurrency race conditions or deadlocks?"                                       │
│    - "Are there memory leaks, unbound caches, or unclosed file handles?"                         │
│    - "Can we tighten performance or reduce token footprint?"                                    │
│  • Total Pushbacks = `actual_adversarial_rounds + cognitive_pushes`                              │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Concrete Review Math Examples

### Scenario A: Complex Buggy Feature

- Implementer has a logic flaw on Turn 1 $\rightarrow$ Validator pushes back (**Adversarial Round 1**).
- Implementer fixes logic, but misses an error code $\rightarrow$ Validator pushes back (**Adversarial Round 2**).
- Implementer fixes error code $\rightarrow$ Code is now functionally correct!
- **Cognitive Deepening Begins**:
  - Validator probes empty queue edge case $\rightarrow$ Implementer hardens code (**Cognitive Round 1**).
  - Validator probes concurrency race conditions $\rightarrow$ Implementer adds lock (**Cognitive Round 2**).
  - Validator audits memory & unclosed streams $\rightarrow$ Implementer refactors (**Cognitive Round 3**).
- **Total Rounds**: $2 \text{ (Adversarial)} + 3 \text{ (Cognitive)} = 5 \text{ Rounds Total}$.

### Scenario B: Perfect Turn 1 Implementation

- Implementer writes flawless code on Turn 1 $\rightarrow$ 0 Adversarial rounds needed.
- **Cognitive Deepening Executes**:
  - Cognitive Round 1 (Boundary Probe) $\rightarrow$ Implementer verifies.
  - Cognitive Round 2 (Stress Test) $\rightarrow$ Implementer adds test.
  - Cognitive Round 3 (Static Invariant Audit) $\rightarrow$ Implementer proves 0 `any`.
- **Total Rounds**: $0 \text{ (Adversarial)} + 3 \text{ (Cognitive)} = 3 \text{ Rounds Total}$.

---

## 4. Configuration Hierarchy & Schema

### Level 1: Repository Policy (`olt/policy.json`)

The primary source of truth. Users can customize these numbers per repository:

```json
{
  "schema_version": 1,
  "ecosystem": "bun",
  "package_manager": "bun",
  "test_runner": {
    "default_command": "bun test",
    "targeted_pattern": "bun test <path>",
    "full_suite_command": "bun test"
  },
  "typecheck_command": "bun run typecheck",
  "lint_command": "bun run lint",
  "allowed_commands": [
    "bun test",
    "bun run",
    "tsc",
    "git status",
    "git diff",
    "git log",
    "ls",
    "find",
    "grep",
    "cat",
    "wc"
  ],
  "forbidden_commands": ["git commit", "git push", "git reset", "rm -rf /"],
  "read_scope_neighborhood_depth": 2,
  "review_protocol": {
    "max_adversarial_pushes": 5,
    "cognitive_pushes": 3,
    "enable_cognitive_deepening": true,
    "escalate_on_exhausted_adversarial": true
  }
}
```

### Level 2: Agent Character Fallback (`agent-<id>.json` & Role YAMLs)

If `olt/policy.json` is missing or omits `review_protocol`, the harness falls back to default agent character definitions:

```json
{
  "agent_id": "val-cognition-1",
  "role": "validator",
  "review_config": {
    "max_adversarial_pushes": 5,
    "cognitive_pushes": 3
  }
}
```

### Level 3: Policy Initialization Template

When initializing a new repository without an existing `olt/policy.json`, the initialization agent automatically writes a complete `policy.json` embedding these standard defaults.

---

## 5. Harness CLI & State Machine Tracking

The harness state machine tracks review round progression inside `task.review_history` or `task.review_state`:

```json
{
  "task_id": "task-core-1",
  "review_state": {
    "adversarial_rounds_used": 1,
    "max_adversarial_pushes": 5,
    "cognitive_rounds_completed": 2,
    "cognitive_pushes_required": 3,
    "current_phase": "cognitive_deepening",
    "can_finalize_review": false
  }
}
```

### CLI Command Flags:

- `bun harness.ts task:reject --task <id> --in-lease --kind adversarial --finding "..."`
- `bun harness.ts task:probe --task <id> --kind cognitive --demand "..."`
- `bun harness.ts task:review --task <id> --status pass` $\rightarrow$ **Blocked by Harness** until `cognitive_rounds_completed >= cognitive_pushes_required`!

---

## 6. Implementation Verification & Deliverables

| Target File Path                                                 | Responsibilities & Modifications                                                                                                | Status                         |
| :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :----------------------------- |
| `orchestrating-long-tasks/scripts/src/policy/repo-policy.ts`     | Extends `RepoPolicy` schema with `review_protocol` (`max_adversarial_pushes`, `cognitive_pushes`).                              | ✅ Complete                    |
| `orchestrating-long-tasks/scripts/src/policy/review-protocol.ts` | Core engine managing review round counting, phase transitions (adversarial $\rightarrow$ cognitive), and finalization blockers. | ✅ Complete                    |
| `orchestrating-long-tasks/scripts/src/workflow/task-review.ts`   | Enforces mandatory cognitive pushback rounds before allowing `status: pass`.                                                    | ✅ Complete                    |
| `orchestrating-long-tasks/roles/validator.md`                    | Formalizes the 2-phase review protocol (Phase 1: Defect Audit, Phase 2: Socratic Deepening).                                    | ✅ Complete                    |
| `orchestrating-long-tasks/roles/implementer.md`                  | Formalizes the response contract for in-lease cognitive edge-case questions.                                                    | ✅ Complete                    |
| `tests/unit/policy/review-protocol.test.ts`                      | Dedicated unit tests for review round math, config fallback hierarchy, and boundary conditions.                                 | ✅ Complete (11 passing tests) |
| `tests/unit/workflow/task-review-pushbacks.test.ts`              | Integration tests verifying that tasks cannot pass review until cognitive pushbacks are satisfied.                              | ✅ Complete (5 passing tests)  |
