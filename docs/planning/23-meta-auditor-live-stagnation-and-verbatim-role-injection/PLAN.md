# Plan 23: Meta-Auditor Live Stagnation Detection & Verbatim Role Injection Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Tier 2 Meta-Auditor from a passive post-hoc event log reviewer into an active, real-time behavioral watchdog and automated prompt injector. When Meta-Auditor detects that Tier 0 Mind (or any supervisory agent) is stagnating or idling ($> 2$ minutes), Meta-Auditor **MUST NOT assume or synthesize** what the Mind should do—it must **mechanically read the exact, canonical role markdown file directly from disk (`olt/roles/mind.md`)** and inject that verbatim file content into the prompt to force the agent back to work without personal interpretation risk.

**Architecture:**

1. **Verbatim Role Injector (`VerbatimRoleInjector`)**: Directly reads `olt/roles/<role>.md` using `readFileSync`. Builds an unadulterated injection packet combining empirical live state metrics (idle time, defect count, backlog count) + the **exact, unedited verbatim markdown text of `olt/roles/mind.md`**.
2. **Live Stagnation Detector (`MindStagnationDetector`)**: Queries `manage_subagents` lifecycle states. If Tier 0 Mind is in `state: "idle"` for $> 120$ seconds, it triggers the `VerbatimRoleInjector` to emit a wake-up message via `send_message(mind_id)`.
3. **Hanging Process Watchdog (`HangingProcessAuditor`)**: Queries `manage_task` background tasks. If a subprocess runs $> 180$ seconds with 0 stdout updates (interactive TUI hang like `agy models`), it automatically terminates the process via `manage_task(kill)`.
4. **Global Root & Namespace Hygiene Surveillance (`HygieneForensicScanner`)**: Scans repository root for unauthorized files/symlinks (`checklists`, `roles`) and `olt/` for misplaced runtime data (`.jsonl`, `completed-tasks.jsonl`). Automatically logs violations in `.olt/defects.jsonl` and moves files to `.olt/` or `scratch/`.
5. **Dynamic Behavioral Forensics (`BehavioralForensicsEngine`)**: Expands heuristics to 9 canonical checks: `TOKEN_BURNING`, `FALSE_SERIALIZATION`, `ROLE_BOUNDARY_DEVIATION`, `POLLING_WASTE`, `CONTEXT_OVERFLOW`, `GHOST_LEASE`, `STRAGGLER`, `SUPERVISORY_IDLE_STAGNATION`, and `NAMESPACE_POLLUTION_VIOLATION`.

**Tech Stack:** TypeScript, Bun, file system inspection, process management, Antigravity messaging.

**Spec:** `AGENTS.md` (Axiom 23: Deep Behavioral Forensics & Autonomous Injection), `olt/roles/meta-auditor.md`.

---

## Global Constraints

- **Zero Paraphrasing / Zero Assumptions**: When injecting reminders or mandates to Mind or other roles, the text of the role mandate MUST be loaded verbatim from `olt/roles/<role>.md` on disk.
- Zero `any` annotations.
- Zero direct implementation writes by Meta-Auditor (supervisory boundary).

---

### Task 1: Implement `VerbatimRoleInjector` in `olt/scripts/src/authority/verbatim-role-injector.ts`

**Files:**

- Create: `olt/scripts/src/authority/verbatim-role-injector.ts`
- Test: `tests/unit/authority/verbatim-role-injector.test.ts`

**Interfaces:**

```typescript
export interface StagnationTelemetry {
  agentId: string;
  conversationId: string;
  role: string;
  idleDurationSeconds: number;
  pendingBacklogCount: number;
  pendingPlanCount: number;
  unresolvedDefectCount: number;
}

export class VerbatimRoleInjector {
  public static buildInjectionPrompt(
    repoRoot: string,
    role: string,
    telemetry: StagnationTelemetry,
  ): string;
}
```

- [ ] **Step 1: Write failing unit test for `VerbatimRoleInjector`**

```typescript
import { describe, it, expect } from "bun:test";
import { VerbatimRoleInjector } from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("VerbatimRoleInjector", () => {
  const repoRoot = process.cwd();

  it("reads exact verbatim markdown from olt/roles/mind.md without assuming or paraphrasing", () => {
    const rawMindMd = readFileSync(join(repoRoot, "olt/roles/mind.md"), "utf-8");

    const telemetry = {
      agentId: "mind-1",
      conversationId: "conv-12345",
      role: "mind",
      idleDurationSeconds: 180,
      pendingBacklogCount: 2,
      pendingPlanCount: 1,
      unresolvedDefectCount: 0,
    };

    const prompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);

    // Must include telemetry header
    expect(prompt).toContain("IDLE STAGNATION DETECTED");
    expect(prompt).toContain("Duration: 180s");
    expect(prompt).toContain("conv-12345");

    // Must contain verbatim file content from disk
    expect(prompt).toContain(rawMindMd);

    // Must contain directive to resume
    expect(prompt).toContain(
      "Above is your authoritative canonical contract from olt/roles/mind.md verbatim",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/authority/verbatim-role-injector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `VerbatimRoleInjector`**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

export interface StagnationTelemetry {
  agentId: string;
  conversationId: string;
  role: string;
  idleDurationSeconds: number;
  pendingBacklogCount: number;
  pendingPlanCount: number;
  unresolvedDefectCount: number;
}

export class VerbatimRoleInjector {
  public static buildInjectionPrompt(
    repoRoot: string,
    role: string,
    telemetry: StagnationTelemetry,
  ): string {
    const rolePath = join(repoRoot, "olt", "roles", `${role}.md`);
    if (!existsSync(rolePath)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `[ROLE_DEFINITION_MISSING] Cannot find canonical role definition for '${role}' at '${rolePath}'.`,
      );
    }

    const rawRoleContract = readFileSync(rolePath, "utf-8");

    return `[META-AUDITOR AUTONOMOUS SUPERVISORY NUDGE: IDLE STAGNATION DETECTED]

================================================================================
1. EMPIRICAL TELEMETRY:
================================================================================
• Target Agent ID: ${telemetry.agentId}
• Conversation ID: ${telemetry.conversationId}
• Lifecycle State: IDLE (Duration: ${telemetry.idleDurationSeconds}s)
• Pending Backlog Items (.olt/backlog.jsonl): ${telemetry.pendingBacklogCount}
• Pending Planning Specs (docs/planning/): ${telemetry.pendingPlanCount}
• Unresolved Defects (.olt/defects.jsonl): ${telemetry.unresolvedDefectCount}

================================================================================
2. AUTHORITATIVE CANONICAL ROLE CONTRACT (VERBATIM FROM olt/roles/${role}.md):
================================================================================
${rawRoleContract}

================================================================================
3. IMMEDIATE DIRECTIVE:
================================================================================
Above is your authoritative canonical contract from 'olt/roles/${role}.md' verbatim without modification or assumption.
You are strictly forbidden from remaining idle. Resume your strategic and operational responsibilities immediately.
`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/authority/verbatim-role-injector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/authority/verbatim-role-injector.ts tests/unit/authority/verbatim-role-injector.test.ts
git commit -m "feat(authority): implement VerbatimRoleInjector for unadulterated role injection"
```

---

### Task 2: Implement `MindStagnationDetector` & `HangingProcessAuditor` in `olt/scripts/src/reporting/stagnation-detector.ts`

**Files:**

- Create: `olt/scripts/src/reporting/stagnation-detector.ts`
- Test: `tests/unit/reporting/stagnation-detector.test.ts`

**Interfaces:**

```typescript
export interface SubagentStateInfo {
  role: string;
  conversationId: string;
  state: "running" | "idle" | "waiting_for_dependents" | "waiting_for_input" | "errored";
  idleSeconds: number;
}

export interface TaskProcessInfo {
  taskId: string;
  command: string;
  durationSeconds: number;
  hasOutput: boolean;
}

export class StagnationDetector {
  public static evaluateSubagents(
    subagents: SubagentStateInfo[],
    maxIdleSeconds?: number,
  ): SubagentStateInfo[];
  public static evaluateHangingProcesses(
    tasks: TaskProcessInfo[],
    maxSilentSeconds?: number,
  ): TaskProcessInfo[];
}
```

- [ ] **Step 1: Write failing unit test for `StagnationDetector`**

```typescript
import { describe, it, expect } from "bun:test";
import { StagnationDetector } from "../../../olt/scripts/src/reporting/stagnation-detector.ts";

describe("StagnationDetector", () => {
  it("flags Mind when it has been idle for more than 120 seconds", () => {
    const subagents = [
      {
        role: "Tier 0 Mind — Infinite Strategic Brain",
        conversationId: "c1",
        state: "idle" as const,
        idleSeconds: 150,
      },
      {
        role: "Tier 1 Orchestrator",
        conversationId: "c2",
        state: "running" as const,
        idleSeconds: 0,
      },
    ];

    const stagnating = StagnationDetector.evaluateSubagents(subagents, 120);
    expect(stagnating.length).toBe(1);
    expect(stagnating[0]?.conversationId).toBe("c1");
  });

  it("flags hanging tasks running with no output for more than 180 seconds", () => {
    const tasks = [
      { taskId: "task-1", command: "agy models", durationSeconds: 240, hasOutput: false },
      { taskId: "task-2", command: "bun test foo.test.ts", durationSeconds: 20, hasOutput: true },
    ];

    const hanging = StagnationDetector.evaluateHangingProcesses(tasks, 180);
    expect(hanging.length).toBe(1);
    expect(hanging[0]?.taskId).toBe("task-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/reporting/stagnation-detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `StagnationDetector`**

```typescript
export interface SubagentStateInfo {
  role: string;
  conversationId: string;
  state: "running" | "idle" | "waiting_for_dependents" | "waiting_for_input" | "errored";
  idleSeconds: number;
}

export interface TaskProcessInfo {
  taskId: string;
  command: string;
  durationSeconds: number;
  hasOutput: boolean;
}

export class StagnationDetector {
  public static evaluateSubagents(
    subagents: readonly SubagentStateInfo[],
    maxIdleSeconds: number = 120,
  ): SubagentStateInfo[] {
    return subagents.filter((agent) => {
      const isSupervisor =
        agent.role.toLowerCase().includes("mind") ||
        agent.role.toLowerCase().includes("orchestrator");
      return isSupervisor && agent.state === "idle" && agent.idleSeconds >= maxIdleSeconds;
    });
  }

  public static evaluateHangingProcesses(
    tasks: readonly TaskProcessInfo[],
    maxSilentSeconds: number = 180,
  ): TaskProcessInfo[] {
    return tasks.filter((task) => {
      return task.durationSeconds >= maxSilentSeconds && !task.hasOutput;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/reporting/stagnation-detector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/reporting/stagnation-detector.ts tests/unit/reporting/stagnation-detector.test.ts
git commit -m "feat(reporting): implement StagnationDetector for subagents and hanging processes"
```

---

### Task 3: Implement Meta-Auditor CLI Command `meta-audit:live` in `olt/scripts/src/cli/commands/meta-audit-live.ts`

**Files:**

- Create: `olt/scripts/src/cli/commands/meta-audit-live.ts`
- Register: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/meta-audit-live.test.ts`

**Interfaces:**

- CLI Usage: `bun harness.ts meta-audit:live [--inject] [--auto-kill]`
- Produces: Structured markdown output with empirical counts, detects stagnating agents, outputs verbatim injection payloads, and records violations to `.olt/defects.jsonl`.

- [ ] **Step 1: Write failing unit test for `meta-audit:live` CLI command**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `meta-audit:live`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit & Sync**

```bash
git add olt/scripts/src/cli/commands/meta-audit-live.ts tests/unit/cli/meta-audit-live.test.ts olt/scripts/src/cli/execute.ts
git commit -m "feat(cli): add meta-audit:live command with automatic verbatim role injection"
bun scripts/sync-global.ts
```
