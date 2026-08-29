import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { mindPulseOpenCommand } from "../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { skillAuditLiveCommand } from "../../../olt/scripts/src/cli/commands/skill-audit-live.ts";
import type { JsonValue } from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
} from "../../../olt/scripts/src/mind/auditing/cognitive/index.ts";
import { readLastPulse, writeLastPulse } from "../../../olt/scripts/src/mind/lifecycle/index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
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

    // At HEAD the "skill" cursor is keyed by auditorType alone: capsule A ratcheting its mark to
    // index 4 bleeds into capsule B's independent, unrelated event log and truncates its scan.
    // Capsule identity must be part of the cursor key so each capsule starts its own scan fresh.
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

    const pulseAt = "2026-08-24T20:00:00.000Z"; // Mind's real last pulse
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
    const tick1 = "2026-08-25T00:05:00.000Z"; // 4h05m after pulseAt
    const first = MindAuditorEngine.auditMindPulse(repoRoot, {
      stagnationThresholdSeconds: threshold,
      now: tick1,
      capsuleRunRoot: capsuleRoot,
    });
    expect(first.stagnant).toBe(true);

    // Tick 2 runs only 30s after tick 1: well inside the threshold measured against the
    // AUDITOR's own last run, but the Mind still has not pulsed since pulseAt. A cursor that
    // contaminates the liveness clock reports healthy here purely because the auditor itself ran
    // recently -- the pulse clock alone must still fire. This is the defect: idle time tracking
    // the gap between audit ticks instead of Mind activity.
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

describe("mind:pulse-open durably persists a non-null pulse_id (mechanism b)", () => {
  function setupMindCapsule(name: string): { repo: string; run: string } {
    const repo = freshRepoRoot(`pulse-persist-${name}`);
    const charterDir = join(repo, "olt", "agents");
    mkdirSync(charterDir, { recursive: true });
    const charterPath = join(charterDir, "mind.yaml");
    const charterContent =
      'name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test"\n  goals:\n    - id: "G1"\n      statement: "Ensure stability"\n  non_goals:\n    - "Out of scope"\n  repo_roots:\n    - "src/"\n';
    writeFileSync(charterPath, charterContent, "utf-8");
    const charterBytes = readFileSync(charterPath);
    const charterSha = createHash("sha256").update(charterBytes).digest("hex");

    const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

    transact(
      run,
      "mind-init",
      "mind-initialized",
      { generation: 1, charter_source_path: "olt/agents/mind.yaml", pinned_sha256: charterSha },
      (working) => {
        working.mind = {
          generation: 1,
          opened_at: new Date().toISOString(),
          charter: {
            source_path: "olt/agents/mind.yaml",
            pinned_sha256: charterSha,
            goals: ["G1"],
            repo_roots: ["src/"],
            evidence_class: "harness_observed",
          },
          actor: "mind-1",
        };
        working.budget = {
          pulses_per_day: 96,
          wall_clock_ms_per_day: 21_600_000,
          pulse_deadline_ms: 1_200_000,
          day_key: "2026-08-24",
          pulses_today: 0,
          wall_clock_ms_today: 0,
        };
        working.pulse = { counter: 0, open: null, last: null };
      },
    );

    agentRegisterCommand({ run, agent: "mind-1", role: "mind", host: "test-host" });

    return { repo, run };
  }

  test("pulse_id in last_pulse.json is non-null immediately after opening a pulse", () => {
    const { run } = setupMindCapsule("basic");

    expect(readLastPulse(run)).toBeNull();

    const result = mindPulseOpenCommand({
      run,
      actor: "mind-1",
      host: "test-host",
      driver: "test-driver",
      now: "2026-08-24T12:00:00.000Z",
    });
    expect(result.pulse_id).toBe("pulse-1");

    const persisted = readLastPulse(run);
    expect(persisted).not.toBeNull();
    expect(persisted?.pulse_id).not.toBeNull();
    expect(persisted?.pulse_id).toBe("pulse-1");
    expect(persisted?.at).toBe("2026-08-24T12:00:00.000Z");
  });
});

describe("skill:audit:live's documented default invocation actually scans (mechanisms d + e)", () => {
  function buildViolatingCapsule(repoRoot: string): void {
    const capsuleRoot = join(repoRoot, ".olt", "capsules", "violation-capsule");

    const readEvents = Array.from({ length: 6 }, (_, i) =>
      simpleEvent(i, "command-executed", "impl-reader", {
        tool: "view_file",
        arguments: { TargetFile: `some/file-${i}.ts` },
      }),
    );
    const validatorWriteEvent = simpleEvent(6, "command-executed", "validator-1", {
      tool: "write_to_file",
      arguments: { TargetFile: "forbidden/edit.ts" },
    });
    writeCapsuleEvents(capsuleRoot, [...readEvents, validatorWriteEvent]);

    writeCapsuleState(capsuleRoot, {
      tasks: {
        "task-a": {
          write_scope: ["fileA.ts"],
          attempts: [
            { started_at: "2026-08-25T00:00:00.000Z", completed_at: "2026-08-25T00:05:00.000Z" },
          ],
        },
        "task-b": {
          write_scope: ["fileB.ts"],
          attempts: [
            { started_at: "2026-08-25T00:06:00.000Z", completed_at: "2026-08-25T00:10:00.000Z" },
          ],
        },
        "task-c": {
          write_scope: ["fileC.ts"],
          attempts: [
            { started_at: "2026-08-25T00:11:00.000Z", completed_at: "2026-08-25T00:15:00.000Z" },
          ],
        },
      },
    });
  }

  test("emits a genuine violation of each detected class and the default (no --run) invocation reports it", async () => {
    const repoRoot = freshRepoRoot("default-invocation");
    buildViolatingCapsule(repoRoot);

    // Exactly the documented happy path from cli-capabilities.md: no --run.
    const result = await skillAuditLiveCommand({ repo: repoRoot, "log-defects": false });

    expect(asBoolean(result.compliant)).toBe(false);
    expect(asNumber(result.incidents_count)).toBeGreaterThanOrEqual(3);
    expect(asNumber(result.events_analyzed)).toBeGreaterThan(0);
  });

  test("each of the three detected classes is genuinely present, not just a nonzero count", () => {
    const repoRoot = freshRepoRoot("default-invocation-categories");
    buildViolatingCapsule(repoRoot);

    const result = SkillAuditorEngine.auditSkillCompliance(repoRoot, { logDefects: false });

    const categories = new Set(result.incidents.map((inc) => inc.category));
    expect(categories.has("TOKEN_BURNING")).toBe(true);
    expect(categories.has("FALSE_SERIALIZATION")).toBe(true);
    expect(categories.has("ROLE_BOUNDARY_DEVIATION")).toBe(true);
  });
});
