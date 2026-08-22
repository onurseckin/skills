import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blunderAuditCommand,
  calculateApcaLightnessContrast,
  discoverBlunderFiles,
  formatBlunderAuditReport,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  renderAsciiBlunderTable,
  type AuditedBlunder,
  type BlunderStatus,
  type RGBColor,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/blunder-audit.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";

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
  const repoRoot = mkdtempSync(join(tmpdir(), `blunder-audit-test-${name}-${process.pid}-`));
  tempRoots.push(repoRoot);

  const capsulesDir = join(repoRoot, ".capsules");
  mkdirSync(capsulesDir, { recursive: true });

  const charterDir = join(repoRoot, "docs", "mind");
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
      charter_source_path: "docs/mind/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/mind/CHARTER.md",
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

describe("Blunder Audit CLI Command", () => {
  test("audits blunders across past and current capsules", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("discovery");

    // Create past capsule with a blunder
    const pastCapsule = join(capsulesDir, "mind-gen-1");
    mkdirSync(pastCapsule, { recursive: true });
    const pastBlunder = {
      id: "blunder-past-101",
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
    writeFileSync(join(pastCapsule, "blunders.jsonl"), `${JSON.stringify(pastBlunder)}\n`, "utf-8");

    // Create root blunders.jsonl
    const rootBlunder = {
      id: "blunder-root-202",
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
    writeFileSync(join(capsulesDir, "blunders.jsonl"), `${JSON.stringify(rootBlunder)}\n`, "utf-8");

    // Create current run blunder
    const currentBlunder = {
      id: "blunder-curr-303",
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
    writeFileSync(join(runRoot, "blunders.jsonl"), `${JSON.stringify(currentBlunder)}\n`, "utf-8");

    const result = blunderAuditCommand({
      "capsules-dir": capsulesDir,
      run: runRoot,
    });

    expect(result.total_blunders).toBe(3);
    expect(result.summary.open_count).toBe(3);
    expect(result.summary.critical_count).toBe(2);
    expect(result.summary.warning_count).toBe(1);
    expect(result.filtered_blunders.length).toBe(3);
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown.includes("Blunder Audit & Observability Report")).toBeTrue();
    expect(result.markdown.includes("blunder-past-101")).toBeTrue();
    expect(result.markdown.includes("blunder-root-202")).toBeTrue();
    expect(result.markdown.includes("blunder-curr-303")).toBeTrue();
    expect(result.summary.apca_contrast_compliance.passes_apca).toBeTrue();
  });

  test("filters blunders by status", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("filter-status");

    const blunders = [
      {
        id: "blunder-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        status: "open",
        observation: "Direct edit",
        remediation: "Delegate",
      },
      {
        id: "blunder-2",
        type: "role_escalation",
        severity: "warning",
        status: "admitted",
        observation: "Role jump",
        remediation: "Stay in tier",
      },
      {
        id: "blunder-3",
        type: "unauthorized_mutation",
        severity: "warning",
        status: "resolved",
        observation: "Scope error",
        remediation: "Fix scope",
      },
    ];

    writeFileSync(
      join(capsulesDir, "blunders.jsonl"),
      blunders.map((b) => JSON.stringify(b)).join("\n"),
      "utf-8",
    );

    const openResult = blunderAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "open",
    });
    expect(openResult.filtered_blunders.length).toBe(1);
    expect(
      openResult.filtered_blunders[0] !== undefined ? openResult.filtered_blunders[0].id : "",
    ).toBe("blunder-1");

    const admittedResult = blunderAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "admitted",
    });
    expect(admittedResult.filtered_blunders.length).toBe(1);
    expect(
      admittedResult.filtered_blunders[0] !== undefined
        ? admittedResult.filtered_blunders[0].id
        : "",
    ).toBe("blunder-2");

    const resolvedResult = blunderAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "resolved",
    });
    expect(resolvedResult.filtered_blunders.length).toBe(1);
    expect(
      resolvedResult.filtered_blunders[0] !== undefined
        ? resolvedResult.filtered_blunders[0].id
        : "",
    ).toBe("blunder-3");

    const allResult = blunderAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-status": "all",
    });
    expect(allResult.filtered_blunders.length).toBe(3);
  });

  test("filters blunders by category / type", () => {
    const { capsulesDir } = setupTestWorkspace("filter-cat");

    const blunders = [
      {
        id: "blunder-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        observation: "Direct edit",
        remediation: "Delegate",
      },
      {
        id: "blunder-2",
        type: "role_escalation",
        severity: "warning",
        observation: "Role jump",
        remediation: "Stay in tier",
      },
    ];

    writeFileSync(
      join(capsulesDir, "blunders.jsonl"),
      blunders.map((b) => JSON.stringify(b)).join("\n"),
      "utf-8",
    );

    const result = blunderAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-category": "main_thread",
    });
    expect(result.filtered_blunders.length).toBe(1);
    expect(result.filtered_blunders[0] !== undefined ? result.filtered_blunders[0].id : "").toBe(
      "blunder-1",
    );

    const resultAlias = blunderAuditCommand({
      "capsules-dir": capsulesDir,
      "filter-type": "role_escalation",
    });
    expect(resultAlias.filtered_blunders.length).toBe(1);
    expect(
      resultAlias.filtered_blunders[0] !== undefined ? resultAlias.filtered_blunders[0].id : "",
    ).toBe("blunder-2");
  });

  test("supports --auto-admit flag to record candidate proposals for open blunders", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("auto-admit");

    const openBlunder = {
      id: "blunder-to-admit",
      type: "main_thread_direct_execution",
      severity: "critical",
      observation: "Uncontained main thread execution",
      remediation: "Dispatch Tier 2 Coordinator",
    };
    writeFileSync(join(capsulesDir, "blunders.jsonl"), `${JSON.stringify(openBlunder)}\n`, "utf-8");

    const result = blunderAuditCommand({
      run: runRoot,
      "capsules-dir": capsulesDir,
      "auto-admit": true,
      actor: "mind-lead",
    });

    expect(result.auto_admitted_count).toBe(1);
    expect(result.auto_admitted_candidates.length).toBe(1);
    expect(
      result.auto_admitted_candidates[0] !== undefined ? result.auto_admitted_candidates[0] : "",
    ).toBe("cand-blunder-blunder-to-admit");
    expect(
      result.filtered_blunders[0] !== undefined ? result.filtered_blunders[0].status : "",
    ).toBe("admitted");
    expect(
      result.filtered_blunders[0] !== undefined ? result.filtered_blunders[0].candidate_id : null,
    ).toBe("cand-blunder-blunder-to-admit");

    // Verify candidate was transacted into state.json
    const reloaded = loadRun(runRoot, false);
    const candidateList = Array.isArray(reloaded.state.candidates) ? reloaded.state.candidates : [];
    expect(candidateList.length).toBe(1);
    const cand = candidateList[0] as Record<string, unknown>;
    expect(cand.id).toBe("cand-blunder-blunder-to-admit");
    expect(cand.status).toBe("admitted");
    expect(cand.witness).toBe("blunder-to-admit");
  });

  test("throws HarnessError on invalid arguments", () => {
    const { capsulesDir } = setupTestWorkspace("errors");

    // Invalid filter-status
    expect(() =>
      blunderAuditCommand({
        "capsules-dir": capsulesDir,
        "filter-status": "invalid_status",
      }),
    ).toThrow(HarnessError);

    // Non-existent capsules-dir
    expect(() =>
      blunderAuditCommand({
        "capsules-dir": "/tmp/non-existent-capsules-dir-12345",
      }),
    ).toThrow(HarnessError);

    // --auto-admit without --run
    expect(() =>
      blunderAuditCommand({
        "capsules-dir": capsulesDir,
        "auto-admit": true,
      }),
    ).toThrow(HarnessError);

    // Invalid --now
    expect(() =>
      blunderAuditCommand({
        "capsules-dir": capsulesDir,
        now: "not-a-timestamp",
      }),
    ).toThrow(HarnessError);

    // Unknown option
    expect(() =>
      blunderAuditCommand({
        "capsules-dir": capsulesDir,
        unknown_option: "bad",
      }),
    ).toThrow(HarnessError);
  });

  test("handles empty states and skips malformed JSON lines cleanly", () => {
    const { capsulesDir } = setupTestWorkspace("empty-malformed");

    // Empty capsules directory
    const emptyResult = blunderAuditCommand({
      "capsules-dir": capsulesDir,
    });
    expect(emptyResult.total_blunders).toBe(0);
    expect(emptyResult.filtered_blunders.length).toBe(0);
    expect(emptyResult.markdown.includes("No recorded blunders discovered")).toBeTrue();

    // Write file with malformed JSON lines mixed with valid line
    const mixedContent = [
      "not a json line",
      "{ invalid json",
      JSON.stringify({
        id: "blunder-valid-1",
        type: "role_escalation",
        severity: "warning",
        observation: "Valid entry",
        remediation: "Check roles",
      }),
      "",
      "   ",
      "{}",
    ].join("\n");

    writeFileSync(join(capsulesDir, "blunders.jsonl"), mixedContent, "utf-8");

    const mixedResult = blunderAuditCommand({
      "capsules-dir": capsulesDir,
    });
    expect(mixedResult.total_blunders).toBe(1);
    expect(
      mixedResult.filtered_blunders[0] !== undefined ? mixedResult.filtered_blunders[0].id : "",
    ).toBe("blunder-valid-1");
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
    const sampleBlunders: AuditedBlunder[] = [
      {
        id: "blunder-table-1",
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
        source_file: "mind-gen-1/blunders.jsonl",
      },
    ];

    const asciiTable = renderAsciiBlunderTable(sampleBlunders);
    expect(asciiTable.includes("┌")).toBeTrue();
    expect(asciiTable.includes("┐")).toBeTrue();
    expect(asciiTable.includes("└")).toBeTrue();
    expect(asciiTable.includes("┘")).toBeTrue();
    expect(asciiTable.includes("blunder-table-1")).toBeTrue();
    expect(asciiTable.includes("CRITICAL")).toBeTrue();

    const emptyTable = renderAsciiBlunderTable([]);
    expect(emptyTable.includes("No recorded blunders discovered")).toBeTrue();

    const report = formatBlunderAuditReport({
      capsulesDir: "/test/.capsules",
      runRoot: "/test/.capsules/run-1",
      blunders: sampleBlunders,
      summary: {
        total_blunders: 1,
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

    expect(report.includes("Blunder Audit & Observability Report")).toBeTrue();
    expect(report.includes("APCA Perceived Contrast Compliance**: PASS")).toBeTrue();
  });

  test("resolves blunder status from state.json candidate dispositions (resolved and declined)", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("candidate-dispositions");

    // Add blunders
    const blunders = [
      {
        id: "blunder-cand-resolved",
        type: "main_thread_direct_execution",
        severity: "critical",
        status: "open",
        observation: "Direct execution",
        remediation: "Fix",
      },
      {
        id: "blunder-cand-declined",
        type: "role_escalation",
        severity: "warning",
        status: "open",
        observation: "Role jump",
        remediation: "Fix",
      },
    ];

    writeFileSync(
      join(runRoot, "blunders.jsonl"),
      blunders.map((b) => JSON.stringify(b)).join("\n"),
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
            witness: "blunder-cand-resolved",
            status: "closed",
          },
          {
            id: "cand-2",
            kind: "defect",
            statement: "Fix role jump",
            witness: "blunder-cand-declined",
            status: "declined",
          },
        ];
      },
    );

    const result = blunderAuditCommand({
      run: runRoot,
      "capsules-dir": capsulesDir,
    });

    expect(result.summary.resolved_count).toBe(1);
    expect(result.summary.declined_count).toBe(1);
    expect(result.summary.open_count).toBe(0);

    const resolvedBlunder = result.filtered_blunders.find((b) => b.id === "blunder-cand-resolved");
    expect(resolvedBlunder !== undefined ? resolvedBlunder.status : "").toBe("resolved");
    expect(resolvedBlunder !== undefined ? resolvedBlunder.candidate_id : "").toBe("cand-1");

    const declinedBlunder = result.filtered_blunders.find((b) => b.id === "blunder-cand-declined");
    expect(declinedBlunder !== undefined ? declinedBlunder.status : "").toBe("declined");
    expect(declinedBlunder !== undefined ? declinedBlunder.candidate_id : "").toBe("cand-2");
  });

  test("deduplicates blunders across files and updates status from open to non-open", () => {
    const { capsulesDir, runRoot } = setupTestWorkspace("dedup");

    const blunderOpen = {
      id: "blunder-dup-1",
      type: "unauthorized_mutation",
      severity: "critical",
      status: "open",
      observation: "First observation",
      remediation: "Fix",
    };
    writeFileSync(join(capsulesDir, "blunders.jsonl"), `${JSON.stringify(blunderOpen)}\n`, "utf-8");

    const blunderResolved = {
      id: "blunder-dup-1",
      type: "unauthorized_mutation",
      severity: "critical",
      status: "resolved",
      observation: "First observation",
      remediation: "Fix",
    };
    writeFileSync(join(runRoot, "blunders.jsonl"), `${JSON.stringify(blunderResolved)}\n`, "utf-8");

    const result = blunderAuditCommand({
      run: runRoot,
      "capsules-dir": capsulesDir,
    });

    expect(result.total_blunders).toBe(1);
    expect(result.filtered_blunders.length).toBe(1);
    expect(
      result.filtered_blunders[0] !== undefined ? result.filtered_blunders[0].status : "",
    ).toBe("resolved");
  });

  test("enforces line limits without --all and expands with --all", () => {
    const { capsulesDir } = setupTestWorkspace("line-limit");

    const manyBlunders = [];
    for (let i = 0; i < 20; i = i + 1) {
      manyBlunders.push({
        id: `blunder-many-${i}`,
        type: "main_thread_direct_execution",
        severity: "critical",
        status: "open",
        observation: `Blunder observation number ${i} with detailed explanation text`,
        remediation: `Remediation number ${i}`,
      });
    }

    writeFileSync(
      join(capsulesDir, "blunders.jsonl"),
      manyBlunders.map((b) => JSON.stringify(b)).join("\n"),
      "utf-8",
    );

    const standardResult = blunderAuditCommand({
      "capsules-dir": capsulesDir,
    });
    const standardLines = standardResult.markdown.split("\n").length;
    expect(standardLines).toBeLessThanOrEqual(35);
    expect(standardResult.markdown.includes("truncated")).toBeTrue();

    const allResult = blunderAuditCommand({
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
});
