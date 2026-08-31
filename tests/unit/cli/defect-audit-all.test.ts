import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// Updated coverage suite for defect-audit commands
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  calculateApcaLightnessContrast,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  sRgbToLinearY,
} from "../../../olt/scripts/src/cli/commands/defect-audit-types.ts";
import {
  getApcaBadgeInfo as getApcaBadgeInfo2,
  calculateApcaLightnessContrast as calculateApcaLightnessContrast2,
  renderApcaContrastBadge as renderApcaContrastBadge2,
  renderAsciiDefectTable as renderAsciiDefectTable2,
} from "../../../olt/scripts/src/cli/commands/defect-audit/apca.ts";
import {
  discoverDefectFiles,
  parseDefectsFromFile,
} from "../../../olt/scripts/src/cli/commands/defect-audit-scanner.ts";
import {
  discoverDefectFiles as discoverDefectFiles2,
  parseDefectsFromFile as parseDefectsFromFile2,
} from "../../../olt/scripts/src/cli/commands/defect-audit/discovery.ts";
import {
  formatDefectAuditReport,
  padRight,
  renderAsciiDefectTable,
  truncateString,
} from "../../../olt/scripts/src/cli/commands/defect-audit-formatter.ts";
import { formatDefectAuditReport as formatDefectAuditReport2 } from "../../../olt/scripts/src/cli/commands/defect-audit/formatter.ts";
import { defectAuditCommand } from "../../../olt/scripts/src/cli/commands/defect-audit.ts";
import { defectAuditCommand as defectAuditCommand2 } from "../../../olt/scripts/src/cli/commands/defect-audit/command.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Defect Audit APCA & Formatting", () => {
  test("sRgbToLinearY calculates luminance correctly", () => {
    expect(sRgbToLinearY(0, 0, 0)).toBe(0);
    expect(sRgbToLinearY(255, 255, 255)).toBeGreaterThan(0.99);
  });

  test("calculateApcaLightnessContrast handles light on dark, dark on light, and low contrast", () => {
    // White on black
    const c1 = calculateApcaLightnessContrast({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
    expect(c1).toBeGreaterThan(60);

    // Black on white
    const c2 = calculateApcaLightnessContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(c2).toBeGreaterThan(60);

    // Same color (very low contrast < 0.1)
    const c3 = calculateApcaLightnessContrast({ r: 100, g: 100, b: 100 }, { r: 100, g: 100, b: 100 });
    expect(c3).toBe(0);

    // Using defect-audit/apca.ts version as well
    const c4 = calculateApcaLightnessContrast2({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
    expect(c4).toBeGreaterThan(60);
    const c5 = calculateApcaLightnessContrast2({ r: 100, g: 100, b: 100 }, { r: 100, g: 100, b: 100 });
    expect(c5).toBe(0);
  });

  test("getApcaBadgeInfo and renderApcaContrastBadge cover all palettes and fallback", () => {
    const statuses = ["critical", "warning", "open", "admitted", "resolved", "declined", "ignored", "unknown_custom"];
    for (const st of statuses) {
      const info = getApcaBadgeInfo(st);
      expect(info.label).toBe(st.toLowerCase());
      expect(info.badge_text).toContain(st.toUpperCase());
      expect(renderApcaContrastBadge(st)).toBe(info.badge_text);

      const info2 = getApcaBadgeInfo2(st);
      expect(info2.label).toBe(st.toLowerCase());
      expect(renderApcaContrastBadge2(st)).toBe(info2.badge_text);
    }
  });

  test("truncateString and padRight handle length boundaries", () => {
    expect(truncateString("short", 10)).toBe("short");
    expect(truncateString("this is a very long string", 10)).toBe("this is a…");

    expect(padRight("abc", 5)).toBe("abc  ");
    expect(padRight("abcdef", 5)).toBe("abcdef");
  });

  test("renderAsciiDefectTable handles empty and populated tables", () => {
    const empty1 = renderAsciiDefectTable([]);
    expect(empty1).toContain("No recorded defects discovered matching filter criteria");

    const empty2 = renderAsciiDefectTable2([]);
    expect(empty2).toContain("No recorded defects discovered matching filter criteria");

    const populated = renderAsciiDefectTable([
      {
        id: "d-1",
        type: "code_defect",
        severity: "critical",
        timestamp: "2026-08-30T00:00:00.000Z",
        pid: 100,
        ppid: 1,
        agent_id: "agent-1",
        observation: "Observation 1",
        remediation: "Remediation 1",
        context: {},
        status: "open",
        source_capsule: "cap-1",
        source_file: "/path/defects.jsonl",
      },
    ]);
    expect(populated).toContain("d-1");
    expect(populated).toContain("CRITICAL");
    expect(populated).toContain("OPEN");
  });

  test("formatDefectAuditReport renders full breakdown with all options", () => {
    const summary = {
      total_defects: 2,
      open_count: 1,
      admitted_count: 1,
      resolved_count: 0,
      declined_count: 0,
      critical_count: 1,
      warning_count: 1,
      by_category: { core: 2 },
      by_capsule: { cap1: 2 },
      apca_contrast_compliance: {
        compliant_badges: 6,
        total_badges: 6,
        min_lc_observed: 75.0,
        passes_apca: true,
        badge_details: [getApcaBadgeInfo("critical")],
      },
    };

    const defects = [
      {
        id: "d-f1",
        type: "bug",
        severity: "critical",
        timestamp: "2026-08-30T00:00:00.000Z",
        pid: 1,
        ppid: 0,
        agent_id: "a1",
        observation: "obs",
        remediation: "rem",
        context: {},
        status: "admitted" as const,
        source_capsule: "cap1",
        source_file: "f1",
        candidate_id: "cand-f1",
      },
    ];

    const rep1 = formatDefectAuditReport({
      capsulesDir: "/test/capsules",
      runRoot: null,
      defects,
      summary,
      autoAdmittedCount: 1,
      autoAdmittedCandidates: ["cand-f1"],
      promotedCount: 1,
      promotedDefects: ["d-f1"],
      generatedTestsCount: 1,
      isAll: true,
    });

    expect(rep1).toContain("- **Active Run Root**: *none*");
    expect(rep1).toContain("Auto-Admitted Candidates");
    expect(rep1).toContain("Promoted to COMPLETED_DEFECTS");
    expect(rep1).toContain("Regression Tests Generated");

    const rep2 = formatDefectAuditReport2({
      capsulesDir: "/test/capsules",
      runRoot: "/test/run",
      defects,
      summary,
      autoAdmittedCount: 1,
      autoAdmittedCandidates: ["cand-f1"],
      promotedCount: 1,
      promotedDefects: ["d-f1"],
      generatedTestsCount: 1,
      isAll: false,
    });

    expect(rep2).toContain("- **Active Run Root**: `/test/run`");
    expect(rep2).toContain("Auto-Admitted Candidates");
  });
});

describe("Defect Scanner & Discovery", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `defect-audit-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "package.json"), "{}", "utf-8");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("discoverDefectFiles finds root, subdirectory, and explicit files", () => {
    const cap1 = join(testDir, "run-1");
    const cap2 = join(testDir, "run-2");
    const outsideDir = join(tmpdir(), `outside-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cap1, { recursive: true });
    mkdirSync(cap2, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "package.json"), "{}", "utf-8");
    roots.push(outsideDir);

    writeFileSync(join(testDir, "defects.jsonl"), '{"id":"d0","type":"t"}\n');
    writeFileSync(join(cap1, "defects.jsonl"), '{"id":"d1","type":"t"}\n');
    writeFileSync(join(outsideDir, "defects.jsonl"), '{"id":"d-out","type":"t"}\n');

    const discovered = discoverDefectFiles(testDir);
    expect(discovered.some((d) => d.capsuleName === "capsules-root")).toBe(true);
    expect(discovered.some((d) => d.capsuleName === "run-1")).toBe(true);
    expect(discovered.some((d) => d.capsuleName === "run-2")).toBe(false);

    // With explicitRunRoot outside testDir
    const explicit = discoverDefectFiles(testDir, outsideDir);
    expect(explicit.length).toBeGreaterThanOrEqual(3);

    // Using discovery.ts version without and with outsideDir
    const discovered2Only = discoverDefectFiles2(testDir);
    expect(discovered2Only.some((d) => d.capsuleName === "run-1")).toBe(true);

    const discovered2 = discoverDefectFiles2(testDir, outsideDir);
    expect(discovered2.length).toBeGreaterThanOrEqual(3);
  });

  test("discoverDefectFiles finds canonical .olt defects and completed-defects", () => {
    const oltDir = join(testDir, ".olt");
    mkdirSync(oltDir, { recursive: true });
    writeFileSync(join(oltDir, "defects.jsonl"), '{"id":"d-can","type":"t"}\n');
    writeFileSync(join(oltDir, "completed-defects.jsonl"), '{"id":"d-comp","type":"t"}\n');

    const discovered = discoverDefectFiles(testDir);
    expect(discovered.some((d) => d.capsuleName === ".olt")).toBe(true);

    const discovered2 = discoverDefectFiles2(testDir);
    expect(discovered2.some((d) => d.capsuleName === ".olt")).toBe(true);
  });

  test("parseDefectsFromFile handles missing files, invalid JSON, and state.json candidates", () => {
    // Non-existent file
    expect(parseDefectsFromFile({ capsuleName: "c1", filePath: join(testDir, "none.jsonl") }, testDir)).toEqual([]);
    expect(parseDefectsFromFile2({ capsuleName: "c1", filePath: join(testDir, "none.jsonl") }, testDir)).toEqual([]);

    // Directory path causing readFileSync to throw
    expect(parseDefectsFromFile({ capsuleName: "c1", filePath: testDir }, testDir)).toEqual([]);
    expect(parseDefectsFromFile2({ capsuleName: "c1", filePath: testDir }, testDir)).toEqual([]);

    const capsuleDir = join(testDir, "cap-test");
    mkdirSync(capsuleDir, { recursive: true });

    // state.json with diverse candidate statuses
    const stateObj = {
      candidates: [
        { id: "cand-1", witness: "d-resolved", status: "resolved" },
        { id: "cand-2", witness_command_id: "d-declined", status: "rejected" },
        { id: "cand-3", witness: "d-admitted", status: "proposed" },
        "invalid-candidate",
        null,
      ],
    };
    writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(stateObj), "utf-8");

    const defectsFile = join(capsuleDir, "defects.jsonl");
    const lines = [
      "", // blank line
      "not valid json {", // parse error line
      JSON.stringify({
        id: "d-resolved",
        type: "code_defect",
        severity: "critical",
        status: "open", // Will be inferred as resolved from candidate
        resolution: {
          task_id: "task-1",
          test_assertion: "bun test tests/unit/router.test.ts",
          resolved_at: "2026-08-30T12:00:00.000Z",
        },
      }),
      JSON.stringify({
        id: "d-declined",
        type: "security_defect",
        severity: "warning",
        status: "open", // Inferred as declined
        resolution: null,
      }),
      JSON.stringify({
        id: "d-admitted",
        type: "perf_defect",
        severity: "info", // Falls back to warning
        status: "open", // Inferred as admitted
      }),
      JSON.stringify({
        id: "d-ignored",
        type: "arch_defect",
        severity: "warning",
        status: "ignored",
      }),
    ].join("\n");
    writeFileSync(defectsFile, lines, "utf-8");

    const parsed = parseDefectsFromFile({ capsuleName: "cap-test", filePath: defectsFile }, testDir);
    expect(parsed).toHaveLength(4);

    const d1 = parsed.find((d) => d.id === "d-resolved")!;
    expect(d1.status).toBe("resolved");
    expect(d1.candidate_id).toBe("cand-1");
    expect(d1.severity).toBe("critical");
    expect(d1.resolution).toBeDefined();

    const d2 = parsed.find((d) => d.id === "d-declined")!;
    expect(d2.status).toBe("declined");
    expect(d2.candidate_id).toBe("cand-2");

    const d3 = parsed.find((d) => d.id === "d-admitted")!;
    expect(d3.status).toBe("admitted");

    const d4 = parsed.find((d) => d.id === "d-ignored")!;
    expect(d4.status).toBe("ignored");

    // Also run through discovery.ts version
    const parsed2 = parseDefectsFromFile2({ capsuleName: "cap-test", filePath: defectsFile }, testDir);
    expect(parsed2).toHaveLength(4);
  });
});

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
          test_assertion: "bun test tests/unit/router.test.ts",
          resolved_at: "2026-08-30T12:00:00.000Z",
        },
      }),
    ].join("\n");
    writeFileSync(defectsFile, lines, "utf-8");

    // Filter invalid status
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

    // Filter status = open
    const openRes = defectAuditCommand({
      run,
      "filter-status": "open",
    });
    expect(openRes.filtered_defects).toHaveLength(1);
    expect(openRes.filtered_defects[0]?.id).toBe("d-open-1");

    // Filter category
    const catRes = defectAuditCommand({
      run,
      "filter-category": "database",
    });
    expect(catRes.filtered_defects).toHaveLength(1);
    expect(catRes.filtered_defects[0]?.id).toBe("d-resolved-1");

    // Filter type = code
    const typeRes = defectAuditCommand2({
      run,
      "filter-type": "code",
    });
    expect(typeRes.filtered_defects).toHaveLength(1);

    // Filter category = all
    const allCatRes = defectAuditCommand({
      run,
      "filter-category": "all",
      "filter-status": "all",
      all: true,
    });
    expect(allCatRes.filtered_defects).toHaveLength(2);

    // Test defectAuditCommand2 (from defect-audit/command.ts)
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
          test_assertion: "bun test tests/unit/style.test.ts",
          resolved_at: "2026-08-30T12:00:00.000Z",
        },
      }),
    ].join("\n");
    writeFileSync(defectsFile, lines, "utf-8");

    const completedFile = join(repo, "completed-defects.jsonl");
    const outputTestsFile = join(repo, "generated-regression.test.ts");

    // Auto-admit requires --run
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

    // Run auto-admit, auto-promote, generate-tests on defectAuditCommand
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

    // Fresh run for defectAuditCommand2 to exercise its auto-admit transaction and promote loops
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

    // Test defectAuditCommand2 with dry-run and specific promote flag
    const result3 = defectAuditCommand2({
      run: run2,
      promote: "d-auto-res",
      "dry-run": true,
      "generate-tests": true,
      "output-tests": outputTestsFile2,
      "filter-type": "style",
    });
    expect(result3.promoted_count).toBe(1);

    // Test with json flag
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

    // Test with repo directory where .olt/capsules exists
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
