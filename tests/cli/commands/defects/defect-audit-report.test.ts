import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defectAuditCommand } from "../../../../olt/scripts/src/cli/commands/defect-audit.ts";
import { defectAuditCommand as defectAuditCommand2 } from "../../../../olt/scripts/src/cli/commands/defect-audit/command.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Defect Audit Command Executions", () => {
  test("defectAuditCommand validates invalid --now timestamp and missing capsules-dir", async () => {
    expect(() =>
      defectAuditCommand({
        now: "invalid-timestamp",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      defectAuditCommand({
        "capsules-dir": "/path/to/definitely/nonexistent/capsules/dir",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      defectAuditCommand2({
        now: "invalid-timestamp",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      defectAuditCommand2({
        "capsules-dir": "/path/to/definitely/nonexistent/capsules/dir",
      }),
    ).toThrow(HarnessError);
  });

  test("defectAuditCommand filters by status, category, severity, and type", async () => {
    const { repo, run } = await setupCompiledRun("defect-audit-filter", roots);
    const defectsFile = join(run, "defects.jsonl");

    const lines = [
      JSON.stringify({
        id: "d-open-1",
        type: "code_defect",
        severity: "critical",
        status: "open",
        observation: "Crash on init",
        remediation: "Add null check",
        context: { category: "core_engine" },
      }),
      JSON.stringify({
        id: "d-resolved-1",
        type: "perf_defect",
        severity: "warning",
        status: "resolved",
        observation: "Slow query",
        remediation: "Add index",
        context: { category: "database" },
        resolution: {
          task_id: "task-1",
          test_assertion: "bun test tests/domain/router.test.ts",
          resolved_at: "2026-08-30T12:00:00.000Z",
        },
      }),
    ].join("\n");
    writeFileSync(defectsFile, lines, "utf-8");

    expect(() =>
      defectAuditCommand({
        run,
        "filter-status": "invalid_status",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      defectAuditCommand2({
        run,
        "filter-status": "invalid_status",
      }),
    ).toThrow(HarnessError);

    const openRes = defectAuditCommand({
      run,
      "filter-status": "open",
    });
    expect(openRes.filtered_defects).toHaveLength(1);
    expect(openRes.filtered_defects[0]?.id).toBe("d-open-1");

    const catRes = defectAuditCommand({
      run,
      "filter-category": "database",
    });
    expect(catRes.filtered_defects).toHaveLength(1);
    expect(catRes.filtered_defects[0]?.id).toBe("d-resolved-1");

    const typeRes = defectAuditCommand2({
      run,
      "filter-type": "code",
    });
    expect(typeRes.filtered_defects).toHaveLength(1);

    const allCatRes = defectAuditCommand({
      run,
      "filter-category": "all",
      "filter-status": "all",
      all: true,
    });
    expect(allCatRes.filtered_defects).toHaveLength(2);

    const openRes2 = defectAuditCommand2({
      run,
      "filter-status": "open",
    });
    expect(openRes2.filtered_defects).toHaveLength(1);
  });

  test("defectAuditCommand performs auto-admit, promote, test-generation, and formatting", async () => {
    const { repo, run } = await setupCompiledRun("defect-audit-auto", roots);
    const defectsFile = join(run, "defects.jsonl");

    const lines = [
      JSON.stringify({
        id: "d-auto-open",
        type: "code_defect",
        severity: "critical",
        status: "open",
        observation: "Missing validation",
        remediation: "Validate inputs",
        context: { category: "security" },
      }),
      JSON.stringify({
        id: "d-auto-res",
        type: "style_defect",
        severity: "warning",
        status: "resolved",
        observation: "Formatting issue",
        remediation: "Format code",
        context: { category: "style" },
        resolution: {
          task_id: "task-1",
          test_assertion: "bun test tests/domain/style.test.ts",
          resolved_at: "2026-08-30T12:00:00.000Z",
        },
      }),
    ].join("\n");
    writeFileSync(defectsFile, lines, "utf-8");

    const completedFile = join(repo, "completed-defects.jsonl");
    const outputTestsFile = join(repo, "generated-regression.test.ts");

    expect(() =>
      defectAuditCommand({
        "auto-admit": true,
      }),
    ).toThrow(HarnessError);

    expect(() =>
      defectAuditCommand2({
        "auto-admit": true,
      }),
    ).toThrow(HarnessError);

    const result = defectAuditCommand({
      run,
      "auto-admit": true,
      "auto-promote": true,
      "completed-file": completedFile,
      "generate-tests": true,
      "output-tests": outputTestsFile,
      now: "2026-08-30T12:00:00.000Z",
    });

    expect(result.auto_admitted_count).toBe(1);
    expect(result.auto_admitted_candidates).toContain("cand-defect-d-auto-open");
    expect(result.promoted_count).toBe(1);
    expect(result.promoted_defects).toContain("d-auto-res");
    expect(result.generated_tests).toBeDefined();
    expect(result.generated_test_suite).toBeDefined();
    expect(existsSync(completedFile)).toBe(true);
    expect(existsSync(outputTestsFile)).toBe(true);
    expect(String(result.markdown)).toContain("### Defect Audit & Observability Report");
    expect(String(result.markdown)).toContain("Auto-Admitted Candidates");
    expect(String(result.markdown)).toContain("Promoted to COMPLETED_DEFECTS");

    const { repo: repo2, run: run2 } = await setupCompiledRun("defect-audit-auto-2", roots);
    writeFileSync(join(run2, "defects.jsonl"), lines, "utf-8");

    const completedFile2 = join(repo2, "completed-defects-2.jsonl");
    const outputTestsFile2 = join(repo2, "generated-regression-2.test.ts");
    const result2 = defectAuditCommand2({
      run: run2,
      "auto-admit": true,
      "auto-promote": true,
      "completed-file": completedFile2,
      "generate-tests": true,
      "output-tests": outputTestsFile2,
      now: "2026-08-30T12:00:00.000Z",
    });
    expect(result2.auto_admitted_count).toBe(1);
    expect(result2.promoted_count).toBe(1);
    expect(result2.generated_tests).toBeDefined();

    const result3 = defectAuditCommand2({
      run: run2,
      promote: "d-auto-res",
      "dry-run": true,
      "generate-tests": true,
      "output-tests": outputTestsFile2,
      "filter-type": "style",
    });
    expect(result3.promoted_count).toBe(1);

    const jsonRes1 = defectAuditCommand({
      run: run2,
    });
    expect(jsonRes1.summary).toBeDefined();
    expect(jsonRes1.filtered_defects).toBeDefined();

    const jsonRes2 = defectAuditCommand2({
      run: run2,
    });
    expect(jsonRes2.summary).toBeDefined();
    expect(jsonRes2.filtered_defects).toBeDefined();

    const repoRes1 = defectAuditCommand({
      run: repo2,
    });
    expect(repoRes1.filtered_defects).toBeDefined();

    const repoRes2 = defectAuditCommand2({
      run: repo2,
    });
    expect(repoRes2.filtered_defects).toBeDefined();
  });
});
