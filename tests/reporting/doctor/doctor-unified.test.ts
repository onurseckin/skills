import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runDoctor,
  formatDoctorReport,
  tierDoctorIssues,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

export const doctorUnifiedSuiteName = "Wave 4 - Task 4.1: Unified Master Doctor Engine Integration & Severity Tiering";

describe(doctorUnifiedSuiteName, () => {
  test("runDoctor integrates all diagnostic engines and returns structured report", async () => {
    const repo = await mkdtemp(join(tmpdir(), "unified-doctor-repo-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));
    writeFileSync(join(repo, "package.json"), "{}");

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

    const report = await runDoctor(runRoot, {}, () => ({ status: 0, bytes: new Uint8Array() }));
    expect(report.healthy).toBe(true);
    expect(report.engine_results).toBeDefined();

    const engines = report.engine_results as Record<string, unknown>;
    expect(engines.checkPlanningDag).toBeDefined();
    expect(engines.checkAstPurity).toBeDefined();
    expect(engines.checkAntiMockMutation).toBeDefined();
    expect(engines.checkAntiBatchingIsolation).toBeDefined();
    expect(engines.checkDualChannelUi).toBeDefined();
    expect(engines.checkCognitiveValidatorCommandLock).toBeDefined();
    expect(engines.checkRoleBoundaryInterlock).toBeDefined();
    expect(engines.checkPushbackQuotas).toBeDefined();
    expect(engines.checkPolicyDoctor).toBeDefined();
    expect(engines.checkRepositoryHygiene).toBeDefined();
    expect(engines.checkGitIndexIntegrity).toBeDefined();
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
