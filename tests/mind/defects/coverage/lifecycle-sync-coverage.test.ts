import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVestigialDefectsFile,
  normalizeFindingToDefect,
  parseDefectsJsonl,
  resolveDefectsJsonlPath,
  serializeDefectsJsonl,
  syncDoctorFindingsToDefects,
  type DoctorFindingInput,
} from "../../../../olt/scripts/src/mind/defects/sync/lifecycle-sync.ts";
import type { DefectEntry } from "../../../../olt/scripts/src/mind/contracts/defect-contracts.ts";

const TEST_DIR = join(process.cwd(), ".tmp-test-lifecycle-sync");
const CUSTOM_DEFECTS_PATH = join(TEST_DIR, ".olt", "defects.jsonl");

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, ".olt"), { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Lifecycle Sync Suite", () => {
  describe("path resolution and vestigial cleanup", () => {
    it("resolves custom and default defects paths", () => {
      expect(resolveDefectsJsonlPath("  custom/path.jsonl  ")).toContain("custom/path.jsonl");
      expect(typeof resolveDefectsJsonlPath()).toBe("string");
    });

    it("migrates vestigial defects file when canonical target does not exist", () => {
      const vestigialDir = join(TEST_DIR, "olt");
      mkdirSync(vestigialDir, { recursive: true });
      const vestigialFile = join(vestigialDir, "defects.jsonl");
      const sample = JSON.stringify({ id: "def-1", type: "ERR_1", status: "open" }) + "\n";
      writeFileSync(vestigialFile, sample, "utf-8");

      cleanupVestigialDefectsFile(CUSTOM_DEFECTS_PATH);
      expect(existsSync(vestigialFile)).toBe(false);
      expect(existsSync(CUSTOM_DEFECTS_PATH)).toBe(true);
      expect(readFileSync(CUSTOM_DEFECTS_PATH, "utf-8")).toBe(sample);
    });
  });

  describe("parseDefectsJsonl & serializeDefectsJsonl", () => {
    it("handles empty, invalid, and partial json lines with defaults", () => {
      expect(parseDefectsJsonl("")).toEqual([]);
      expect(parseDefectsJsonl("   \n invalid json \n ")).toEqual([]);

      const raw = JSON.stringify({ id: "def-test", type: "lint_error", observation: "fail" });
      const parsed = parseDefectsJsonl(raw, { capsuleRoot: "/capsule" });
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.id).toBe("def-test");
      expect(parsed[0]?.status).toBe("open");
      expect(parsed[0]?.severity).toBe("warning");
      expect(parsed[0]?.capsule_root).toBe("/capsule");

      expect(serializeDefectsJsonl([])).toBe("");
      expect(serializeDefectsJsonl(parsed)).toBe(JSON.stringify(parsed[0]) + "\n");
    });
  });

  describe("normalizeFindingToDefect", () => {
    const ts = "2026-09-01T20:00:00.000Z";

    it("maps codes, paths, descriptions, and severities correctly", () => {
      const f1: DoctorFindingInput = {
        error_code: "ERR_SEC",
        file: "src/auth.ts",
        line: 42,
        title: "Security leak",
        severity: "critical",
        remediation: "Patch cipher",
      };
      const d1 = normalizeFindingToDefect(f1, ts);
      expect(d1.type).toBe("ERR_SEC");
      expect(d1.severity).toBe("critical");
      expect(d1.observation).toBe("Security leak");
      expect(d1.remediation).toBe("Patch cipher");
      expect(d1.context?.path).toBe("src/auth.ts");
      expect(d1.context?.line).toBe(42);

      const f2: DoctorFindingInput = {
        rule: "R_LINT",
        description: "Lint warn",
        severity: "error",
      };
      const d2 = normalizeFindingToDefect(f2, ts);
      expect(d2.type).toBe("R_LINT");
      expect(d2.severity).toBe("high");

      const f3: DoctorFindingInput = { severity: "info" };
      const d3 = normalizeFindingToDefect(f3, ts);
      expect(d3.type).toBe("doctor_finding");
      expect(d3.severity).toBe("low");
      expect(d3.id).toContain("doctor-doctor-finding-");
    });
  });

  describe("syncDoctorFindingsToDefects", () => {
    const ts = "2026-09-01T20:00:00.000Z";

    it("creates new defects and updates existing open defects", () => {
      const findings: DoctorFindingInput[] = [
        { code: "E1", message: "Error 1", path: "a.ts" },
        { code: "E2", message: "Repaired", repaired: true },
      ];
      const res1 = syncDoctorFindingsToDefects(findings, {
        customPath: CUSTOM_DEFECTS_PATH,
        timestamp: ts,
      });
      expect(res1.newlyCreated).toBe(1);
      expect(res1.unchanged).toBe(1);
      expect(res1.defects).toHaveLength(1);
      expect(res1.defects[0]?.count).toBe(1);

      const res2 = syncDoctorFindingsToDefects([{ code: "E1", message: "Error 1", path: "a.ts" }], {
        customPath: CUSTOM_DEFECTS_PATH,
        timestamp: ts,
      });
      expect(res2.existingUpdated).toBe(1);
      expect(res2.defects[0]?.count).toBe(2);
    });

    it("reopens closed defects with options / context failure proof", () => {
      const closedDefect: DefectEntry = {
        id: "doctor-e-closed-123456789012",
        type: "E_CLOSED",
        category: "syntax",
        severity: "warning",
        status: "closed",
        observation: "Closed issue",
        remediation: "Fix",
        timestamp: ts,
        first_seen_at: ts,
        last_seen_at: ts,
        count: 1,
        dedup_key: "closed-key-1",
      };
      writeFileSync(CUSTOM_DEFECTS_PATH, JSON.stringify(closedDefect) + "\n", "utf-8");

      const finding: DoctorFindingInput = {
        id: "doctor-e-closed-123456789012",
        code: "E_CLOSED",
        message: "Closed issue",
        failure_proof: {
          commit_sha: "abc1234",
          test_assertion: "Test fail",
          task_id: "t-1",
          timestamp: ts,
        },
      };
      const res = syncDoctorFindingsToDefects([finding], {
        customPath: CUSTOM_DEFECTS_PATH,
        timestamp: ts,
        commitSha: "sha-override",
        runId: "run-custom",
        requireStrictProof: true,
      });
      expect(res.reopened).toBe(1);
      expect(res.defects[0]?.status).toBe("open");
      expect(res.defects[0]?.failure_proof?.commit_sha).toBe("sha-override");
    });

    it("throws HarnessError on strict proof integrity failures", () => {
      const resolved: DefectEntry = {
        id: "doc-strict-1",
        type: "E_STRICT",
        category: "syntax",
        severity: "warning",
        status: "resolved",
        observation: "Resolved issue",
        remediation: "Fix",
        timestamp: ts,
        first_seen_at: ts,
        last_seen_at: ts,
        count: 1,
        dedup_key: "strict-key-1",
      };
      writeFileSync(CUSTOM_DEFECTS_PATH, JSON.stringify(resolved) + "\n", "utf-8");

      expect(() =>
        syncDoctorFindingsToDefects([{ id: "doc-strict-1", code: "E_STRICT" }], {
          customPath: CUSTOM_DEFECTS_PATH,
          timestamp: ts,
          requireStrictProof: true,
        }),
      ).toThrow(HarnessError);

      expect(() =>
        syncDoctorFindingsToDefects([{ id: "doc-strict-1", code: "E_STRICT", message: "" }], {
          customPath: CUSTOM_DEFECTS_PATH,
          timestamp: ts,
          commitSha: "valid-sha",
          failureProof: {
            commit_sha: "valid-sha",
            test_assertion: "",
            task_id: "task-1",
            timestamp: ts,
          },
          requireStrictProof: true,
        }),
      ).toThrow(HarnessError);
    });

    it("respects dryRun without writing to disk", () => {
      const res = syncDoctorFindingsToDefects([{ code: "DRY_1", message: "Dry test" }], {
        customPath: CUSTOM_DEFECTS_PATH,
        dryRun: true,
      });
      expect(res.newlyCreated).toBe(1);
      expect(existsSync(CUSTOM_DEFECTS_PATH)).toBe(false);
    });
  });
});
