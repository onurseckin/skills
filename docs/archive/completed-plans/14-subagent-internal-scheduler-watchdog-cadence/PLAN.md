# Plan 14: Subagent Internal Scheduler & Watchdog Cadence

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide continuous internal watchdog telemetry and step-budget monitoring inside child subagent execution trajectories, preventing silent hangs, polling waste (`sleep`), and multi-turn role drift.

**Architecture:** Implement a `SubagentWatchdogTelemetryMonitor` in `olt/scripts/src/reporting/` that tracks turn counts, tool iterations, and execution duration per subagent ID in `.olt/watchdogs.json`. Trigger automated alerts when an agent exceeds its step threshold or engages in polling waste.

**Tech Stack:** TypeScript, Bun, JSON telemetry ledgers, OLT Behavioral Auditor.

**Spec:** `AGENTS.md` (Axiom 12: Supervisor Role Boundary Watchdog, Axiom 23: Deep Behavioral Forensics).

## Global Constraints

- Subagents must not poll in sleep loops (`sleep 5` is strictly banned).
- Multi-turn trajectories exceeding 25 turns without lease submission must be flagged as `STRAGGLER`.
- 0 `any` annotations.

---

### Task 1: Implement `SubagentWatchdogTelemetryMonitor` in `olt/scripts/src/reporting/`

**Files:**

- Create: `olt/scripts/src/reporting/subagent-watchdog-monitor.ts`
- Test: `tests/unit/reporting/subagent-watchdog.test.ts`

**Interfaces:**

- Consumes: `agentId: string`, `turnCount: number`, `lastActionTimestamp: string`.
- Produces: `export class SubagentWatchdogTelemetryMonitor { public static evaluateHealth(record: SubagentTelemetry): WatchdogHealthReport; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { SubagentWatchdogTelemetryMonitor } from "../../../olt/scripts/src/reporting/subagent-watchdog-monitor.ts";

describe("SubagentWatchdogTelemetryMonitor", () => {
  it("detects polling waste and excessive turn counts", () => {
    const report = SubagentWatchdogTelemetryMonitor.evaluateHealth({
      agentId: "impl-1",
      turnCount: 30,
      recentCommands: ["sleep 5", "sleep 5", "sleep 5"],
    });

    expect(report.isHealthy).toBe(false);
    expect(report.detectedAnomalies).toContain("POLLING_WASTE");
    expect(report.detectedAnomalies).toContain("STRAGGLER");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/reporting/subagent-watchdog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `SubagentWatchdogTelemetryMonitor`**

```typescript
export interface SubagentTelemetry {
  readonly agentId: string;
  readonly turnCount: number;
  readonly recentCommands: readonly string[];
}

export interface WatchdogHealthReport {
  readonly isHealthy: boolean;
  readonly detectedAnomalies: readonly string[];
  readonly remediation: string | null;
}

export class SubagentWatchdogTelemetryMonitor {
  public static evaluateHealth(telemetry: SubagentTelemetry): WatchdogHealthReport {
    const anomalies: string[] = [];

    const sleepCount = telemetry.recentCommands.filter((c) => c.includes("sleep")).length;
    if (sleepCount >= 2) {
      anomalies.push("POLLING_WASTE");
    }

    if (telemetry.turnCount > 25) {
      anomalies.push("STRAGGLER");
    }

    return {
      isHealthy: anomalies.length === 0,
      detectedAnomalies: anomalies,
      remediation:
        anomalies.length > 0 ? "Trigger hard reset or inject role reminder prompt" : null,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/reporting/subagent-watchdog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/reporting/subagent-watchdog-monitor.ts tests/unit/reporting/subagent-watchdog.test.ts
git commit -m "feat(reporting): implement SubagentWatchdogTelemetryMonitor for anti-hang protection"
```
