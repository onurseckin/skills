import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  calculateApcaLightnessContrast,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  sRgbToLinearY,
} from "../../../../olt/scripts/src/cli/commands/defect-audit-types.ts";
import {
  getApcaBadgeInfo as getApcaBadgeInfo2,
  calculateApcaLightnessContrast as calculateApcaLightnessContrast2,
  renderApcaContrastBadge as renderApcaContrastBadge2,
  renderAsciiDefectTable as renderAsciiDefectTable2,
} from "../../../../olt/scripts/src/cli/commands/defect-audit/apca.ts";
import {
  discoverDefectFiles,
  parseDefectsFromFile,
} from "../../../../olt/scripts/src/cli/commands/defect-audit-scanner.ts";
import {
  discoverDefectFiles as discoverDefectFiles2,
  parseDefectsFromFile as parseDefectsFromFile2,
} from "../../../../olt/scripts/src/cli/commands/defect-audit/discovery.ts";
import {
  formatDefectAuditReport,
  padRight,
  renderAsciiDefectTable,
  truncateString,
} from "../../../../olt/scripts/src/cli/commands/defect-audit-formatter.ts";
import { formatDefectAuditReport as formatDefectAuditReport2 } from "../../../../olt/scripts/src/cli/commands/defect-audit/formatter.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Defect Audit APCA & Formatting", () => {
  test("sRgbToLinearY calculates luminance correctly", () => {
    expect(sRgbToLinearY(0, 0, 0)).toBe(0);
    expect(sRgbToLinearY(255, 255, 255)).toBeGreaterThan(0.99);
  });

  test("calculateApcaLightnessContrast handles light on dark, dark on light, and low contrast", () => {
    const c1 = calculateApcaLightnessContrast({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
    expect(c1).toBeGreaterThan(60);

    const c2 = calculateApcaLightnessContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(c2).toBeGreaterThan(60);

    const c3 = calculateApcaLightnessContrast(
      { r: 100, g: 100, b: 100 },
      { r: 100, g: 100, b: 100 },
    );
    expect(c3).toBe(0);

    const c4 = calculateApcaLightnessContrast2({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
    expect(c4).toBeGreaterThan(60);
    const c5 = calculateApcaLightnessContrast2(
      { r: 100, g: 100, b: 100 },
      { r: 100, g: 100, b: 100 },
    );
    expect(c5).toBe(0);
  });

  test("getApcaBadgeInfo and renderApcaContrastBadge cover all palettes and fallback", () => {
    const statuses = [
      "critical",
      "warning",
      "open",
      "admitted",
      "resolved",
      "declined",
      "ignored",
      "unknown_custom",
    ];
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
    testDir = join(
      tmpdir(),
      `defect-audit-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
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
    const outsideDir = join(
      tmpdir(),
      `outside-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
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

    const explicit = discoverDefectFiles(testDir, outsideDir);
    expect(explicit.length).toBeGreaterThanOrEqual(3);

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
    expect(
      parseDefectsFromFile({ capsuleName: "c1", filePath: join(testDir, "none.jsonl") }, testDir),
    ).toEqual([]);
    expect(
      parseDefectsFromFile2({ capsuleName: "c1", filePath: join(testDir, "none.jsonl") }, testDir),
    ).toEqual([]);

    expect(parseDefectsFromFile({ capsuleName: "c1", filePath: testDir }, testDir)).toEqual([]);
    expect(parseDefectsFromFile2({ capsuleName: "c1", filePath: testDir }, testDir)).toEqual([]);

    const capsuleDir = join(testDir, "cap-test");
    mkdirSync(capsuleDir, { recursive: true });

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
      "",
      "not valid json {",
      JSON.stringify({
        id: "d-resolved",
        type: "code_defect",
        severity: "critical",
        status: "open",
        resolution: {
          task_id: "task-1",
          test_assertion: "bun test tests/domain/router.test.ts",
          resolved_at: "2026-08-30T12:00:00.000Z",
        },
      }),
      JSON.stringify({
        id: "d-declined",
        type: "security_defect",
        severity: "warning",
        status: "open",
        resolution: null,
      }),
      JSON.stringify({
        id: "d-admitted",
        type: "perf_defect",
        severity: "info",
        status: "open",
      }),
      JSON.stringify({
        id: "d-ignored",
        type: "arch_defect",
        severity: "warning",
        status: "ignored",
      }),
    ].join("\n");
    writeFileSync(defectsFile, lines, "utf-8");

    const parsed = parseDefectsFromFile(
      { capsuleName: "cap-test", filePath: defectsFile },
      testDir,
    );
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

    const parsed2 = parseDefectsFromFile2(
      { capsuleName: "cap-test", filePath: defectsFile },
      testDir,
    );
    expect(parsed2).toHaveLength(4);
  });
});
