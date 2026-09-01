import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVestigialDefectsFile,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  syncDoctorFindingsToDefects,
  type DoctorFindingInput,
} from "../../../olt/scripts/src/mind/defects/sync/index.ts";
import type {
  DefectEntry,
  EmpiricalFailureProof,
} from "../../../olt/scripts/src/mind/contracts/defect-contracts.ts";

export const lifecycleSyncCoreSuiteName = "Defect Lifecycle Sync & Key Generation Core Engine";

const vfs = new Map<string, { isDir: boolean; content?: string }>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  const getStats = (p: fs.PathLike): fs.Stats => {
    const s = String(p).replace(/\/+$/, "");
    const n = vfs.get(s);
    const isDir = n ? n.isDir : Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
    if (!n && !isDir) {
      const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    }
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
      mode: isDir ? 0o755 : 0o644,
      size: n?.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  };
  const spiesList = [
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = String(p).replace(/\/+$/, "");
      return vfs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
    }),
    spyOn(fs, "lstatSync").mockImplementation(getStats),
    spyOn(fs, "statSync").mockImplementation(getStats),
    spyOn(fs, "fstatSync").mockImplementation(
      () =>
        ({
          dev: 1,
          ino: 1,
          nlink: 1,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false,
          mode: 0o755,
          size: 0,
          mtimeMs: Date.now(),
        }) as fs.Stats,
    ),
    spyOn(fs, "openSync").mockImplementation(() => 101),
    spyOn(fs, "closeSync").mockImplementation(() => {}),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      vfs.set(String(p), { isDir: true });
      return undefined;
    }),
    spyOn(fs, "readFileSync").mockImplementation((p, options) => {
      const s = String(p);
      const n = vfs.get(s);
      if (!n || n.content === undefined) {
        const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
      const enc =
        typeof options === "string"
          ? options
          : (options as { encoding?: string } | undefined)?.encoding;
      return enc === "utf-8" || enc === "utf8"
        ? n.content
        : (Buffer.from(n.content) as unknown as string);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
      vfs.set(String(p), {
        content: typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array),
        isDir: false,
      });
    }),
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      const n = vfs.get(String(from));
      if (n) {
        vfs.set(String(to), { content: n.content, isDir: n.isDir });
        vfs.delete(String(from));
      }
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "chmodSync").mockImplementation(() => {}),
    spyOn(fs, "fsyncSync").mockImplementation(() => {}),
  ];
  spies.push(...spiesList);
}

describe(lifecycleSyncCoreSuiteName, () => {
  let tempDir: string;
  let defectsPath: string;

  beforeEach(() => {
    setupVirtualFs();
    tempDir = "/virtual/defect-lifecycle-sync-core";
    defectsPath = join(tempDir, ".olt", "defects.jsonl");
    vfs.set(tempDir, { isDir: true });
    vfs.set(dirname(defectsPath), { isDir: true });
  });

  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
    vfs.clear();
  });

  describe("Deterministic Key Generation & In-Place Deduplication", () => {
    it("generates deterministic SHA-256 defect IDs with zero Date.now() fallbacks", () => {
      const finding: DoctorFindingInput = {
        code: "UNGUARDED_MUTATION",
        message: "File written without mutation lock",
        file: "olt/scripts/src/mind/defects/sync/test.ts",
        line: 42,
        severity: "error",
      };
      const res1 = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:00:00.000Z",
      });
      const res2 = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:05:00.000Z",
      });

      expect(res1.newlyCreated).toBe(1);
      expect(res1.defects[0]?.id?.startsWith("doctor-unguarded-mutation-")).toBeTrue();
      expect(res2.newlyCreated).toBe(0);
      expect(res2.existingUpdated).toBe(1);
      expect(res2.defects[0]?.id).toBe(res1.defects[0]?.id);
      expect(res2.defects[0]?.count).toBe(2);
      expect(res2.defects[0]?.last_seen_at).toBe("2026-08-29T10:05:00.000Z");
    });

    it("skips repaired doctor findings without creating defect rows", () => {
      const findings: readonly DoctorFindingInput[] = [
        { code: "TORN_EVENT_TAIL", message: "Repaired torn tail", repaired: true },
        { code: "STALE_PROJECTION", message: "Projection recomputed", repaired: true },
        { code: "UNRESOLVED_IMPORT", message: "Cannot find module", repaired: false },
      ];
      const result = syncDoctorFindingsToDefects(findings, {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:00:00.000Z",
      });
      expect(result.totalFindings).toBe(3);
      expect(result.newlyCreated).toBe(1);
      expect(result.unchanged).toBe(2);
      expect(result.defects[0]?.type).toBe("UNRESOLVED_IMPORT");
    });
  });

  describe("Autonomous Recurrence & Regression Re-opening with Empirical Proofs", () => {
    it("automatically re-opens previously completed defects with empirical failure proof", () => {
      const finding: DoctorFindingInput = {
        code: "REGEX_FALSE_POSITIVE",
        message: "AST regex matched comment text incorrectly",
        severity: "error",
      };
      const initResult = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T08:00:00.000Z",
      });
      const defectId = initResult.defects[0]?.id;

      const existing = parseDefectsJsonl(fs.readFileSync(defectsPath, "utf-8"));
      const completed = existing.map((d) =>
        d.id === defectId
          ? {
              ...d,
              status: "completed" as const,
              resolution_proof: { task_id: "task-100", resolved_at: "2026-08-29T08:30:00.000Z" },
            }
          : d,
      );
      fs.writeFileSync(defectsPath, serializeDefectsJsonl(completed), "utf-8");

      const failureProof: EmpiricalFailureProof = {
        commit_sha: "abc1234def5678",
        test_assertion: "bun test tests/doctor/rules/ast-purity-engine.test.ts",
        task_id: "doctor-run-99",
        timestamp: "2026-08-29T09:00:00.000Z",
      };
      const syncResult = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T09:00:00.000Z",
        failureProof,
        autoReopen: true,
      });

      const reopened = syncResult.defects.find((d) => d.id === defectId);
      expect(syncResult.reopened).toBe(1);
      expect(reopened?.status).toBe("open");
      expect(reopened?.count).toBe(2);
      expect(reopened?.reopened_at).toBe("2026-08-29T09:00:00.000Z");
      expect(reopened?.failure_proof?.commit_sha).toBe("abc1234def5678");
      expect(reopened?.failure_proof?.test_assertion).toContain("ast-purity-engine");
    });

    it("throws HarnessError on defect re-opening when strict proof is enabled and proof is missing", () => {
      const defect: DefectEntry = {
        id: "doctor-completed-defect",
        type: "INVARIANT_BREACH",
        category: "boundary_violation",
        severity: "critical",
        status: "completed",
        timestamp: "2026-08-29T01:00:00.000Z",
      };
      fs.writeFileSync(defectsPath, serializeDefectsJsonl([defect]), "utf-8");
      const finding: DoctorFindingInput = {
        id: "doctor-completed-defect",
        code: "INVARIANT_BREACH",
        message: "Invariant re-occurred",
      };
      expect(() =>
        syncDoctorFindingsToDefects([finding], {
          customPath: defectsPath,
          requireStrictProof: true,
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Vestigial Loose Defect Cleanup", () => {
    it("migrates and removes loose olt/defects.jsonl", () => {
      const vestigialPath = join(tempDir, "olt", "defects.jsonl");
      vfs.set(dirname(vestigialPath), { isDir: true });
      const sampleDefect: DefectEntry = {
        id: "legacy-defect-1",
        type: "LEGACY_BUG",
        status: "open",
        timestamp: "2026-08-29T00:00:00.000Z",
      };
      vfs.set(vestigialPath, { content: serializeDefectsJsonl([sampleDefect]), isDir: false });

      cleanupVestigialDefectsFile(defectsPath);
      expect(fs.existsSync(vestigialPath)).toBeFalse();
      const canonicalEntries = parseDefectsJsonl(fs.readFileSync(defectsPath, "utf-8"));
      expect(canonicalEntries.some((d) => d.id === "legacy-defect-1")).toBeTrue();
    });
  });
});
