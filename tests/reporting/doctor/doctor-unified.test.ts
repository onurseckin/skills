import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  runDoctor,
  formatDoctorReport,
  tierDoctorIssues,
  computeDoctorEnginePassed,
  checkDualChannelUi,
  checkAgentCanonicalAlignment,
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
  "checkMailboxHealth",
  "checkWorktreeHealth",
  "checkCliRegistryTaxonomy",
  "checkTier0CompanionsHealth",
  "checkAntiStagnationDoctor",
  "checkPlanQualityAndAgentUtilization",
  "checkAgentCanonicalAlignment",
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

    const inconsistentVerdict = UNIFIED_DOCTOR_ENGINES.filter((name) => {
      const res = engines[name];
      if (!res) return true;
      return res.passed !== computeDoctorEnginePassed(res.findings);
    });
    expect(inconsistentVerdict).toEqual([]);

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

  test("all doctor engines adhere to uniform passed contract across severities", () => {
    for (const name of UNIFIED_DOCTOR_ENGINES) {
      expect(computeDoctorEnginePassed([])).toBe(true);
      expect(
        computeDoctorEnginePassed([
          { code: "WARN_CODE", severity: "WARN", engine: name, message: "warn" },
        ]),
      ).toBe(true);
      expect(
        computeDoctorEnginePassed([
          { code: "INFO_CODE", severity: "INFO", engine: name, message: "info" },
        ]),
      ).toBe(true);
      expect(
        computeDoctorEnginePassed([
          { code: "ERR_CODE", severity: "ERROR", engine: name, message: "err" },
        ]),
      ).toBe(false);
      expect(
        computeDoctorEnginePassed([
          { code: "CRIT_CODE", severity: "critical", engine: name, message: "crit" },
        ]),
      ).toBe(false);
      expect(
        computeDoctorEnginePassed([
          { code: "HIGH_CODE", severity: "high", engine: name, message: "high" },
        ]),
      ).toBe(false);
    }
  });

  test("dual-channel-ui and agent-canonical engines compute passed consistently with findings", () => {
    const warnUiResult = checkDualChannelUi({
      themeElements: [
        {
          selector: ".card",
          theme: "light",
          foregroundColor: "#888888",
          backgroundColor: "#ffffff",
        },
      ],
      checkTerminalChannels: false,
    });
    expect(warnUiResult.findings.length).toBeGreaterThan(0);
    expect(warnUiResult.findings.every((f) => f.severity === "WARN")).toBe(true);
    expect(warnUiResult.passed).toBe(true);

    const errorUiResult = checkDualChannelUi({
      themeElements: [
        {
          selector: ".subtle",
          theme: "light",
          foregroundColor: "#aaaaaa",
          backgroundColor: "#ffffff",
        },
      ],
      checkTerminalChannels: false,
    });

    expect(errorUiResult.findings.some((f) => f.severity === "ERROR")).toBe(true);
    expect(errorUiResult.passed).toBe(false);

    const conformingValidator = {
      id: "val-canon-pass",
      role: "validator",
      systemPrompt: "You are a cognitive validator. Analyze without executing commands.",
      tools: { enable_write_tools: true },
      invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
    };
    const agentPassResult = checkAgentCanonicalAlignment({
      activeAgents: [conformingValidator],
    });
    expect(agentPassResult.findings).toHaveLength(0);
    expect(agentPassResult.passed).toBe(true);

    const rogueValidator = {
      id: "val-canon-fail",
      role: "validator",
      systemPrompt: "Run bun test on touched files.",
      tools: { enable_write_tools: true },
      invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
    };
    const agentFailResult = checkAgentCanonicalAlignment({
      activeAgents: [rogueValidator],
    });
    expect(agentFailResult.findings.some((f) => f.severity === "ERROR")).toBe(true);
    expect(agentFailResult.passed).toBe(false);
  });
});
