import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  getSourceRevalidationGate,
  mapDiscoveryCategoryToSourceId,
  mapSourceIdToDiscoveryCategory,
  resolveCommandRecord,
  validateQuiescentSources,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
} from "../../../olt/scripts/src/mind/memory/sources/scanner.ts";
import { MIND_DISCOVERY_SOURCES } from "../../../olt/scripts/src/mind/memory/sources/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

function createTempWorkspace(prefix: string): string {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(tmp, ".olt"), { recursive: true });
  return tmp;
}

describe("Sources Scanner Module", () => {
  describe("getSourceRevalidationGate", () => {
    it("returns standard revalidation gate when no targetPath is provided", () => {
      const gate = getSourceRevalidationGate("unused-code");
      expect(gate).toBe("bun harness.ts health --check unused-code,dead-code");
    });

    it("appends test runner command when targetPath ends with .test.ts", () => {
      const gate = getSourceRevalidationGate("failing-gates", "tests/unit/example.test.ts");
      expect(gate).toBe("bun test tests/unit/example.test.ts && bun harness.ts evidence:get");
    });

    it("returns plain gate for non-test targetPath", () => {
      const gate = getSourceRevalidationGate("intent-drift", "src/core/model.ts");
      expect(gate).toBe("bun harness.ts health --check intent-drift");
    });

    it("throws HarnessError for unknown discovery source", () => {
      expect(() => getSourceRevalidationGate("non-existent-source")).toThrow(HarnessError);
    });
  });

  describe("mapDiscoveryCategoryToSourceId", () => {
    it("maps all discovery categories accurately and handles casing / whitespace", () => {
      expect(mapDiscoveryCategoryToSourceId("CODE_QUALITY")).toBe("unused-code");
      expect(mapDiscoveryCategoryToSourceId("  code_quality  ")).toBe("unused-code");
      expect(mapDiscoveryCategoryToSourceId("TEST_COVERAGE")).toBe("failing-gates");
      expect(mapDiscoveryCategoryToSourceId("DORMANT_CRITERIA")).toBe("charter-backlog");
      expect(mapDiscoveryCategoryToSourceId("COGNITIVE_GAP")).toBe("intent-drift");
      expect(mapDiscoveryCategoryToSourceId("FEEDBACK_INTAKE")).toBe("open-findings");
      expect(mapDiscoveryCategoryToSourceId("DEFECT_REMEDIATION")).toBe("capsule-integrity");
      expect(mapDiscoveryCategoryToSourceId("ARCHITECTURAL_HEALTH")).toBe("intent-drift");
      expect(mapDiscoveryCategoryToSourceId("CONTINUOUS_HARDENING")).toBe("unsealed-capsules");
      expect(mapDiscoveryCategoryToSourceId("UNKNOWN_CATEGORY")).toBe("intent-drift");
    });
  });

  describe("mapSourceIdToDiscoveryCategory", () => {
    it("maps known source IDs and aliases to categories", () => {
      expect(mapSourceIdToDiscoveryCategory("unused-code")).toBe("CODE_QUALITY");
      expect(mapSourceIdToDiscoveryCategory("dead-code")).toBe("CODE_QUALITY");
      expect(mapSourceIdToDiscoveryCategory("failing-gates")).toBe("TEST_COVERAGE");
      expect(mapSourceIdToDiscoveryCategory("failing_gates")).toBe("TEST_COVERAGE");
      expect(mapSourceIdToDiscoveryCategory("charter-backlog")).toBe("DORMANT_CRITERIA");
      expect(mapSourceIdToDiscoveryCategory("unsealed-capsules")).toBe("CONTINUOUS_HARDENING");
    });

    it("returns default ARCHITECTURAL_HEALTH for unknown or empty source IDs", () => {
      expect(mapSourceIdToDiscoveryCategory("unknown-source")).toBe("ARCHITECTURAL_HEALTH");
      expect(mapSourceIdToDiscoveryCategory("")).toBe("ARCHITECTURAL_HEALTH");
    });
  });

  describe("resolveCommandRecord", () => {
    it("returns not found for empty, whitespace, or invalid command IDs", () => {
      expect(resolveCommandRecord("").found).toBe(false);
      expect(resolveCommandRecord("   ").found).toBe(false);
      expect(resolveCommandRecord(null as unknown as string).found).toBe(false);
    });

    it("resolves command records from commands/<id>/record.json", () => {
      const tmp = createTempWorkspace("cmd-res-1-");
      try {
        const cmdDir = join(tmp, "commands", "cmd-001");
        mkdirSync(cmdDir, { recursive: true });
        const recordData = { id: "cmd-001", exitCode: 0, stdout: "ok" };
        writeFileSync(join(cmdDir, "record.json"), JSON.stringify(recordData));

        const res = resolveCommandRecord("cmd-001", { runRoot: tmp });
        expect(res.found).toBe(true);
        expect(res.commandId).toBe("cmd-001");
        expect(res.runRoot).toBe(tmp);
        expect(res.location).toBe(join(cmdDir, "record.json"));
        expect(res.record).toEqual(recordData);

        writeFileSync(join(cmdDir, "record.json"), "invalid json");
        const resInvalid = resolveCommandRecord("cmd-001", { runRoot: tmp });
        expect(resInvalid.found).toBe(true);
        expect(resInvalid.record).toBeUndefined();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("resolves command records from commands/<id>.json", () => {
      const tmp = createTempWorkspace("cmd-res-2-");
      try {
        const cmdsDir = join(tmp, "commands");
        mkdirSync(cmdsDir, { recursive: true });
        const recordData = { id: "cmd-002", status: "success" };
        writeFileSync(join(cmdsDir, "cmd-002.json"), JSON.stringify(recordData));

        const res = resolveCommandRecord("cmd-002", { runRoot: tmp });
        expect(res.found).toBe(true);
        expect(res.commandId).toBe("cmd-002");
        expect(res.location).toBe(join(cmdsDir, "cmd-002.json"));
        expect(res.record).toEqual(recordData);

        writeFileSync(join(cmdsDir, "cmd-002.json"), "{ broken");
        const resCorrupt = resolveCommandRecord("cmd-002", { runRoot: tmp });
        expect(resCorrupt.found).toBe(true);
        expect(resCorrupt.record).toBeUndefined();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("resolves command directory without JSON file", () => {
      const tmp = createTempWorkspace("cmd-res-3-");
      try {
        const cmdDir = join(tmp, "commands", "cmd-003");
        mkdirSync(cmdDir, { recursive: true });

        const res = resolveCommandRecord("cmd-003", { runRoot: tmp });
        expect(res.found).toBe(true);
        expect(res.commandId).toBe("cmd-003");
        expect(res.location).toBe(cmdDir);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("resolves command from state.json commands map", () => {
      const tmp = createTempWorkspace("cmd-res-4-");
      try {
        const stateData = {
          commands: {
            "cmd-state-1": { command: "bun test", exit_code: 0 },
          },
        };
        writeFileSync(join(tmp, "state.json"), JSON.stringify(stateData));

        const res = resolveCommandRecord("cmd-state-1", { runRoot: tmp });
        expect(res.found).toBe(true);
        expect(res.commandId).toBe("cmd-state-1");
        expect(res.record).toEqual({ command: "bun test", exit_code: 0 });

        writeFileSync(join(tmp, "state.json"), "invalid json");
        const resUnreadable = resolveCommandRecord("cmd-missing", { runRoot: tmp });
        expect(resUnreadable.found).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("searches candidate capsulesDir, repoRoot, and handles unfound commands", () => {
      const tmp = createTempWorkspace("cmd-res-5-");
      try {
        const capDir = join(tmp, "capsule-alpha");
        const cmdDir = join(capDir, "commands", "cmd-alpha");
        mkdirSync(cmdDir, { recursive: true });
        writeFileSync(join(cmdDir, "record.json"), JSON.stringify({ ok: true }));

        const res = resolveCommandRecord("cmd-alpha", { capsulesDir: tmp });
        expect(res.found).toBe(true);
        expect(res.commandId).toBe("cmd-alpha");

        const resWithRepo = resolveCommandRecord("cmd-alpha", { repoRoot: tmp, capsulesDir: tmp });
        expect(resWithRepo.found).toBe(true);

        const notFound = resolveCommandRecord("non-existent-cmd", {
          capsulesDir: tmp,
          repoRoot: tmp,
        });
        expect(notFound.found).toBe(false);
        expect(notFound.commandId).toBe("non-existent-cmd");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("validateQuiescentSources", () => {
    it("validates perfect quiescent state across all 10 sources", () => {
      const observations = MIND_DISCOVERY_SOURCES.map((s) => ({
        source: s.id,
        count: 0,
      }));
      const check = validateQuiescentSources(observations);
      expect(check.ok).toBe(true);
      expect(check.totalSources).toBe(10);
      expect(check.missingSources).toEqual([]);
      expect(check.nonZeroSources).toEqual([]);
      expect(check.invalidSources).toEqual([]);
      expect(check.reason).toBeUndefined();
    });

    it("flags invalid source identifiers", () => {
      const observations = [
        { source: "intent-drift", count: 0 },
        { source: "invalid-source-xyz", count: 0 },
      ];
      const check = validateQuiescentSources(observations);
      expect(check.ok).toBe(false);
      expect(check.invalidSources).toEqual(["invalid-source-xyz"]);
      expect(check.reason).toContain("invalid source IDs: invalid-source-xyz");
    });

    it("flags missing sources when incomplete set is passed", () => {
      const observations = [{ source: "intent-drift", count: 0 }];
      const check = validateQuiescentSources(observations);
      expect(check.ok).toBe(false);
      expect(check.missingSources.length).toBe(9);
      expect(check.reason).toContain("missing 9 of 10 sources:");
    });

    it("flags non-zero discovery counts", () => {
      const observations = MIND_DISCOVERY_SOURCES.map((s) => ({
        source: s.id,
        count: s.id === "unused-code" ? 3 : 0,
      }));
      const check = validateQuiescentSources(observations);
      expect(check.ok).toBe(false);
      expect(check.nonZeroSources).toEqual([{ source: "unused-code", count: 3 }]);
      expect(check.reason).toContain("non-zero counts in sources: unused-code=3");
    });
  });

  describe("Path Resolution Utilities", () => {
    it("resolves canonical and custom observations paths", () => {
      const canonDefault = resolveCanonicalObservationsPath();
      expect(canonDefault).toBe(join(process.cwd(), ".olt", "telemetry.jsonl"));

      const canonCustom = resolveCanonicalObservationsPath("/custom/root");
      expect(canonCustom).toBe(join("/custom/root", ".olt", "telemetry.jsonl"));

      const obsDefault = resolveObservationsPath();
      expect(obsDefault).toBe(join(process.cwd(), ".olt", "telemetry.jsonl"));

      const obsCustom = resolveObservationsPath("/var/log/my-telemetry.jsonl");
      expect(obsCustom).toBe(resolve("/var/log/my-telemetry.jsonl"));
    });
  });
});
