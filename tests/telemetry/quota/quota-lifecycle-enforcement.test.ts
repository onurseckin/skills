import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { doctorCommand } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import { planCompileCommand } from "../../../olt/scripts/src/cli/commands/plan-compile.ts";
import { planInitCommand } from "../../../olt/scripts/src/cli/commands/plan.ts";
import { runCompleteCommand } from "../../../olt/scripts/src/cli/commands/run-ops.ts";
import {
  taskClaimCommand,
  taskSubmitCommand,
} from "../../../olt/scripts/src/cli/commands/task-claim.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import * as completeRunModule from "../../../olt/scripts/src/workflow/completion/complete-run.ts";
import {
  executePostFlightDoctorAudit,
  executePreFlightDoctorAudit,
} from "../../../olt/scripts/src/workflow/lifecycle/harness-hooks.ts";
import { QuotaVirtualFs } from "./vfs-harness.ts";

export const quotaLifecycleEnforcementSuiteName =
  "Quota Lifecycle Enforcement & Command Integration";
const TASK_ID = "task-core",
  CHANGED_FILE = "tests/core/probe-target.ts";
const qfs = new QuotaVirtualFs();

const execCli = (...args: string[]) => execute(args);
const regAgent = (run: string, agent: string, role: string, parent?: string) =>
  execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    agent,
    "--role",
    role,
    "--host",
    "antigravity",
    ...(parent ? ["--parent-agent", parent, "--actor", parent] : []),
  ]);

async function createProbeRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = join("/virtual", `quota-probe-${name}`),
    prompt = join(repo, "prompt.txt");
  qfs.setFile(repo, "", true);
  qfs.setFile(join(repo, ".olt"), "", true);
  qfs.setFile(join(repo, "olt"), "", true);
  qfs.setFile(join(repo, "tests/core"), "", true);
  qfs.setFile(join(repo, "harness.config.json"), JSON.stringify({ min_adversarial_probes: 1 }));
  qfs.setFile(prompt, "Core unit tests");
  qfs.setFile(join(repo, CHANGED_FILE), "export const probed = true;\n");
  qfs.setFile(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  qfs.setFile(join(repo, "package.json"), "{}");
  qfs.setFile(join(repo, ".gitignore"), ".olt/capsules\n.olt\ncapsules\n");
  const pol = JSON.stringify({
    schema_version: 1,
    ecosystem: "bun",
    package_manager: "bun",
    test_runner: {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
    },
  });
  qfs.setFile(join(repo, "olt", "policy.json"), pol);
  qfs.setFile(join(repo, ".olt", "policy.json"), pol);

  const init = await execCli("plan:init", "--repo", repo, "--run", name, "--prompt-file", prompt);
  const run = init.run_root as string;
  await execCli(
    "plan:add",
    "--run",
    run,
    "--id",
    TASK_ID,
    "--label",
    "Core probe task",
    "--scope",
    "tests/core",
    "--gate",
    "bun gate-core.ts",
    "--actor",
    "planner",
  );
  await execCli("plan:brainstorm", "--run", run, "--actor", "planner");
  await execCli(
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  );
  await regAgent(run, "fixture-mind-root", "mind");
  await regAgent(run, "fixture-orch-root", "orchestrator", "fixture-mind-root");
  await regAgent(run, "fixture-coord-root", "coordinator", "fixture-orch-root");
  await regAgent(run, "worker-core", "implementer", "fixture-coord-root");
  return { repo, run };
}

describe(quotaLifecycleEnforcementSuiteName, () => {
  let tmpDir: string, runRoot: string;

  beforeEach(() => {
    qfs.setup();
    tmpDir = "/virtual/quota-enforce";
    qfs.setFile(tmpDir, "", true);
    qfs.setFile(join(tmpDir, ".olt"), "", true);
    qfs.setFile(join(tmpDir, ".gitignore"), ".olt/capsules\ncapsules\n.capsules\nnode_modules\n");
    qfs.setFile(join(tmpDir, "package.json"), "{}");
    runRoot = initRun(
      tmpDir,
      "quota-run",
      new TextEncoder().encode("quota lifecycle"),
      "file",
      true,
    );
  });

  afterEach(() => {
    qfs.cleanup();
  });

  it("enforces live quota telemetry across lifecycle hooks, CLI commands, and task submissions", async () => {
    const pre = await executePreFlightDoctorAudit(runRoot, {
      repoRoot: tmpDir,
      checkQuota: true,
      quotaThreshold: 10,
    });
    const post = await executePostFlightDoctorAudit(runRoot, {
      repoRoot: tmpDir,
      autoStageGit: false,
      enforceHygiene: false,
      enforceQuotas: false,
      checkLiveQuota: true,
      quotaThreshold: 10,
    });
    const initRes = await planInitCommand(
      { repo: tmpDir, run: "quota-init-run", "prompt-stdin": true },
      { stdin: new TextEncoder().encode("Plan init prompt") },
    );
    const promptPath = join(tmpDir, "prompt.txt");
    qfs.setFile(promptPath, "Compile test prompt");
    const init = await execCli(
      "plan:init",
      "--repo",
      tmpDir,
      "--run",
      "compile-test-run",
      "--prompt-file",
      promptPath,
    );
    const compileRunRoot = init.run_root as string;
    await execCli(
      "plan:add",
      "--run",
      compileRunRoot,
      "--id",
      "task-c1",
      "--label",
      "Task C1",
      "--scope",
      "src/c1",
      "--gate",
      "bun test src/c1.test.ts",
      "--actor",
      "planner",
    );
    await execCli("plan:brainstorm", "--run", compileRunRoot, "--actor", "planner");
    const compileRes = await planCompileCommand({
      run: compileRunRoot,
      actor: "planner",
      "completion-gate": "bun test tests",
    });
    const docRes = await doctorCommand({ run: runRoot });
    const completeSpy = spyOn(completeRunModule, "completeRun").mockReturnValue({
      tasks: {
        "T-1": {
          id: "T-1",
          status: "done",
          requirement_ids: [],
          write_scope: ["."],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
          report: { summary: "done" },
        },
      },
      requirements: [],
      gates: [],
      branches: [],
      completion_result: { status: "success" },
    } as unknown as completeRunModule.CompleteRunResult);
    const completeRes = await runCompleteCommand({
      run: runRoot,
      actor: "coordinator",
      "auth-token": "tok_auth_123",
    });
    completeSpy.mockRestore();

    const { repo, run } = await createProbeRun("quota-task-claim-submit");
    const claimRes = await taskClaimCommand({
      run,
      task: TASK_ID,
      agent: "worker-core",
      role: "implementer",
    });
    qfs.setFile(
      join(repo, CHANGED_FILE),
      "export const probed = true;\nexport const implemented = true;\n",
    );
    const taskReqs = (claimRes.task as { requirement_ids?: string[] })?.requirement_ids ?? [];
    const reportPath = join(repo, "submission-report.json");
    qfs.setFile(
      reportPath,
      JSON.stringify({
        task_id: TASK_ID,
        agent_id: "worker-core",
        summary: "verified probe changes for quota test",
        files_changed: [CHANGED_FILE],
        requirement_ids: taskReqs,
        checks: [{ command: "bun gate-core.ts", exit_code: 0, status: "passed" }],
        evidence: [{ command: "bun test", output: "passed" }],
      }),
    );
    const submitRes = await taskSubmitCommand({
      run,
      task: TASK_ID,
      agent: "worker-core",
      token: claimRes.token as string,
      report: reportPath,
    });

    expect(
      pre.healthy &&
        pre.quotaTelemetry !== undefined &&
        post.healthy &&
        post.quotaTelemetry !== undefined,
    ).toBe(true);
    expect(
      initRes.quota_telemetry !== undefined &&
        (initRes.markdown as string).includes("Quota Telemetry"),
    ).toBe(true);
    expect(
      compileRes.quota_telemetry !== undefined &&
        (compileRes.markdown as string).includes("Quota Telemetry"),
    ).toBe(true);
    expect(
      docRes.quota_telemetry !== undefined &&
        (docRes.markdown as string).includes("Quota Telemetry"),
    ).toBe(true);
    expect(
      completeRes.quota_telemetry !== undefined &&
        (completeRes.markdown as string).includes("Live Quota"),
    ).toBe(true);
    expect(
      claimRes.token !== undefined &&
        claimRes.quota_telemetry !== undefined &&
        (claimRes.markdown as string).includes("Live Quota"),
    ).toBe(true);
    expect(
      submitRes.report_path !== undefined &&
        submitRes.quota_telemetry !== undefined &&
        (submitRes.markdown as string).includes("Live Quota"),
    ).toBe(true);
  });
});
