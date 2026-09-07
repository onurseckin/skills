import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  runDoctor,
  formatDoctorReport,
  tierDoctorIssues,
  type DoctorCheckEngineResult,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";
import {
  cleanupVirtualReportingFS,
  getVirtualReportingFS,
  setupVirtualReportingFS,
  tempDir,
} from "../fixture.ts";

const UNIFIED_DOCTOR_ENGINES: readonly string[] = [
  "checkPlanningDag",
  "checkAstPurity",
  "checkAntiMockMutation",
  "checkAntiBatchingIsolation",
  "checkDualChannelUi",
  "checkCognitiveValidatorCommandLock",
  "checkRoleBoundaryInterlock",
  "checkPushbackQuotas",
  "checkPolicyDoctor",
  "checkRepositoryHygiene",
  "checkGitIndexIntegrity",
];

export const doctorUnifiedSuiteName =
  "Wave 4 - Task 4.1: Unified Master Doctor Engine Integration & Severity Tiering";

describe(doctorUnifiedSuiteName, () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("runDoctor integrates all diagnostic engines and returns structured report", async () => {
    const vfs = getVirtualReportingFS();
    const repo = tempDir("unified-doctor-repo");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, "package.json"), "{}");

    const runRoot = initRun(
      repo,
      "unified-doctor-run",
      new TextEncoder().encode("Prompt"),
      "file",
      true,
    );

    transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
      state.tasks = {
        t1: {
          id: "t1",
          status: "in_progress",
          assigned_agent: "worker-1",
          write_scope: ["src/a.ts"],
        },
      };
    });

    const report = await runDoctor(runRoot, { repoRoot: repo, writeScope: [] }, () => ({
      status: 0,
      bytes: new Uint8Array(),
    }));
    expect(report.engine_results).toBeDefined();

    const engines = report.engine_results as Record<string, DoctorCheckEngineResult | undefined>;

    const absent = UNIFIED_DOCTOR_ENGINES.filter((name) => engines[name] === undefined);
    expect(absent).toEqual([]);

    const misidentified = UNIFIED_DOCTOR_ENGINES.filter((name) => engines[name]?.engine !== name);
    expect(misidentified).toEqual([]);

    const unstructured = UNIFIED_DOCTOR_ENGINES.filter(
      (name) =>
        typeof engines[name]?.passed !== "boolean" || !Array.isArray(engines[name]?.findings),
    );
    expect(unstructured).toEqual([]);

    const reported = new Set(Object.keys(engines));
    const misattributed = UNIFIED_DOCTOR_ENGINES.filter((name) =>
      (engines[name]?.findings ?? []).some((finding) => !reported.has(finding.engine)),
    );
    expect(misattributed).toEqual([]);
  });

  test("tierDoctorIssues correctly tiers critical vs cosmetic issues", () => {
    const issues = [
      "STATE_PROJECTION: State mismatch",
      "LAYOUT_UNDECLARED: Optional layout missing",
      "[INFO] checkDualChannelUi: Theme contrast high",
    ];

    const tiering = tierDoctorIssues(issues);
    expect(tiering.healthy).toBe(false);
    expect(tiering.criticalIssues).toHaveLength(1);
    expect(tiering.cosmeticIssues).toHaveLength(2);
  });

  test("formatDoctorReport renders structured markdown sections with clear severity tags", () => {
    const formatted = formatDoctorReport({
      runRoot: "/test/capsule",
      healthy: false,
      bunVersion: "1.3.14",
      bunSupported: true,
      gitignored: true,
      issues: ["CRITICAL_ERROR: failed", "LAYOUT_UNDECLARED: info"],
      errors: ["CRITICAL_ERROR: failed"],
      warnings: ["HYGIENE_WARN: loose file"],
      infos: ["Auto-Healed: projection restored"],
      autoHealed: ["projection restored"],
    });

    expect(formatted).toContain("### Capsule Doctor:");
    expect(formatted).toContain("### Doctor Findings:");
    expect(formatted).toContain("- **[ERROR]**:");
    expect(formatted).toContain("  - CRITICAL_ERROR: failed");
    expect(formatted).toContain("- **[WARN]**:");
    expect(formatted).toContain("  - HYGIENE_WARN: loose file");
    expect(formatted).toContain("- **[INFO]**:");
    expect(formatted).toContain("  - Auto-Healed: projection restored");
  });
});
