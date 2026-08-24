# Plan 17: Mandatory Meta-Auditor Observer Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish mandatory automatic deployment of the **Tier 2 Meta-Auditor** (`meta-auditor`) companion subagent whenever long-task orchestration or skill self-evolution is initialized, ensuring real-time forensic auditing of events (`events.jsonl`), behavioral heuristics scanning, and autonomous defect injection (`meta-audit --inject`) into `.olt/backlog.jsonl`.

**Architecture:** Update `mind:pulse` and `orchestrate.ts` to verify the presence of an active `meta-auditor` session. If absent during skill self-improvement or multi-task runs, the harness automatically mandates spawning the Meta-Auditor companion. Enhance `olt/scripts/src/reporting/behavioral-auditor.ts` with deep trace inspection and automated injection pipelines.

**Tech Stack:** TypeScript, Bun, JSON Lines event streams, OLT Meta-Auditor Engine.

**Spec:** `AGENTS.md` (Axiom 23: Tier 2 Meta-Auditor Deep Behavioral Forensics).

## Global Constraints

- Tier 2 Meta-Auditor is strictly forbidden from editing source code, claiming leases, running unit tests, or rubber-stamping unevidenced passes.
- Meta-Auditor must be mandatory when executing on the `@onurseckin/skills` / `olt` repository itself.
- 0 `any` annotations across all audit logic.

---

### Task 1: Enforce Mandatory Meta-Auditor Lifecycle in `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts`

**Files:**

- Create: `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts`
- Test: `tests/unit/scheduler/meta-auditor-policy.test.ts`

**Interfaces:**

- Consumes: `repoRoot: string`, `activeAgents: readonly AgentGrantRecord[]`.
- Produces: `export class MetaAuditorPolicy { public static assertMetaAuditorRequired(repoRoot: string, activeAgents: readonly AgentGrantRecord[]): void; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { MetaAuditorPolicy } from "../../../olt/scripts/src/engine/scheduler/meta-auditor-policy.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("MetaAuditorPolicy", () => {
  it("enforces mandatory meta-auditor when developing skills repo", () => {
    const activeAgents = [{ id: "mind-1", role: "mind" }];

    expect(() => {
      MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents as any);
    }).toThrow(HarnessError);
  });

  it("passes when meta-auditor is actively registered", () => {
    const activeAgents = [
      { id: "mind-1", role: "mind" },
      { id: "meta-auditor-1", role: "meta-auditor" },
    ];

    expect(() => {
      MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents as any);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/scheduler/meta-auditor-policy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `MetaAuditorPolicy`**

```typescript
import { HarnessError } from "../../core/errors/harness-error.ts";
import type { AgentGrantRecord } from "../../core/contracts/agents.ts";

export class MetaAuditorPolicy {
  public static isMandatoryTarget(repoRoot: string): boolean {
    return (
      repoRoot.includes("/skills") ||
      repoRoot.includes("orchestrating-long-tasks") ||
      repoRoot.includes("/olt")
    );
  }

  public static assertMetaAuditorRequired(
    repoRoot: string,
    activeAgents: readonly AgentGrantRecord[],
  ): void {
    if (!this.isMandatoryTarget(repoRoot)) return;

    const hasMetaAuditor = activeAgents.some(
      (a) => a.role === "meta-auditor" || a.role === "mind-auditor",
    );

    if (!hasMetaAuditor) {
      throw new HarnessError(
        "INVALID_STATE",
        "[META_AUDITOR_MANDATE_VIOLATION] Self-evolution of orchestrating-long-tasks skill requires an active Tier 2 Meta-Auditor companion to continuously audit behavioral forensics. You MUST deploy a meta-auditor via invoke_subagent.",
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/scheduler/meta-auditor-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/engine/scheduler/meta-auditor-policy.ts tests/unit/scheduler/meta-auditor-policy.test.ts
git commit -m "feat(scheduler): enforce mandatory Tier 2 Meta-Auditor deployment during skill self-evolution"
```
