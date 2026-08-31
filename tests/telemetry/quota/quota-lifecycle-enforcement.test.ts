import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { planInitCommand } from "../../../olt/scripts/src/cli/commands/plan.ts";
import { planCompileCommand } from "../../../olt/scripts/src/cli/commands/plan-compile.ts";
import { taskClaimCommand, taskSubmitCommand } from "../../../olt/scripts/src/cli/commands/task-claim.ts";
import { doctorCommand } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import { runCompleteCommand } from "../../../olt/scripts/src/cli/commands/run-ops.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import * as completeRunModule from "../../../olt/scripts/src/workflow/completion/complete-run.ts";
import { executePostFlightDoctorAudit, executePreFlightDoctorAudit } from "../../../olt/scripts/src/workflow/lifecycle/harness-hooks.ts";
import { establishSupervisorChain, registerUnderChain } from "../../shared/agent-supervisor-chain.ts";

const TASK_ID = "task-core";
const CHANGED_FILE = "tests/core/probe-target.ts";

async function createProbeRun(name: string, roots: string[]): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), `quota-probe-${name}-`)));
  roots.push(repo);

  mkdirSync(join(repo, ".olt"), { recursive: true });
  mkdirSync(join(repo, "olt"), { recursive: true });
  mkdirSync(join(repo, "tests/core"), { recursive: true });

  spawnSync("git", ["init", "--quiet", repo]);
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });

  writeFileSync(join(repo, "harness.config.json"), JSON.stringify({ min_adversarial_probes: 1 }));
  const promptPath = join(repo, "prompt.txt");
  writeFileSync(promptPath, "Core unit tests");
  writeFileSync(join(repo, CHANGED_FILE), "export const probed = true;\n");
  writeFileSync(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  writeFileSync(join(repo, "package.json"), "{}");
  writeFileSync(join(repo, ".gitignore"), ".olt/capsules\n.olt\ncapsules\n");

  const policyContent = JSON.stringify({
    schema_version: 1,
    ecosystem: "bun",
    package_manager: "bun",
    test_runner: { default_command: "bun test", targeted_pattern: "bun test <path>", full_suite_command: "bun test" },
  });
  writeFileSync(join(repo, "olt", "policy.json"), policyContent);
  writeFileSync(join(repo, ".olt", "policy.json"), policyContent);

  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["commit", "-m", "init", "--allow-empty"], { cwd: repo });

  const init = await execute(["plan:init", "--repo", repo, "--run", name, "--prompt-file", promptPath]);
  const run = init.run_root as string;

  await execute(["plan:add", "--run", run, "--id", TASK_ID, "--label", "Core probe task", "--scope", "tests/core", "--gate", "bun gate-core.ts", "--actor", "planner"]);
  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
  await execute(["plan:compile", "--run", run, "--actor", "planner", "--completion-gate", "bun test tests"]);

  const chain = await establishSupervisorChain(run);
  await registerUnderChain(run, chain, "worker-core", "implementer");

  return { repo, run };
}

describe("Quota Lifecycle Enforcement & Command Integration", () => {
  const roots: string[] = [];
  let tmpDir: string;
  let runRoot: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "quota-enforce-")));
    roots.push(tmpDir);

    mkdirSync(join(tmpDir, ".olt"), { recursive: true });
    spawnSync("git", ["init", "--quiet", tmpDir]);
    writeFileSync(join(tmpDir, ".gitignore"), ".olt/capsules\ncapsules\n.capsules\nnode_modules\n");
    writeFileSync(join(tmpDir, "package.json"), "{}");
    spawnSync("git", ["add", "-A"], { cwd: tmpDir });
    spawnSync("git", ["commit", "-m", "init", "--allow-empty"], { cwd: tmpDir });

    runRoot = initRun(tmpDir, "quota-run", new TextEncoder().encode("quota lifecycle"), "file", true);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  describe("Lifecycle Hooks Integration", () => {
    it("executePreFlightDoctorAudit performs quota check and succeeds when healthy", async () => {
      const preFlight = await executePreFlightDoctorAudit(runRoot, { repoRoot: tmpDir, checkQuota: true, quotaThreshold: 10 });
      expect(preFlight.healthy).toBe(true);
      expect(preFlight.quotaTelemetry).toBeDefined();
    });

    it("executePostFlightDoctorAudit includes live quota telemetry and audits violations", async () => {
      const postFlight = await executePostFlightDoctorAudit(runRoot, {
        repoRoot: tmpDir,
        autoStageGit: true,
        enforceHygiene: true,
        enforceQuotas: false,
        checkLiveQuota: true,
        quotaThreshold: 10,
      });
      expect(postFlight.healthy).toBe(true);
      expect(postFlight.quotaTelemetry).toBeDefined();
    });
  });

  describe("CLI Commands Live Quota Telemetry Integration", () => {
    it("plan:init embeds live quota telemetry in return object and markdown", async () => {
      const initRes = await planInitCommand({ repo: tmpDir, run: "quota-init-run", "prompt-stdin": true }, { stdin: new TextEncoder().encode("Plan init prompt") });
      expect(initRes.run_root).toBeDefined();
      expect(initRes.quota_telemetry).toBeDefined();
      expect(initRes.markdown as string).toContain("Quota Telemetry");
    });

    it("plan:compile embeds live quota telemetry in return object and markdown", async () => {
      const promptPath = join(tmpDir, "prompt.txt");
      writeFileSync(promptPath, "Compile test prompt");

      const init = await execute(["plan:init", "--repo", tmpDir, "--run", "compile-test-run", "--prompt-file", promptPath]);
      const compileRunRoot = init.run_root as string;

      await execute(["plan:add", "--run", compileRunRoot, "--id", "task-c1", "--label", "Task C1", "--scope", "src/c1", "--gate", "bun test src/c1.test.ts", "--actor", "planner"]);
      await execute(["plan:brainstorm", "--run", compileRunRoot, "--actor", "planner"]);

      const compileRes = await planCompileCommand({ run: compileRunRoot, actor: "planner", "completion-gate": "bun test tests" });
      expect(compileRes.run_root).toBe(compileRunRoot);
      expect(compileRes.quota_telemetry).toBeDefined();
      expect(compileRes.markdown as string).toContain("Quota Telemetry");
    });

    it("task:claim and task:submit embed live quota telemetry in return objects and markdown", async () => {
      const { repo, run } = await createProbeRun("quota-task-claim-submit", roots);

      const claimRes = await taskClaimCommand({ run, task: TASK_ID, agent: "worker-core", role: "implementer" });
      expect(claimRes.token).toBeDefined();
      expect(claimRes.quota_telemetry).toBeDefined();
      expect(claimRes.markdown as string).toContain("Live Quota");

      const workerCheck = await execute(["run:exec", "--run", run, "--task", TASK_ID, "--actor", "worker-core", "--cwd", repo, "--", "bun", "gate-core.ts"]);

      writeFileSync(join(repo, CHANGED_FILE), "export const probed = true;\nexport const implemented = true;\n");

      const submitRes = await taskSubmitCommand({
        run,
        task: TASK_ID,
        agent: "worker-core",
        token: claimRes.token as string,
        summary: "verified probe changes for quota test",
        "files-changed": [CHANGED_FILE],
        evidence: [workerCheck.command_id as string],
      });

      expect(submitRes.report_path).toBeDefined();
      expect(submitRes.quota_telemetry).toBeDefined();
      expect(submitRes.markdown as string).toContain("Live Quota");
    });

    it("doctor embeds live quota telemetry in return object and markdown", async () => {
      const docRes = await doctorCommand({ run: runRoot });
      expect(docRes.healthy).toBeDefined();
      expect(docRes.quota_telemetry).toBeDefined();
      expect(docRes.markdown as string).toContain("Quota Telemetry");
    });

    it("run:complete embeds live quota telemetry in return object and markdown", async () => {
      const completeSpy = spyOn(completeRunModule, "completeRun").mockReturnValue({
        tasks: { "T-1": { id: "T-1", status: "done", requirement_ids: [], write_scope: ["."], dependencies: [], attempts: [], history: [], repair_round: 0, report: { summary: "done" } } },
        requirements: [],
        gates: [],
        branches: [],
        completion_result: { status: "success" },
      } as unknown as completeRunModule.CompleteRunResult);

      const completeRes = await runCompleteCommand({ run: runRoot, actor: "coordinator", "auth-token": "tok_auth_123" });
      expect(completeRes.completion).toBeDefined();
      expect(completeRes.quota_telemetry).toBeDefined();
      expect(completeRes.markdown as string).toContain("Live Quota");

      completeSpy.mockRestore();
    });
  });
});
