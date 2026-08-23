# Plan 10: External Floor Loop & Timer Self-Preservation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent subagents from cancelling or killing root supervisory cron timers and quota-recovery daemons (eliminating the "Helpful Anti-Spam" reasoning blunder), and ensure the supervisory floor loop persists across rate limit windows and task completions.

**Architecture:** Implement a `TimerProtectionGuard` in `olt/scripts/src/authority/` and a task-tagging metadata schema in `.olt/watchdogs.json` that marks infrastructure timers as `protected: true`. Reject any `manage_task kill` or cancellation attempt targeting protected supervisory timers unless executed by the human host.

**Tech Stack:** TypeScript, Bun, JSON schema ledgers, OLT Authority Engine.

**Spec:** `olt/roles/mind.md`, `AGENTS.md` (Axiom 14: Continuous Supervisory Cadence).

## Global Constraints

- Protected supervisory daemons (`5m watchdog`, `30m recovery`) must never be killable by subordinate agent session grants.
- Ephemeral task scratch jobs remain killable by their owner agents.
- Zero `any` in implementation and tests.

---

### Task 1: Implement `TimerProtectionGuard` in `olt/scripts/src/authority/`

**Files:**

- Create: `olt/scripts/src/authority/timer-protection-guard.ts`
- Test: `tests/unit/authority/timer-protection.test.ts`

**Interfaces:**

- Consumes: `callerRole: string`, `taskId: string`, `isSupervisoryTimer: boolean`.
- Produces: `export class TimerProtectionGuard { public static assertCanKillTimer(caller: AgentGrantRecord, timerMetadata: TimerRecord): void; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { TimerProtectionGuard } from "../../../olt/scripts/src/authority/timer-protection-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("TimerProtectionGuard", () => {
  it("blocks subagents from killing protected supervisory timers", () => {
    const caller = { id: "mind-1", role: "mind" };
    const supervisoryTimer = { id: "task-6926", isSupervisory: true, label: "5m watchdog" };

    expect(() => {
      TimerProtectionGuard.assertCanKillTimer(caller, supervisoryTimer);
    }).toThrow(HarnessError);
  });

  it("allows killing ephemeral scratch jobs", () => {
    const caller = { id: "impl-1", role: "implementer" };
    const scratchJob = { id: "task-temp", isSupervisory: false, label: "test runner" };

    expect(() => {
      TimerProtectionGuard.assertCanKillTimer(caller, scratchJob);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/authority/timer-protection.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { HarnessError } from "../core/errors/harness-error.ts";

export interface TimerRecord {
  readonly id: string;
  readonly isSupervisory: boolean;
  readonly label: string;
}

export class TimerProtectionGuard {
  public static assertCanKillTimer(caller: { id: string; role: string }, timer: TimerRecord): void {
    if (timer.isSupervisory && caller.role !== "human_root") {
      throw new HarnessError(
        "INVALID_STATE",
        `Permission Denied: Agent '${caller.id}' (${caller.role}) cannot kill protected supervisory timer '${timer.id}' (${timer.label}). Supervisory heartbeats are immutable.`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/authority/timer-protection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/authority/timer-protection-guard.ts tests/unit/authority/timer-protection.test.ts
git commit -m "feat(authority): implement TimerProtectionGuard to shield supervisory timers"
```
