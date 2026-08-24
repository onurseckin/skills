# Plan 09: Tier 0 Mind Infinite Cadence & Anti-Idle Autonomous Task Discovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an unskippable, infinite autonomous discovery and self-evolution loop for Tier 0 Mind, ensuring that whenever the feedback queue is empty or active runs finish, Mind automatically initiates Mode A Discovery (Zero-`any` audits, Charter gap analysis, Blunder regression tests, and Work/Span DAG optimization) rather than halting or going idle.

**Architecture:** Integrate deterministic Mode A auto-chaining into `mind:pulse` and `mind:wake` telemetry. Implement a `MindAutonomousDiscoveryEngine` in `olt/scripts/src/mind/` that automatically constructs discovery objectives and registers candidate proposals into `.olt/backlog.jsonl` when no active runs exist.

**Tech Stack:** TypeScript, Bun, Node.js process / filesystem APIs, OLT Harness CLI.

**Spec:** `olt/roles/mind.md`, `AGENTS.md` (Axiom 18: Infinite Mind Product Owner Mode).

## Global Constraints

- Zero source code edits directly by Tier 0 Mind (The Three Hard Zeros).
- Zero unit test execution directly by Tier 0 Mind.
- Tier 0 Mind dispatches ONLY Tier 1 Orchestrators (`invoke_subagent`).
- Strict prohibition on `any` annotations or compiler suppressions across all new TypeScript code.
- All tests must run via `bun test <file>` in isolated temporary sandboxes (`.tmp/`).

---

### Task 1: Implement `MindAutonomousDiscoveryEngine` in `olt/scripts/src/mind/`

**Files:**

- Create: `olt/scripts/src/mind/discovery-engine.ts`
- Test: `tests/unit/mind/discovery-engine.test.ts`

**Interfaces:**

- Consumes: `RunState` from `core/contracts/capsule.ts`, `FeedbackQueueItem` from `mind/types.ts`.
- Produces: `export class MindAutonomousDiscoveryEngine { public static scanRepository(repoRoot: string): DiscoveryProposal[]; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { MindAutonomousDiscoveryEngine } from "../../../olt/scripts/src/mind/discovery-engine.ts";

describe("MindAutonomousDiscoveryEngine", () => {
  it("generates deterministic Mode A discovery proposals when queue is empty", () => {
    const proposals = MindAutonomousDiscoveryEngine.generateProposals({
      backlogCount: 0,
      activeRunCount: 0,
      unresolvedDefects: 0,
    });
    expect(proposals.length).toBeGreaterThanOrEqual(3);
    expect(proposals.some((p) => p.category === "zero_any_audit")).toBe(true);
    expect(proposals.some((p) => p.category === "charter_gap_audit")).toBe(true);
    expect(proposals.some((p) => p.category === "work_span_optimization")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mind/discovery-engine.test.ts`
Expected: FAIL with module/class not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface DiscoveryProposal {
  readonly id: string;
  readonly title: string;
  readonly category:
    "zero_any_audit" | "charter_gap_audit" | "work_span_optimization" | "blunder_regression";
  readonly priority: number;
  readonly candidateGoal: string;
}

export class MindAutonomousDiscoveryEngine {
  public static generateProposals(context: {
    backlogCount: number;
    activeRunCount: number;
    unresolvedDefects: number;
  }): readonly DiscoveryProposal[] {
    if (context.backlogCount > 0 || context.activeRunCount > 0) return [];

    return [
      {
        id: `disc-typecheck-${Date.now()}`,
        title: "Autonomous Zero-Any & Compiler Suppression Audit",
        category: "zero_any_audit",
        priority: 100,
        candidateGoal:
          "Audit the codebase for explicit/implicit any types and unauthorized suppressions using tsc --noEmit.",
      },
      {
        id: `disc-charter-${Date.now()}`,
        title: "Autonomous Charter Gap Analysis",
        category: "charter_gap_audit",
        priority: 90,
        candidateGoal: "Audit unfulfilled charter milestones and align public API documentation.",
      },
      {
        id: `disc-workspan-${Date.now()}`,
        title: "Autonomous Work/Span DAG Concurrency Optimization",
        category: "work_span_optimization",
        priority: 80,
        candidateGoal:
          "Analyze topological dependency critical paths and recommend P = ceil(W/S) concurrency decoupling.",
      },
    ];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mind/discovery-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/mind/discovery-engine.ts tests/unit/mind/discovery-engine.test.ts
git commit -m "feat(mind): implement MindAutonomousDiscoveryEngine for Mode A discovery"
```

---

### Task 2: Wire Mode A Auto-Chaining into `mind:pulse` and `mind:wake`

**Files:**

- Modify: `olt/scripts/src/cli/commands/mind-pulse.ts` (or `mind-ops.ts`)
- Test: `tests/unit/mind/pulse-mode-a.test.ts`

**Interfaces:**

- Consumes: `MindAutonomousDiscoveryEngine.generateProposals()`.
- Produces: Formatted Mode A discovery directives injected into pulse brief stdout when active runs = 0.

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { formatPulseDirective } from "../../../olt/scripts/src/cli/commands/mind-pulse.ts";

describe("formatPulseDirective", () => {
  it("injects Mode A discovery mandate when active runs and backlog are zero", () => {
    const output = formatPulseDirective({ activeRuns: 0, pendingBacklog: 0 });
    expect(output).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
    expect(output).toContain("CLOSING_FORBIDDEN_FOR_MIND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mind/pulse-mode-a.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Mode A injection in `mind-pulse.ts`**

Inject the auto-chaining block so that when `activeRuns === 0 && pendingBacklog === 0`, `mind:pulse` renders the unskippable discovery checklist and candidate creation command.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mind/pulse-mode-a.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/commands/mind-pulse.ts tests/unit/mind/pulse-mode-a.test.ts
git commit -m "feat(cli): wire Mode A auto-chaining into mind:pulse telemetry"
```
