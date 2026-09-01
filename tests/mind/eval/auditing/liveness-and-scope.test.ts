import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as durableWriteModule from "../../../../olt/scripts/src/core/durable-write.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";
import { writeLastPulse } from "../../../../olt/scripts/src/mind/lifecycle/index.ts";

const MIN_MANIFEST_YAML = `role: mind\ntier: 0\nspawns:\n  - orchestrator\nmay:\n  - Coordinate strategic goals\nmust_not:\n  - Implement code directly\n`;
const origExists = fs.existsSync;
const origRead = fs.readFileSync;

describe("Liveness and Scope Compliance Suite (in-memory virtual)", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p) => {
        const s = String(p);
        if (mockFiles.has(s) || mockDirs.has(s)) return true;
        try {
          return origExists(p);
        } catch {
          return false;
        }
      }),
      spyOn(fs, "readdirSync").mockImplementation((p, options) => {
        const pStr = String(p);
        const dirs: string[] = [];
        const files: string[] = [];
        for (const d of mockDirs) {
          if (d.startsWith(pStr) && d !== pStr) {
            const top = d.slice(pStr.length).replace(/^\/+/, "").split("/")[0];
            if (top && !dirs.includes(top)) dirs.push(top);
          }
        }
        for (const f of mockFiles.keys()) {
          if (f.startsWith(pStr)) {
            const top = f.slice(pStr.length).replace(/^\/+/, "").split("/")[0];
            if (top && !dirs.includes(top) && !files.includes(top)) files.push(top);
          }
        }
        const withTypes =
          typeof options === "object" &&
          options !== null &&
          Boolean((options as { withFileTypes?: boolean }).withFileTypes);
        if (withTypes) {
          return [
            ...dirs.map((name) => ({ name, isDirectory: () => true, isFile: () => false })),
            ...files.map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
          ] as unknown as fs.Dirent[];
        }
        return [...dirs, ...files] as unknown as fs.Dirent[];
      }),
      spyOn(fs, "readFileSync").mockImplementation((p) => {
        const val = mockFiles.get(String(p));
        return val !== undefined ? val : origRead(p as string, "utf-8");
      }),
      spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
        mockFiles.set(
          String(p),
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      }),
      spyOn(fs, "mkdirSync").mockImplementation((p) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }),
      spyOn(durableWriteModule, "durableAppendBytes").mockImplementation((fp, bytes) => {
        mockFiles.set(fp, (mockFiles.get(fp) ?? "") + new TextDecoder().decode(bytes));
      }),
      spyOn(durableWriteModule, "atomicWriteBytes").mockImplementation((tp, bytes) => {
        mockFiles.set(tp, new TextDecoder().decode(bytes));
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  function freshRepoRoot(prefix: string): string {
    const repo = `${process.cwd()}/.olt/virtual-auditor-liveness-${prefix}`;
    mockDirs.add(repo);
    mockDirs.add(join(repo, ".olt"));
    mockDirs.add(join(repo, ".olt", "capsules"));
    mockDirs.add(join(repo, "olt", "agents"));
    mockFiles.set(join(repo, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML);
    return repo;
  }

  function writeCapsuleEvents(
    capsuleRoot: string,
    lines: readonly Record<string, unknown>[],
  ): void {
    mockDirs.add(capsuleRoot);
    mockFiles.set(
      join(capsuleRoot, "events.jsonl"),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
  }

  function writeCapsuleState(capsuleRoot: string, state: Record<string, unknown>): void {
    mockDirs.add(capsuleRoot);
    mockFiles.set(join(capsuleRoot, "state.json"), JSON.stringify(state));
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
      mockDirs.add(capsuleRoot);
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
      mockDirs.add(capsuleRoot);
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
      mockDirs.add(capsuleRoot);
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
