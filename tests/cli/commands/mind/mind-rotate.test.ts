import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatMindRotateBrief,
  mindRotateCommand,
} from "../../../../olt/scripts/src/cli/commands/mind-rotate.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";

const validCharterYaml = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Mind rotator coverage test consciousness"
  goals:
    - id: "G1"
      statement: "Goal 1"
  cognitive_pillars:
    - "Pillar 1"
  non_goals:
    - "Make-work"
  repo_roots:
    - "."
`;

describe("mind:rotate CLI Command Coverage Suite", () => {
  let tempDir: string;
  let repoRoot: string;
  let capsulesParent: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mind-rotate-cli-test-"));
    repoRoot = tempDir;
    capsulesParent = join(repoRoot, ".olt", "capsules");
    mkdirSync(join(repoRoot, "olt", "agents"), { recursive: true });
    writeFileSync(join(repoRoot, "olt", "agents", "mind.yaml"), validCharterYaml);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupCapsule(runId: string): string {
    const promptBytes = new TextEncoder().encode(validCharterYaml);
    const runRoot = initRun(repoRoot, runId, promptBytes, "file", true);
    transact(runRoot, "owner", "mind-init", {}, (state) => {
      state.mind = {
        generation: 1,
        status: "active",
        charter: {
          source_path: "olt/agents/mind.yaml",
          repo_roots: ["."],
        },
      } as unknown as typeof state.mind;
      state.pulse = {
        counter: 4,
        open: null,
        last_pulse_at: new Date().toISOString(),
      } as unknown as typeof state.pulse;
    });
    return runRoot;
  }

  test("formatMindRotateBrief renders brief with and without archival and previousEventHead", () => {
    const withArchival = formatMindRotateBrief({
      sourceRunId: "run-gen-1",
      targetRunId: "run-gen-2",
      sourceGeneration: 1,
      targetGeneration: 2,
      targetRunRoot: "/virtual/runs/run-gen-2",
      charterSha256: "sha-abc-123",
      pulseCounter: 5,
      carriedCandidatesCount: 3,
      openCandidatesCount: 2,
      declinedCandidatesCount: 1,
      archivedCount: 4,
      carriedGrantsCount: 2,
      previousEventHead: "evt-head-999",
      rotatedAt: "2026-09-01T12:00:00.000Z",
    });

    expect(withArchival).toContain("### Mind Rotated: Generation 1 → 2");
    expect(withArchival).toContain(
      "- **Source Capsule**: `run-gen-1` (sealed with status `rotated`)",
    );
    expect(withArchival).toContain(
      "- **Successor Capsule**: `run-gen-2` at `/virtual/runs/run-gen-2`",
    );
    expect(withArchival).toContain("- **Charter SHA-256**: `sha-abc-123`");
    expect(withArchival).toContain("- **Pulse Counter**: 5 (preserved)");
    expect(withArchival).toContain(
      "- **Candidates Carried Forward**: 3 (2 open/admitted, 1 declined)",
    );
    expect(withArchival).toContain("- **Generational State Archival**: 4 items pruned");
    expect(withArchival).toContain("- **Agent Grants Carried Forward**: 2");
    expect(withArchival).toContain("- **Previous Event Head**: `evt-head-999`");
    expect(withArchival).toContain("- **Status**: Successor ready for wake");

    const withoutArchival = formatMindRotateBrief({
      sourceRunId: "run-gen-1",
      targetRunId: "run-gen-2",
      sourceGeneration: 1,
      targetGeneration: 2,
      targetRunRoot: "/virtual/runs/run-gen-2",
      charterSha256: "sha-abc-123",
      pulseCounter: 0,
      carriedCandidatesCount: 0,
      openCandidatesCount: 0,
      declinedCandidatesCount: 0,
      archivedCount: 0,
      carriedGrantsCount: 0,
      previousEventHead: null,
      rotatedAt: "2026-09-01T12:00:00.000Z",
    });

    expect(withoutArchival).not.toContain("Generational State Archival");
    expect(withoutArchival).toContain("- **Previous Event Head**: `none`");
  });

  test("mindRotateCommand requires run flag and rejects missing argument", () => {
    expect(() => mindRotateCommand({})).toThrow(HarnessError);
  });

  test("mindRotateCommand executes rotation with default actor and flags", () => {
    const runRoot = setupCapsule("test-rotate-run-1");

    const result = mindRotateCommand({
      run: runRoot,
    });

    expect(result.source_run_root).toBe(runRoot);
    expect(result.source_generation).toBe(1);
    expect(result.target_generation).toBe(2);
    expect(result.pulse_counter).toBe(4);
    expect(result.charter_sha256).toBeDefined();
    expect(result.charter_source_path).toBeDefined();
    expect(typeof result.rotated_at).toBe("string");
    expect(result.markdown).toContain("### Mind Rotated: Generation 1 → 2");
  });

  test("mindRotateCommand handles next-run, actor, now, and capsules-dir flags", () => {
    const runRoot = setupCapsule("test-rotate-run-2");
    const customNextRun = "custom-gen2-capsule";
    const customNow = "2026-09-01T15:30:00.000Z";

    const result = mindRotateCommand({
      run: runRoot,
      "next-run": customNextRun,
      actor: "lead-coordinator",
      now: customNow,
      "capsules-dir": capsulesParent,
    });

    expect(result.source_run_id).toBe("test-rotate-run-2");
    expect(result.target_run_id).toBe(customNextRun);
    expect(result.source_generation).toBe(1);
    expect(result.target_generation).toBe(2);
    expect(result.target_run_root).toContain(customNextRun);
    expect(result.rotated_at).toBe(customNow);
    expect(result.markdown).toContain(customNextRun);
  });
});
