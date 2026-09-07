import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { defectAuditCommand } from "../../../../../../olt/scripts/src/cli/commands/defect-audit.ts";
import { HarnessError } from "../../../../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
beforeEach(() => setupVirtualCliFS());
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

describe("defect-audit comprehensive suite", () => {
  describe("defectAuditCommand execution", () => {
    it("validates invalid timestamp, invalid capsules-dir, and missing run for auto-admit", () => {
      expect(() => defectAuditCommand({ now: "not-a-date" })).toThrow(HarnessError);
      expect(() => defectAuditCommand({ "capsules-dir": "/nonexistent/path/dir" })).toThrow(
        HarnessError,
      );
      expect(() => defectAuditCommand({ "auto-admit": true })).toThrow(HarnessError);
    });

    it("filters by status and category/type and validates filter values", async () => {
      const { run } = await setupCompiledRun("defect-audit-flt", roots);
      const dFile = join(run, "defects.jsonl");
      const dLines = [
        JSON.stringify({
          id: "d-open-1",
          type: "code_defect",
          severity: "critical",
          status: "open",
          observation: "Crash 1",
          remediation: "Fix 1",
          context: { category: "core_engine" },
        }),
        JSON.stringify({
          id: "d-res-1",
          type: "perf_defect",
          severity: "warning",
          status: "resolved",
          observation: "Slow 1",
          remediation: "Fix 2",
          context: { category: "database" },
          resolution: {
            task_id: "t1",
            test_assertion: "bun test tests/sample.test.ts",
            resolved_at: "2026-08-30T12:00:00.000Z",
          },
        }),
      ].join("\n");
      getVirtualCliFS().writeFileSync(dFile, dLines, "utf-8");

      expect(() => defectAuditCommand({ run, "filter-status": "invalid_status" })).toThrow(
        HarnessError,
      );
      expect(defectAuditCommand({ run, "filter-status": "open" }).filtered_defects).toHaveLength(1);
      expect(
        defectAuditCommand({ run, "filter-category": "database" }).filtered_defects,
      ).toHaveLength(1);
      expect(defectAuditCommand({ run, "filter-type": "code" }).filtered_defects).toHaveLength(1);
      expect(
        defectAuditCommand({ run, "filter-category": "all", "filter-status": "all", all: true })
          .filtered_defects,
      ).toHaveLength(2);
    });

    it("performs auto-admit, promotion, regression test generation and dry-run", async () => {
      const { repo, run } = await setupCompiledRun("defect-audit-flow", roots);
      const dLines = [
        JSON.stringify({
          id: "d-open-flow",
          type: "code_defect",
          severity: "critical",
          status: "open",
          observation: "Memory leak",
          remediation: "Free pointer",
          context: { category: "runtime" },
        }),
        JSON.stringify({
          id: "d-res-flow",
          type: "style_defect",
          severity: "warning",
          status: "resolved",
          observation: "Linter error",
          remediation: "Format code",
          context: { category: "style" },
          resolution: {
            task_id: "t2",
            test_assertion: "bun test tests/style.test.ts",
            resolved_at: "2026-08-30T12:00:00.000Z",
          },
        }),
      ].join("\n");
      getVirtualCliFS().writeFileSync(join(run, "defects.jsonl"), dLines, "utf-8");

      const compFile = join(repo, "completed-defects.jsonl");
      const testOutFile = join(repo, "sub-dir/generated-reg.test.ts");

      const res = defectAuditCommand({
        run,
        "auto-admit": true,
        "auto-promote": true,
        "completed-file": compFile,
        "generate-tests": true,
        "output-tests": testOutFile,
        now: "2026-08-30T12:00:00.000Z",
      });

      expect(res.auto_admitted_count).toBe(1);
      expect(res.auto_admitted_candidates).toContain("cand-defect-d-open-flow");
      expect(res.promoted_count).toBe(1);
      expect(res.promoted_defects).toContain("d-res-flow");
      expect(res.generated_tests).toBeDefined();
      expect(res.generated_test_suite).toBeDefined();
      expect(getVirtualCliFS().existsSync(compFile)).toBe(true);
      expect(getVirtualCliFS().existsSync(testOutFile)).toBe(true);

      const dryRes = defectAuditCommand({
        run,
        promote: "d-res-flow",
        "dry-run": true,
        "completed-file": compFile,
      });
      expect(dryRes.promoted_count).toBe(1);
    });

    it("resolves capsules directory and handles duplicate defect resolution overrides", () => {
      const cDir = "/virtual/capsules-dup";
      const vfs = getVirtualCliFS();
      vfs.mkdirSync(join(cDir, ".git"), { recursive: true });
      vfs.mkdirSync(join(cDir, "cap-sub"), { recursive: true });
      roots.push(cDir);
      vfs.writeFileSync(
        join(cDir, "defects.jsonl"),
        JSON.stringify({
          id: "dup-1",
          type: "code",
          severity: "warning",
          status: "open",
          observation: "o",
          remediation: "r",
        }) + "\n",
        "utf-8",
      );
      vfs.writeFileSync(
        join(cDir, "cap-sub", "defects.jsonl"),
        JSON.stringify({
          id: "dup-1",
          type: "code",
          severity: "warning",
          status: "resolved",
          observation: "o",
          remediation: "r",
        }) + "\n",
        "utf-8",
      );

      const res = defectAuditCommand({ "capsules-dir": cDir });
      expect(res.capsules_dir).toBe(cDir);
      expect(res.total_defects).toBe(1);
      expect(res.filtered_defects[0]?.status).toBe("resolved");

      const runWithCapsules = "/virtual/run-with-caps";
      vfs.mkdirSync(join(runWithCapsules, ".git"), { recursive: true });
      vfs.mkdirSync(join(runWithCapsules, ".olt/capsules"), { recursive: true });
      roots.push(runWithCapsules);
      vfs.writeFileSync(join(runWithCapsules, ".olt/capsules", "defects.jsonl"), "", "utf-8");
      const runCapsRes = defectAuditCommand({ run: runWithCapsules });
      expect(runCapsRes.capsules_dir).toBe(join(runWithCapsules, ".olt/capsules"));
    });
  });
});
