import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { rotateMindGeneration } from "../../../olt/scripts/src/mind/archival/rotate/rotator.ts";

const validCharterYaml = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Mind rotator test consciousness"
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

describe("rotateMindGeneration", () => {
  let tempDir: string;
  let repoRoot: string;
  let capsulesParent: string;
  let charterFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rotator-test-"));
    repoRoot = tempDir;
    capsulesParent = join(repoRoot, ".olt", "capsules");
    mkdirSync(join(repoRoot, "olt", "agents"), { recursive: true });
    charterFilePath = join(repoRoot, "olt", "agents", "mind.yaml");
    writeFileSync(charterFilePath, validCharterYaml);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupMindCapsule(runId: string, mindState?: Record<string, unknown>): string {
    const promptBytes = new TextEncoder().encode(validCharterYaml);
    const runRoot = initRun(repoRoot, runId, promptBytes, "file", true);
    transact(runRoot, "owner", "mind-init", {}, (state) => {
      state.mind = (mindState ?? {
        generation: 1,
        status: "active",
        charter: {
          source_path: "olt/agents/mind.yaml",
          repo_roots: [".", 123], // non-string entry filtered
        },
      }) as unknown as typeof state.mind;
      state.pulse = {
        counter: 1,
        open: { pulse_id: "pulse-open-123" },
        last: { pulse_id: "pulse-last-123" },
      };
    });
    return runRoot;
  }

  describe("argument validation and early guards", () => {
    it("throws INVALID_ARGUMENT when sourceRunRoot is empty", () => {
      expect(() => rotateMindGeneration({ sourceRunRoot: "" })).toThrow(HarnessError);
    });

    it("throws INVALID_ARGUMENT when sourceRunRoot does not exist or is a file", () => {
      const nonExistent = join(tempDir, "non-existent");
      expect(() => rotateMindGeneration({ sourceRunRoot: nonExistent })).toThrow(HarnessError);

      const filePath = join(tempDir, "file.txt");
      writeFileSync(filePath, "hello");
      expect(() => rotateMindGeneration({ sourceRunRoot: filePath })).toThrow(HarnessError);
    });

    it("throws INVALID_ARGUMENT when sourceRunRoot is a symlink", () => {
      const realDir = join(tempDir, "real-dir");
      mkdirSync(realDir, { recursive: true });
      const spy = spyOn(fs, "lstatSync").mockReturnValue({
        isDirectory: () => true,
        isSymbolicLink: () => true,
      } as unknown as fs.Stats);
      try {
        expect(() => rotateMindGeneration({ sourceRunRoot: realDir })).toThrow(
          /cannot be a symlink/,
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("throws INVALID_STATE when state.mind is missing", () => {
      const promptBytes = new TextEncoder().encode(validCharterYaml);
      const runRoot = initRun(repoRoot, "no-mind-run", promptBytes, "file", true);
      expect(() => rotateMindGeneration({ sourceRunRoot: runRoot })).toThrow(/missing state.mind/);
    });

    it("throws INVALID_STATE when source capsule is already rotated", () => {
      const runRoot = setupMindCapsule("already-rotated-run", {
        generation: 1,
        status: "rotated",
      });
      expect(() => rotateMindGeneration({ sourceRunRoot: runRoot })).toThrow(/already sealed/);
    });

    it("throws INVALID_ARGUMENT on invalid now timestamp", () => {
      const runRoot = setupMindCapsule("invalid-now-run");
      expect(() =>
        rotateMindGeneration({
          sourceRunRoot: runRoot,
          now: "invalid-date-string-xyz",
        }),
      ).toThrow(/invalid --now timestamp/);
    });
  });

  describe("charter resolution and integrity checks", () => {
    it("throws INTEGRITY when live charter file cannot be read", () => {
      const runRoot = setupMindCapsule("missing-charter-run");
      rmSync(charterFilePath, { force: true });
      expect(() => rotateMindGeneration({ sourceRunRoot: runRoot })).toThrow(
        /cannot read live charter/,
      );
    });

    it("throws INTEGRITY when live charter file is empty", () => {
      const runRoot = setupMindCapsule("empty-charter-run");
      writeFileSync(charterFilePath, "");
      expect(() => rotateMindGeneration({ sourceRunRoot: runRoot })).toThrow(
        /live charter at .* is empty/,
      );
    });

    it("throws INTEGRITY when live charter is not parseable", () => {
      const runRoot = setupMindCapsule("unparseable-charter-run");
      writeFileSync(charterFilePath, "invalid: [yaml: broken: 123");
      expect(() => rotateMindGeneration({ sourceRunRoot: runRoot })).toThrow(
        /not a parseable mind manifest/,
      );
    });
  });

  describe("target run root and ID computation", () => {
    it("throws INVALID_STATE if computed targetRunRoot already exists", () => {
      const runRoot = setupMindCapsule("existing-target-run");
      const targetPath = join(capsulesParent, "mind-gen-2");
      mkdirSync(targetPath, { recursive: true });
      expect(() => rotateMindGeneration({ sourceRunRoot: runRoot })).toThrow(
        /capsule already exists/,
      );
    });

    it("supports nextRunRoot and nextRunId options", () => {
      const runRoot = setupMindCapsule("next-root-run");
      const customAbsoluteTarget = join(tempDir, "custom-target-abs");

      const res = rotateMindGeneration({
        sourceRunRoot: runRoot,
        nextRunRoot: customAbsoluteTarget,
        nextRunId: "custom-id",
        now: new Date("2026-09-01T12:00:00.000Z"),
      });

      expect(res.targetRunId).toBe("custom-id");
      expect(res.targetGeneration).toBe(2);
      expect(res.targetRunRoot).toContain("custom-id");
    });

    it("supports nextRunId with slashes to resolve custom path", () => {
      const runRoot = setupMindCapsule("slash-id-run");
      const targetWithSlash = join("subfolder", "slash-target");

      const res = rotateMindGeneration({
        sourceRunRoot: runRoot,
        nextRunId: targetWithSlash,
        now: 1788264000000, // number timestamp
      });

      expect(res.targetRunId).toBe("slash-target");
      expect(res.targetRunRoot).toContain("slash-target");
    });
  });

  describe("happy path and sealed source validation", () => {
    it("rotates successfully with default nextRunId generation naming", () => {
      const runRoot = setupMindCapsule("happy-source-run");
      const res = rotateMindGeneration({
        sourceRunRoot: runRoot,
        actor: "governor-agent",
        now: "2026-09-01T16:00:00.000Z",
      });

      expect(res.sourceRunId).toBe("happy-source-run");
      expect(res.targetRunId).toBe("mind-gen-2");
      expect(res.sourceGeneration).toBe(1);
      expect(res.targetGeneration).toBe(2);
      expect(res.rotatedAt).toBe("2026-09-01T16:00:00.000Z");

      // Verify source capsule sealed with status 'rotated' and last_pulse.json written
      const sealedSource = loadRun(runRoot, false);
      const sealedMind = (sealedSource.state as Record<string, unknown>).mind as Record<
        string,
        unknown
      >;
      expect(sealedMind.status).toBe("rotated");
      expect(sealedMind.rotated_at).toBe("2026-09-01T16:00:00.000Z");

      const sealedPulse = (sealedSource.state as Record<string, unknown>).pulse as Record<
        string,
        unknown
      >;
      expect(sealedPulse.open).toBeNull();
    });

    it("handles lastPulseId resolution when open pulse is absent but last pulse is present", () => {
      const promptBytes = new TextEncoder().encode(validCharterYaml);
      const runRoot = initRun(repoRoot, "last-pulse-fallback", promptBytes, "file", true);
      transact(runRoot, "owner", "mind-init", {}, (state) => {
        state.mind = {
          generation: 2,
          status: "active",
        } as unknown as typeof state.mind;
        state.pulse = {
          counter: 5,
          open: null,
          last: { pulse_id: "pulse-from-last" },
        };
      });

      const res = rotateMindGeneration({
        sourceRunRoot: runRoot,
        capsulesDir: capsulesParent,
      });

      expect(res.targetGeneration).toBe(3);
      expect(res.sourceGeneration).toBe(2);
    });
  });
});
