import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { mindPulseOpenCommand } from "../../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { skillAuditLiveCommand } from "../../../../olt/scripts/src/cli/commands/skill-audit-live.ts";
import type { JsonValue } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";
import { readLastPulse, writeLastPulse } from "../../../../olt/scripts/src/mind/lifecycle/index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

function freshRepoRoot(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), `auditor-liveness-${prefix}-`));
  roots.push(repo);
  return repo;
}

function writeCapsuleEvents(capsuleRoot: string, lines: readonly Record<string, unknown>[]): void {
  mkdirSync(capsuleRoot, { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(join(capsuleRoot, "events.jsonl"), body, "utf-8");
}

function writeCapsuleState(capsuleRoot: string, state: Record<string, unknown>): void {
  mkdirSync(capsuleRoot, { recursive: true });
  writeFileSync(join(capsuleRoot, "state.json"), JSON.stringify(state), "utf-8");
}

function simpleEvent(
  seq: number,
  kind: string,
  actor: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind,
    sequence: seq,
    actor,
    payload,
    timestamp: `2026-08-25T00:00:${String(seq).padStart(2, "0")}.000Z`,
  };
}

function asBoolean(v: JsonValue | undefined): boolean {
  return typeof v === "boolean" ? v : false;
}

function asNumber(v: JsonValue | undefined): number {
  return typeof v === "number" ? v : Number.NaN;
}

const MIN_MANIFEST_YAML = `role: mind
tier: 0
spawns:
  - orchestrator
may:
  - Coordinate strategic goals
must_not:
  - Implement code directly
`;

describe("cursor identity carries observer AND capsule (mechanism c)", () => {
  test("a second observer on a different capsule scans that capsule's events from the beginning", () => {
    const repoRoot = freshRepoRoot("cursor-identity");
    const capsuleA = join(repoRoot, ".olt", "capsules", "capsule-a");
    const capsuleB = join(repoRoot, ".olt", "capsules", "capsule-b");

    writeCapsuleEvents(
      capsuleA,
      Array.from({ length: 5 }, (_, i) => simpleEvent(i, "agent-registered", "agent-a", {})),
    );
    writeCapsuleEvents(
      capsuleB,
      Array.from({ length: 7 }, (_, i) => simpleEvent(i, "agent-registered", "agent-b", {})),
    );

    const resultA = SkillAuditorEngine.auditSkillCompliance(repoRoot, {
      capsuleRunRoot: capsuleA,
      logDefects: false,
      now: "2026-08-25T00:01:00.000Z",
    });
    expect(resultA.eventsAnalyzed).toBe(5);

    const resultB = SkillAuditorEngine.auditSkillCompliance(repoRoot, {
      capsuleRunRoot: capsuleB,
      logDefects: false,
      now: "2026-08-25T00:02:00.000Z",
    });

    expect(resultB.eventsAnalyzed).toBe(7);
  });

  test("AuditorCursorStore itself keys by (auditorType, scopeKey), not auditorType alone", () => {
    const repoRoot = freshRepoRoot("cursor-store-scope");
    const cursorA = {
      lastInspectedTimestamp: "2026-08-25T00:00:00.000Z",
      lastInspectedEventIndex: 41,
    };
    AuditorCursorStore.saveCursor(repoRoot, "skill", cursorA, "/capsules/a");

    const loadedForB = AuditorCursorStore.loadCursor(repoRoot, "skill", "/capsules/b");
    expect(loadedForB.lastInspectedEventIndex).toBe(-1);

    const loadedForA = AuditorCursorStore.loadCursor(repoRoot, "skill", "/capsules/a");
    expect(loadedForA.lastInspectedEventIndex).toBe(41);
  });
});

describe("Mind liveness is measured from the pulse clock, never the observer's own cursor (mechanism a)", () => {
  test("watchdog fires when the Mind is stale even while the auditor cursor keeps advancing", () => {
    const repoRoot = freshRepoRoot("watchdog-fires");
    const capsuleRoot = join(repoRoot, ".olt", "capsules", "mind-gen-1");
    mkdirSync(capsuleRoot, { recursive: true });
    mkdirSync(join(repoRoot, "olt", "agents"), { recursive: true });
    writeFileSync(join(repoRoot, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");

    const pulseAt = "2026-08-24T20:00:00.000Z";
    writeLastPulse(capsuleRoot, {
      at: pulseAt,
      pulse_id: "pulse-9",
      outcome: "active",
      next_wake_at: null,
    });
    writeCapsuleState(capsuleRoot, {
      agents: [
        {
          id: "mind-live-grant",
          role: "mind",
          status: "active",
          parent_agent_id: null,
          parent_task_id: null,
          host: "codex",
          granted_at: "2026-08-24T20:00:00.000Z",
        },
      ],
    });

    const threshold = 120;
    const tick1 = "2026-08-25T00:05:00.000Z";
    const first = MindAuditorEngine.auditMindPulse(repoRoot, {
      stagnationThresholdSeconds: threshold,
      now: tick1,
      capsuleRunRoot: capsuleRoot,
    });
    expect(first.stagnant).toBe(true);

    const tick2 = "2026-08-25T00:05:30.000Z";
    const second = MindAuditorEngine.auditMindPulse(repoRoot, {
      stagnationThresholdSeconds: threshold,
      now: tick2,
      capsuleRunRoot: capsuleRoot,
    });

    expect(second.stagnant).toBe(true);
    expect(second.idleDurationSeconds).toBeGreaterThan(threshold);
    expect(second.defectCreated).toBe(false);
  });

  test("an unexpired active pulse beats a stale last-pulse snapshot and retains its registered actor", () => {
    const repoRoot = freshRepoRoot("active-pulse-liveness");
    const capsuleRoot = join(repoRoot, ".olt", "capsules", "mind-gen-2");
    const now = "2026-08-25T04:42:24.000Z";
    mkdirSync(capsuleRoot, { recursive: true });
    writeLastPulse(capsuleRoot, {
      at: "2026-08-25T04:29:30.952Z",
      pulse_id: "pulse-7",
      outcome: "active",
      next_wake_at: "2026-08-25T04:32:30.952Z",
    });
    writeCapsuleState(capsuleRoot, {
      pulse: {
        open: {
          actor: "mind_limo_gen_2",
          pulse_id: "pulse-7",
          opened_at: "2026-08-25T04:29:30.952Z",
          deadline_at: "2026-08-25T04:49:30.952Z",
        },
      },
    });

    const result = MindAuditorEngine.auditMindPulse(repoRoot, {
      now,
      stagnationThresholdSeconds: 120,
      capsuleRunRoot: capsuleRoot,
    });

    expect(result.stagnant).toBe(false);
    expect(result.defectCreated).toBe(false);
    expect(result.telemetry.agentId).toBe("mind_limo_gen_2");
  });

  test("does not invent mind-1 or append a stagnation defect when no native Mind is present", () => {
    const repoRoot = freshRepoRoot("absent-native-mind");
    mkdirSync(join(repoRoot, "olt", "agents"), { recursive: true });
    writeFileSync(join(repoRoot, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");

    const first = MindAuditorEngine.auditMindPulse(repoRoot, {
      now: "2026-08-25T05:00:00.000Z",
      stagnationThresholdSeconds: 120,
    });
    const second = MindAuditorEngine.auditMindPulse(repoRoot, {
      now: "2026-08-25T05:03:00.000Z",
      stagnationThresholdSeconds: 120,
    });

    expect(first.defectCreated).toBe(false);
    expect(second.defectCreated).toBe(false);
    expect(first.injectionPrompt).toBeUndefined();
    expect(first.remediation).toBe("deploy_mind");
    expect(first.telemetry.agentId).toBe("unknown");
  });

  test("treats an active Harness-only Codex grant as recovery work, not native Mind liveness", () => {
    const repoRoot = freshRepoRoot("harness-only-codex-grant");
    const capsuleRoot = join(repoRoot, ".olt", "capsules", "mind-gen-3");
    mkdirSync(join(repoRoot, "olt", "agents"), { recursive: true });
    writeFileSync(join(repoRoot, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");
    writeCapsuleState(capsuleRoot, {
      agents: [
        {
          id: "mind_skills_gen_1",
          role: "mind",
          status: "active",
          parent_agent_id: null,
          parent_task_id: null,
          host: "codex",
          granted_at: "2026-08-25T04:00:00.000Z",
        },
      ],
    });

    const result = MindAuditorEngine.auditMindPulse(repoRoot, {
      now: "2026-08-25T05:00:00.000Z",
      stagnationThresholdSeconds: 120,
      capsuleRunRoot: capsuleRoot,
    });

    expect(result.stagnant).toBe(false);
    expect(result.defectCreated).toBe(false);
    expect(result.injectionPrompt).toBeUndefined();
    expect(result.remediation).toBe("reconcile_native_mind");
    expect(result.telemetry.agentId).toBe("mind_skills_gen_1");
  });
});

