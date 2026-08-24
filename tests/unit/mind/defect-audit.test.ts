import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defectAuditCommand,
  calculateApcaLightnessContrast,
  discoverDefectFiles,
  formatDefectAuditReport,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  renderAsciiDefectTable,
  type AuditedDefect,
  type DefectStatus,
  type RGBColor,
} from "../../../olt/scripts/src/cli/commands/defect-audit.ts";
import { executeDefectAudit } from "../../../olt/scripts/src/mind/defect-audit.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempRoots.length = 0;
});

interface TestWorkspace {
  readonly repoRoot: string;
  readonly capsulesDir: string;
  readonly runRoot: string;
}

function setupTestWorkspace(name: string): TestWorkspace {
  const repoRoot = mkdtempSync(join(tmpdir(), `defect-audit-test-${name}-${process.pid}-`));
  tempRoots.push(repoRoot);

  const capsulesDir = join(repoRoot, ".olt", "capsules");
  mkdirSync(capsulesDir, { recursive: true });

  const charterDir = join(repoRoot, "docs");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent =
    "# CHARTER\n\n## identity\nTest Core\n\n## goals\n- G1: Safety\n- G2: Invariants\n\n## repo_roots\n- `src/`\n";
  writeFileSync(charterPath, charterContent, "utf-8");
  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const runRoot = initRun(repoRoot, `run-${name}`, charterBytes, "file", true);

  transact(
    runRoot,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "docs/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/CHARTER.md",
          pinned_sha256: charterSha,
          goals: ["G1", "G2"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
      };
      working.candidates = [];
    },
  );

  return { repoRoot, capsulesDir, runRoot };
}

describe("Defect Audit CLI Command", () => {
  test("audits defects across past and current capsules", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("discovery");

    // Create past capsule with a defect
    const pastCapsule = join(capsulesDir, "mind-gen-1");
    mkdirSync(pastCapsule, { recursive: true });
    const pastDefect = {
      id: "defect-past-101",
      type: "main_thread_direct_execution",
      severity: "critical",
      timestamp: "2026-08-20T10:00:00.000Z",
      pid: 1234,
      ppid: 1200,
      agent_id: "orch-lead",
      observation: "Direct file modification executed on main interactive thread",
      remediation: "Dispatch Tier 3 Implementer via invoke_subagent",
      context: { cwd: pastCapsule, indicators: { ROLE: "main" } },
    };
    writeFileSync(join(pastCapsule, "defects.jsonl"), `${JSON.stringify(pastDefect)}\n`, "utf-8");

    // Create root defects.jsonl
    const rootDefect = {
      id: "defect-root-202",
      type: "role_escalation",
      severity: "warning",
      timestamp: "2026-08-21T12:00:00.000Z",
      pid: 2345,
      ppid: 2300,
      agent_id: "worker-1",
      observation: "Agent executed unauthorized coordination command",
      remediation: "Restrict agent grants to implementer role",
      context: { cwd: capsulesDir },
    };
    writeFileSync(join(capsulesDir, "defects.jsonl"), `${JSON.stringify(rootDefect)}\n`, "utf-8");

    // Create current run defect
    const currentDefect = {
      id: "defect-curr-303",
      type: "unauthorized_mutation",
      severity: "critical",
      timestamp: "2026-08-22T01:00:00.000Z",
      pid: 3456,
      ppid: 3400,
      agent_id: "sub-worker",
      observation: "Touched file outside write lease",
      remediation: "Scope mutate command to packet write scope",
      context: { cwd: runRoot },
    };
    writeFileSync(join(runRoot, "defects.jsonl"), `${JSON.stringify(currentDefect)}\n`, "utf-8");

    const result = defectAuditCommand({
      "capsules-dir": capsulesDir,
      run: runRoot,
    });

    expect(result.total_defects).toBe(3);
    expect(result.summary.open_count).toBe(3);
    expect(result.summary.critical_count).toBe(2);
    expect(result.summary.warning_count).toBe(1);
    expect(result.filtered_defects.length).toBe(3);
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown.includes("Defect Audit & Observability Report")).toBeTrue();
    expect(result.markdown.includes("defect-past-101")).toBeTrue();
    expect(result.markdown.includes("defect-root-202")).toBeTrue();
    expect(result.markdown.includes("defect-curr-303")).toBeTrue();
    expect(result.summary.apca_contrast_compliance.passes_apca).toBeTrue();
  });

  test("filters defects by status", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("filter-status");

    const defects = [
      {
        id: "defect-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        status: "open",
        observation: "Direct edit",
        remediation: "Delegate",
      },
      {
        id: "defect-2",
        type: "role_escalation",
        severity: "warning",
        status: "admitted",
        observation: "Role jump",
        remediation: "Stay in tier",
      },
      {
        id: "defect-3",
        type: "unauthorized_mutation",
        severity: "warning",
        status: "resolved",
        observation: "Scope error",
        remediation: "Fix scope",
      },
    ];

    writeFileSync(
      join(capsulesDir, "defects.jsonl"),
      defects.map((b) => JSON.stringify(b)).join("\n"),
      "utf-8",
    );

    const openResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "open",
    });
    expect(openResult.filtered_defects.length).toBe(1);
    expect(
      openResult.filtered_defects[0] !== undefined ? openResult.filtered_defects[0].id : "",
    ).toBe("defect-1");

    const admittedResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "admitted",
    });
    expect(admittedResult.filtered_defects.length).toBe(1);
    expect(
      admittedResult.filtered_defects[0] !== undefined ? admittedResult.filtered_defects[0].id : "",
    ).toBe("defect-2");

    const resolvedResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "resolved",
    });
    expect(resolvedResult.filtered_defects.length).toBe(1);
    expect(
      resolvedResult.filtered_defects[0] !== undefined ? resolvedResult.filtered_defects[0].id : "",
    ).toBe("defect-3");

    const allResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "all",
    });
    expect(allResult.filtered_defects.length).toBe(3);
  });

  test("filters defects by category / type", () => {
    const { capsulesDir } = setupTestWorkspace("filter-cat");

    const defects = [
      {
        id: "defect-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        observation: "Direct edit",
        remediation: "Delegate",
      },
      {
        id: "defect-2",
        type: "role_escalation",
        severity: "warning",
        observation: "Role jump",
        remediation: "Stay in tier",
      },
    ];

    writeFileSync(
      join(capsulesDir, "defects.jsonl"),
      defects.map((b) => JSON.stringify(b)).join("\n"),
      "utf-8",
    );

    const result = defectAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-category": "main_thread",
    });
    expect(result.filtered_defects.length).toBe(1);
    expect(result.filtered_defects[0] !== undefined ? result.filtered_defects[0].id : "").toBe(
      "defect-1",
    );

    const resultAlias = defectAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-type": "role_escalation",
    });
    expect(resultAlias.filtered_defects.length).toBe(1);
    expect(
      resultAlias.filtered_defects[0] !== undefined ? resultAlias.filtered_defects[0].id : "",
    ).toBe("defect-2");
  });

  test("supports --auto-admit flag to record candidate proposals for open defects", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("auto-admit");

    const openDefect = {
      id: "defect-to-admit",
      type: "main_thread_direct_execution",
      severity: "critical",
      observation: "Uncontained main thread execution",
      remediation: "Dispatch Tier 2 Coordinator",
    };
    writeFileSync(join(capsulesDir, "defects.jsonl"), `${JSON.stringify(openDefect)}\n`, "utf-8");

    const result = defectAuditCommand({
      run: runRoot,
      "capsules-dir": capsulesDir,
      "auto-admit": true,
      actor: "mind-lead",
    });

    expect(result.auto_admitted_count).toBe(1);
    expect(result.auto_admitted_candidates.length).toBe(1);
    expect(
      result.auto_admitted_candidates[0] !== undefined ? result.auto_admitted_candidates[0] : "",
    ).toBe("cand-defect-defect-to-admit");
    expect(result.filtered_defects[0] !== undefined ? result.filtered_defects[0].status : "").toBe(
      "admitted",
    );
    expect(
      result.filtered_defects[0] !== undefined ? result.filtered_defects[0].candidate_id : null,
    ).toBe("cand-defect-defect-to-admit");

    // Verify candidate was transacted into state.json
    const reloaded = loadRun(runRoot, false);
    const candidateList = Array.isArray(reloaded.state.candidates) ? reloaded.state.candidates : [];
    expect(candidateList.length).toBe(1);
    const cand = candidateList[0] as Record<string, unknown>;
    expect(cand.id).toBe("cand-defect-defect-to-admit");
    expect(cand.status).toBe("admitted");
    expect(cand.witness).toBe("defect-to-admit");
  });

  test("throws HarnessError on invalid arguments", () => {
    const { capsulesDir } = setupTestWorkspace("errors");

    // Invalid filter-status
    expect(() =>
      defectAuditCommand({
        "capsules-dir": capsulesDir,
        "filter-status": "invalid_status",
      }),
    ).toThrow(HarnessError);

    // Non-existent capsules-dir
    expect(() =>
      defectAuditCommand({
        "capsules-dir": "/tmp/non-existent-capsules-dir-12345",
      }),
    ).toThrow(HarnessError);

    // --auto-admit without --run
    expect(() =>
      defectAuditCommand({
        "capsules-dir": capsulesDir,
        "auto-admit": true,
      }),
    ).toThrow(HarnessError);

    // Invalid --now
    expect(() =>
      defectAuditCommand({
        "capsules-dir": capsulesDir,
        now: "not-a-timestamp",
      }),
    ).toThrow(HarnessError);

    // Unknown option
    expect(() =>
      defectAuditCommand({
        "capsules-dir": capsulesDir,
        unknown_option: "bad",
      }),
    ).toThrow(HarnessError);
  });

  test("handles empty states and skips malformed JSON lines cleanly", () => {
    const { capsulesDir } = setupTestWorkspace("empty-malformed");

    // Empty capsules directory
    const emptyResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
    });
    expect(emptyResult.total_defects).toBe(0);
    expect(emptyResult.filtered_defects.length).toBe(0);
    expect(emptyResult.markdown.includes("No recorded defects discovered")).toBeTrue();

    // Write file with malformed JSON lines mixed with valid line
    const mixedContent = [
      "not a json line",
      "{ invalid json",
      JSON.stringify({
        id: "defect-valid-1",
        type: "role_escalation",
        severity: "warning",
        observation: "Valid entry",
        remediation: "Check roles",
      }),
      "",
      "   ",
      "{}",
    ].join("\n");

    writeFileSync(join(capsulesDir, "defects.jsonl"), mixedContent, "utf-8");

    const mixedResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
    });
    expect(mixedResult.total_defects).toBe(1);
    expect(
      mixedResult.filtered_defects[0] !== undefined ? mixedResult.filtered_defects[0].id : "",
    ).toBe("defect-valid-1");
  });

  test("calculates APCA Lightness Contrast (Lc) and verifies badge compliance", () => {
    const white: RGBColor = { r: 255, g: 255, b: 255 };
    const black: RGBColor = { r: 0, g: 0, b: 0 };
    const darkRed: RGBColor = { r: 183, g: 28, b: 28 };
    const amber: RGBColor = { r: 255, g: 193, b: 7 };

    // White on Dark Red (Critical badge)
    const criticalLc = calculateApcaLightnessContrast(white, darkRed);
    expect(criticalLc).toBeGreaterThan(75);

    // Black on Amber (Warning badge)
    const warningLc = calculateApcaLightnessContrast(black, amber);
    expect(warningLc).toBeGreaterThan(65);

    // Badge info helper
    const critBadge = getApcaBadgeInfo("critical");
    expect(critBadge.passes_apca).toBeTrue();
    expect(critBadge.lc).toBeGreaterThanOrEqual(60);
    expect(critBadge.badge_text.includes("CRITICAL")).toBeTrue();

    const openBadge = getApcaBadgeInfo("open");
    expect(openBadge.passes_apca).toBeTrue();
    expect(openBadge.badge_text.includes("OPEN")).toBeTrue();

    const rendered = renderApcaContrastBadge("resolved");
    expect(rendered.includes("RESOLVED")).toBeTrue();
    expect(rendered.includes("PASS")).toBeTrue();
  });

  test("renders ASCII table and formats report with line limits", () => {
    const sampleDefects: AuditedDefect[] = [
      {
        id: "defect-table-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        timestamp: "2026-08-22T00:00:00.000Z",
        pid: 100,
        ppid: 99,
        agent_id: "worker-test",
        observation: "Direct execution observed",
        remediation: "Delegate to worker",
        context: {},
        status: "open",
        source_capsule: "mind-gen-1",
        source_file: "mind-gen-1/defects.jsonl",
      },
    ];

    const asciiTable = renderAsciiDefectTable(sampleDefects);
    expect(asciiTable.includes("┌")).toBeTrue();
    expect(asciiTable.includes("┐")).toBeTrue();
    expect(asciiTable.includes("└")).toBeTrue();
    expect(asciiTable.includes("┘")).toBeTrue();
    expect(asciiTable.includes("defect-table-1")).toBeTrue();
    expect(asciiTable.includes("CRITICAL")).toBeTrue();

    const emptyTable = renderAsciiDefectTable([]);
    expect(emptyTable.includes("No recorded defects discovered")).toBeTrue();

    const report = formatDefectAuditReport({
      capsulesDir: "/test/.capsules",
      runRoot: "/test/.capsules/run-1",
      defects: sampleDefects,
      summary: {
        total_defects: 1,
        open_count: 1,
        admitted_count: 0,
        resolved_count: 0,
        declined_count: 0,
        critical_count: 1,
        warning_count: 0,
        by_category: { main_thread_direct_execution: 1 },
        by_capsule: { "mind-gen-1": 1 },
        apca_contrast_compliance: {
          compliant_badges: 6,
          total_badges: 6,
          min_lc_observed: 68.4,
          passes_apca: true,
          badge_details: [],
        },
      },
      autoAdmittedCount: 0,
      autoAdmittedCandidates: [],
    });

    expect(report.includes("Defect Audit & Observability Report")).toBeTrue();
    expect(report.includes("APCA Perceived Contrast Compliance**: PASS")).toBeTrue();
  });

  test("resolves defect status from state.json candidate dispositions (resolved and declined)", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("candidate-dispositions");

    // Add defects
    const defects = [
      {
        id: "defect-cand-resolved",
        type: "main_thread_direct_execution",
        severity: "critical",
        status: "open",
        observation: "Direct execution",
        remediation: "Fix",
      },
      {
        id: "defect-cand-declined",
        type: "role_escalation",
        severity: "warning",
        status: "open",
        observation: "Role jump",
        remediation: "Fix",
      },
    ];

    writeFileSync(
      join(runRoot, "defects.jsonl"),
      defects.map((b) => JSON.stringify(b)).join("\n"),
      "utf-8",
    );

    // Update state.candidates with resolved and declined candidates
    transact(
      runRoot,
      "mind-lead",
      "test-candidates",
      { note: "record test candidates" },
      (working) => {
        working.candidates = [
          {
            id: "cand-1",
            kind: "defect",
            statement: "Fix direct execution",
            witness: "defect-cand-resolved",
            status: "closed",
          },
          {
            id: "cand-2",
            kind: "defect",
            statement: "Fix role jump",
            witness: "defect-cand-declined",
            status: "declined",
          },
        ];
      },
    );

    const result = defectAuditCommand({
      run: runRoot,
      "capsules-dir": capsulesDir,
    });

    expect(result.summary.resolved_count).toBe(1);
    expect(result.summary.declined_count).toBe(1);
    expect(result.summary.open_count).toBe(0);

    const resolvedDefect = result.filtered_defects.find((b) => b.id === "defect-cand-resolved");
    expect(resolvedDefect !== undefined ? resolvedDefect.status : "").toBe("resolved");
    expect(resolvedDefect !== undefined ? resolvedDefect.candidate_id : "").toBe("cand-1");

    const declinedDefect = result.filtered_defects.find((b) => b.id === "defect-cand-declined");
    expect(declinedDefect !== undefined ? declinedDefect.status : "").toBe("declined");
    expect(declinedDefect !== undefined ? declinedDefect.candidate_id : "").toBe("cand-2");
  });

  test("deduplicates defects across files and updates status from open to non-open", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("dedup");

    const defectOpen = {
      id: "defect-dup-1",
      type: "unauthorized_mutation",
      severity: "critical",
      status: "open",
      observation: "First observation",
      remediation: "Fix",
    };
    writeFileSync(join(capsulesDir, "defects.jsonl"), `${JSON.stringify(defectOpen)}\n`, "utf-8");

    const defectResolved = {
      id: "defect-dup-1",
      type: "unauthorized_mutation",
      severity: "critical",
      status: "resolved",
      observation: "First observation",
      remediation: "Fix",
    };
    writeFileSync(join(runRoot, "defects.jsonl"), `${JSON.stringify(defectResolved)}\n`, "utf-8");

    const result = defectAuditCommand({
      run: runRoot,
      "capsules-dir": capsulesDir,
    });

    expect(result.total_defects).toBe(1);
    expect(result.filtered_defects.length).toBe(1);
    expect(result.filtered_defects[0] !== undefined ? result.filtered_defects[0].status : "").toBe(
      "resolved",
    );
  });

  test("enforces line limits without --all and expands with --all", () => {
    const { capsulesDir } = setupTestWorkspace("line-limit");

    const manyDefects = [];
    for (let i = 0; i < 20; i = i + 1) {
      manyDefects.push({
        id: `defect-many-${i}`,
        type: "main_thread_direct_execution",
        severity: "critical",
        status: "open",
        observation: `Defect observation number ${i} with detailed explanation text`,
        remediation: `Remediation number ${i}`,
      });
    }

    writeFileSync(
      join(capsulesDir, "defects.jsonl"),
      manyDefects.map((b) => JSON.stringify(b)).join("\n"),
      "utf-8",
    );

    const standardResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
    });
    const standardLines = standardResult.markdown.split("\n").length;
    expect(standardLines).toBeLessThanOrEqual(35);
    expect(standardResult.markdown.includes("truncated")).toBeTrue();

    const allResult = defectAuditCommand({
      "capsules-dir": capsulesDir,
      all: true,
    });
    const allLines = allResult.markdown.split("\n").length;
    expect(allLines).toBeGreaterThan(35);
    expect(allResult.markdown.includes("truncated")).toBeFalse();
  });

  test("calculates APCA contrast for edge case color pairs and polarity inversions", () => {
    const black: RGBColor = { r: 0, g: 0, b: 0 };
    const white: RGBColor = { r: 255, g: 255, b: 255 };

    // Dark text on light background (positive polarity)
    const darkOnLight = calculateApcaLightnessContrast(black, white);
    expect(darkOnLight).toBeGreaterThan(100);

    // Light text on dark background (negative polarity)
    const lightOnDark = calculateApcaLightnessContrast(white, black);
    expect(lightOnDark).toBeGreaterThan(100);

    // Very close colors (contrast near 0)
    const gray1: RGBColor = { r: 120, g: 120, b: 120 };
    const gray2: RGBColor = { r: 121, g: 121, b: 121 };
    const lowContrast = calculateApcaLightnessContrast(gray1, gray2);
    expect(lowContrast).toBe(0);
  });

  test("executeDefectAudit delegates to defectAuditCommand", () => {
    const { repoRoot, capsulesDir } = setupTestWorkspace("execute-delegation");
    const result = executeDefectAudit({
      run: repoRoot,
      "capsules-dir": capsulesDir,
    });
    expect(result.summary.open_count).toBe(0);
    expect(result.markdown).toBeDefined();
  });
});
