import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";
import { writeLastPulse } from "../../../../olt/scripts/src/mind/lifecycle/index.ts";

const MIN_MANIFEST_YAML = `role: mind\ntier: 0\nspawns:\n  - orchestrator\nmay:\n  - Coordinate strategic goals\nmust_not:\n  - Implement code directly\n`;

describe("Liveness and Scope Compliance Suite (in-memory virtual)", () => {
  beforeEach(() => {
    setupVirtualMindFS();
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  function freshRepoRoot(prefix: string): string {
    const repo = scratchRoot("liveness-scope", prefix);
    fs.mkdirSync(join(repo, ".olt", "capsules"), { recursive: true });
    fs.mkdirSync(join(repo, "olt", "agents"), { recursive: true });
    fs.writeFileSync(join(repo, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML);
    return repo;
  }

  function writeCapsuleEvents(
    capsuleRoot: string,
    lines: readonly Record<string, unknown>[],
  ): void {
    fs.mkdirSync(capsuleRoot, { recursive: true });
    fs.writeFileSync(
      join(capsuleRoot, "events.jsonl"),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
  }

  function writeCapsuleState(capsuleRoot: string, state: Record<string, unknown>): void {
    fs.mkdirSync(capsuleRoot, { recursive: true });
    fs.writeFileSync(join(capsuleRoot, "state.json"), JSON.stringify(state));
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

      const resA = SkillAuditorEngine.auditSkillCompliance(repoRoot, {
        capsuleRunRoot: capsuleA,
        logDefects: false,
        now: "2026-08-25T00:01:00.000Z",
      });
      expect(resA.eventsAnalyzed).toBe(5);

      const resB = SkillAuditorEngine.auditSkillCompliance(repoRoot, {
        capsuleRunRoot: capsuleB,
        logDefects: false,
        now: "2026-08-25T00:02:00.000Z",
      });
      expect(resB.eventsAnalyzed).toBe(7);
    });

    test("AuditorCursorStore itself keys by (auditorType, scopeKey), not auditorType alone", () => {
      const repoRoot = freshRepoRoot("cursor-store-scope");
      const cursorA = {
        lastInspectedTimestamp: "2026-08-25T00:00:00.000Z",
        lastInspectedEventIndex: 41,
      };
      AuditorCursorStore.saveCursor(repoRoot, "skill", cursorA, "/capsules/a");
      expect(
        AuditorCursorStore.loadCursor(repoRoot, "skill", "/capsules/b").lastInspectedEventIndex,
      ).toBe(-1);
      expect(
        AuditorCursorStore.loadCursor(repoRoot, "skill", "/capsules/a").lastInspectedEventIndex,
      ).toBe(41);
    });
  });

  describe("Mind liveness is measured from the pulse clock, never the observer's own cursor (mechanism a)", () => {
    test("watchdog fires when the Mind is stale even while the auditor cursor keeps advancing", () => {
      const repoRoot = freshRepoRoot("watchdog-fires");
      const capsuleRoot = join(repoRoot, ".olt", "capsules", "mind-gen-1");
      fs.mkdirSync(capsuleRoot, { recursive: true });
      writeLastPulse(capsuleRoot, {
        at: "2026-08-24T20:00:00.000Z",
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
      const first = MindAuditorEngine.auditMindPulse(repoRoot, {
        stagnationThresholdSeconds: threshold,
        now: "2026-08-25T00:05:00.000Z",
        capsuleRunRoot: capsuleRoot,
      });
      expect(first.stagnant).toBe(true);

      const second = MindAuditorEngine.auditMindPulse(repoRoot, {
        stagnationThresholdSeconds: threshold,
        now: "2026-08-25T00:05:30.000Z",
        capsuleRunRoot: capsuleRoot,
      });
      expect(second.stagnant).toBe(true);
      expect(second.idleDurationSeconds).toBeGreaterThan(threshold);
      expect(second.defectCreated).toBe(false);
    });

    test("an unexpired active pulse beats a stale last-pulse snapshot and retains its registered actor", () => {
      const repoRoot = freshRepoRoot("active-pulse-liveness");
      const capsuleRoot = join(repoRoot, ".olt", "capsules", "mind-gen-2");
      fs.mkdirSync(capsuleRoot, { recursive: true });
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
        now: "2026-08-25T04:42:24.000Z",
        stagnationThresholdSeconds: 120,
        capsuleRunRoot: capsuleRoot,
      });
      expect(result.stagnant).toBe(false);
      expect(result.defectCreated).toBe(false);
      expect(result.telemetry.agentId).toBe("mind_limo_gen_2");
    });

    test("does not invent mind-1 or append a stagnation defect when no native Mind is present", () => {
      const repoRoot = freshRepoRoot("absent-native-mind");
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
      fs.mkdirSync(capsuleRoot, { recursive: true });
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
});
