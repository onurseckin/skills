import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runDoctor,
  autoHealCapsule,
  checkAstPurity,
  checkPlanningDag,
  checkPushbackQuotas,
  checkRepositoryHygiene,
  checkGitIndexIntegrity,
  formatDoctorReport,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import {
  syncDoctorFindingsToDefects,
  parseDefectsJsonl,
  transitionDefectState,
  handleDefectRecurrence,
  type EmpiricalFailureProof,
} from "../../../olt/scripts/src/mind/defects/sync/index.ts";
import { executeFindingFileCommand } from "../../../olt/scripts/src/cli/commands/finding-ops.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Wave 4 - Task 4.3: Comprehensive Master Doctor Engine E2E Integration Suite", () => {
  test("E2E Scenario: Self-healing, AST purity, hygiene, flock defects, and master diagnostics", async () => {
    const repo = await mkdtemp(join(tmpdir(), "master-doctor-e2e-"));
    roots.push(repo);

    await mkdir(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "e2e-project" }));
    writeFileSync(join(repo, "README.md"), "# E2E Project");

    const runRoot = initRun(
      repo,
      "master-e2e-run",
      new TextEncoder().encode("Prompt for master doctor e2e"),
      "file",
      true,
    );

    // 1. Establish initial valid DAG and tasks
    transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
      state.tasks = {
        "task-1": {
          id: "task-1",
          status: "in_progress",
          assigned_agent: "worker-1",
          write_scope: ["src/featureA.ts"],
          adversarial_probes: [1, 2, 3],
          cognitive_pushbacks: [1, 2],
        },
      };
    });

    // 2. Corrupt capsule projection to test default auto-healing
    writeFileSync(
      join(runRoot, "state.json"),
      JSON.stringify({ schema: "harness.state", event_sequence: 99999, corrupted: true }),
    );

    // 3. Inject dead flock lock
    const locksDir = join(repo, ".locks");
    await mkdir(locksDir, { recursive: true });
    writeFileSync(join(locksDir, "stale.lock"), JSON.stringify({ pid: 9999999 }));

    // 4. Test Native AST static purity on real code (assert zero false positives on strings)
    const pureCode = `
      export function validate(input: string): boolean {
        const errorMsg = "Banned 'as any' usage detected";
        const regex = /<any>/g;
        return input.length > 0 && !regex.test(errorMsg);
      }
    `;
    const purityResult = checkAstPurity({
      fileContents: { "src/featureA.ts": pureCode },
    });
    expect(purityResult.passed).toBe(true);

    // 5. Test CLI finding:file recording to flock-locked defect store
    const defectsPath = join(repo, ".olt", "defects.jsonl");
    const cliResult = await executeFindingFileCommand({
      code: "AST_PURITY_VIOLATION",
      severity: "high",
      file: "src/featureA.ts",
      line: 10,
      message: "Prohibited any found during audit",
      taskId: "task-1",
      commitSha: "abc1234",
      defectsPath,
    });
    expect(cliResult.success).toBe(true);

    // 6. Test Defect State Transitions
    const rawDefects = parseDefectsJsonl(readFileSync(defectsPath, "utf-8"));
    expect(rawDefects.length).toBe(1);
    const defect = rawDefects[0]!;

    // Resolve defect
    const resolved = transitionDefectState(defect, "completed");
    expect(resolved.status).toBe("completed");

    // Recurrence moves to deliberating without proof
    const deliberating = handleDefectRecurrence(resolved);
    expect(deliberating.status).toBe("deliberating");

    // Reopening with valid proof succeeds
    const proof: EmpiricalFailureProof = {
      commit_sha: "abc1234",
      test_assertion: "expect(purity).toBe(true)",
      task_id: "task-1",
      timestamp: new Date().toISOString(),
    };
    const reopened = transitionDefectState(deliberating, "open", proof);
    expect(reopened.status).toBe("open");
    expect(reopened.count).toBe(3);

    // 7. Run Master Doctor on capsule: verify auto-healing, engine checks, and severity tiering
    const doctorReport = await runDoctor(runRoot, { repoRoot: repo }, () => ({
      status: 0,
      bytes: new Uint8Array(),
    }));

    expect(doctorReport.healthy).toBe(true);
    expect(doctorReport.auto_healed).toBeDefined();
    expect((doctorReport.auto_healed as string[]).length).toBeGreaterThan(0);
    expect(existsSync(join(locksDir, "stale.lock"))).toBe(false);

    // 8. Verify formatted report
    const markdown = doctorReport.markdown as string;
    expect(markdown).toContain("### Capsule Doctor:");
    expect(markdown).toContain("### Doctor Findings:");
    expect(markdown).toContain("- **[ERROR]**:");
    expect(markdown).toContain("- **[INFO]**:");
  });
});
