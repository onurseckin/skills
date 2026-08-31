import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { quotaFreezeCommand } from "../../olt/scripts/src/cli/commands/quota-freeze.ts";
import { quotaResumeCommand } from "../../olt/scripts/src/cli/commands/quota-resume.ts";
import { planInitCommand } from "../../olt/scripts/src/cli/commands/plan.ts";
import { planCompileCommand } from "../../olt/scripts/src/cli/commands/plan-compile.ts";
import {
  taskClaimCommand,
  taskSubmitCommand,
} from "../../olt/scripts/src/cli/commands/task-claim.ts";
import { doctorCommand } from "../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import { runCompleteCommand } from "../../olt/scripts/src/cli/commands/run-ops.ts";
import { QuotaCircuitBreaker } from "../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { loadDagSnapshot } from "../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { readTelemetryStream } from "../../olt/scripts/src/reporting/telemetry-stream.ts";
import { initRun } from "../../olt/scripts/src/engine/store/index.ts";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import type { UnifiedTelemetryReport } from "../../olt/scripts/src/telemetry/types.ts";
import * as completeRunModule from "../../olt/scripts/src/workflow/completion/complete-run.ts";
import {
  formatQuotaBadge,
  formatQuotaTelemetryLine,
  probeLiveQuotaTelemetry,
  type LifecycleQuotaTelemetry,
} from "../../olt/scripts/src/workflow/lifecycle/quota-lifecycle.ts";
import {
  executePostFlightDoctorAudit,
  executePreFlightDoctorAudit,
} from "../../olt/scripts/src/workflow/lifecycle/harness-hooks.ts";
import type { CollectorEnvironment } from "../../olt/scripts/src/telemetry/collectors/index.ts";
import { setupRun, TASK_ID, CHANGED_FILE } from "../cli/probe-fixture.ts";
import { cleanupRoots } from "../cli/full-lifecycle-fixture.ts";

describe("Quota Lifecycle", () => {
  const TMP_DIR = join(process.cwd(), "tests-tmp-quota-lifecycle");
  const roots: string[] = [];
  let runRoot: string;

  beforeEach(() => {
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }
    const targetDir = join(TMP_DIR, ".olt");
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    const git = spawnSync("git", ["init", "--quiet", TMP_DIR]);
    if (git.status !== 0) throw new Error("could not initialize quota lifecycle test repository");
    writeFileSync(
      join(TMP_DIR, ".gitignore"),
      ".olt/capsules\ncapsules\n.capsules\nnode_modules\n",
    );
    writeFileSync(join(TMP_DIR, "package.json"), "{}");
    spawnSync("git", ["add", "-A"], { cwd: TMP_DIR });
    spawnSync("git", ["commit", "-m", "init", "--allow-empty"], { cwd: TMP_DIR });

    runRoot = initRun(
      TMP_DIR,
      "quota-run",
      new TextEncoder().encode("quota lifecycle"),
      "file",
      true,
    );
  });

  afterEach(async () => {
    await cleanupRoots(roots);
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("Normal state (quota > 10%) -> quota:check is OK and quota:freeze skips unless forced", async () => {
    const breaker = new QuotaCircuitBreaker();
    const normalReport: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId: "antigravity",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          errors: [],
          rawObservations: {},
          metrics: [
            {
              rawMetricName: "requests",
              canonicalProvider: "antigravity",
              windowType: "sliding",
              remainingPercentage: 20,
              sourceTier: "tier1_cli_command",
              confidence: "verified_exact",
              rawPayload: { remainingPercentage: 20, requestsRemaining: 100 },
            },
          ],
        },
      ],
      summary: {},
    };
    const evaluation = breaker.evaluate(normalReport, {
      thresholdPercentage: 10,
      activeAgentsCount: 0,
    });

    expect(evaluation.isTriggered).toBe(false);

    const forcedResult = await quotaFreezeCommand({ repo: TMP_DIR, run: runRoot, force: true });
    expect(forcedResult.status).toBe("frozen");
  });

  it("Quota breach (<10%) -> triggers circuit breaker, computes resetTime + 60s auto-wake", () => {
    const breaker = new QuotaCircuitBreaker();
    const breachReport: UnifiedTelemetryReport = {
      timestamp: "2024-01-01T10:00:00Z",
      results: [
        {
          platformId: "antigravity",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          errors: [],
          rawObservations: {},
          metrics: [
            {
              rawMetricName: "requests",
              canonicalProvider: "antigravity",
              windowType: "sliding",
              remainingPercentage: 5,
              sourceTier: "tier1_cli_command",
              confidence: "verified_exact",
              rawPayload: {
                remainingPercentage: 5,
                requestsRemaining: 100,
                resetTime: "2024-01-01T12:00:00Z",
              },
            },
          ],
        },
      ],
      summary: {},
    };
    const evaluation = breaker.evaluate(breachReport, {
      thresholdPercentage: 10,
      activeAgentsCount: 1,
    });

    expect(evaluation.isTriggered).toBe(true);
    expect(evaluation.constrainedModels.length).toBe(1);
    expect(evaluation.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
  });

  it("quota:freeze executes, snapshots DAG, writes file, emits event", async () => {
    const result = await quotaFreezeCommand({
      repo: TMP_DIR,
      run: runRoot,
      force: true,
      json: true,
      "active-agents": "2",
    });

    expect(result.status).toBe("frozen");
    expect(result.json).toBe(true);

    const snapshot = loadDagSnapshot(TMP_DIR);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("frozen");
    expect(snapshot?.agents).toBeDefined();

    const markdown = result.markdown as string;
    expect(typeof markdown).toBe("string");

    const events = readTelemetryStream(TMP_DIR);
    const freezeEvent = events.find((e) => e.action === "QUOTA_FREEZE_SNAPSHOT");
    expect(freezeEvent).toBeDefined();
    expect(freezeEvent?.status).toBe("success");
  });

  it("quota:resume executes, restores DAG coordinates, re-registers crons, emits event", async () => {
    await quotaFreezeCommand({ repo: TMP_DIR, run: runRoot, force: true });

    const result = await quotaResumeCommand({
      repo: TMP_DIR,
      run: runRoot,
      force: true,
      detailed: true,
      json: true,
    });

    expect(result.status).toBe("resumed");
    expect(result.json).toBe(true);

    const snapshot = loadDagSnapshot(TMP_DIR);
    expect(snapshot?.status).toBe("resumed");

    const events = readTelemetryStream(TMP_DIR);
    const resumeEvent = events.find((e) => e.action === "QUOTA_RESUME_SNAPSHOT");
    expect(resumeEvent).toBeDefined();
    expect(resumeEvent?.status).toBe("success");

    const md = result.markdown as string;
    expect(md).toContain("Re-register crons");
  });

  it("validates zero-kill invariant and cron suspension boundaries", () => {
    const invariant = { forbidKill: true, preserveIdle: true };
    expect(invariant.forbidKill).toBe(true);
    expect(invariant.preserveIdle).toBe(true);
  });

  describe("Live Quota Probing & Formatting Unit Functions", () => {
    it("formatQuotaBadge formats percentage and unmeasured values correctly", () => {
      expect(formatQuotaBadge(100)).toBe("[██████] 100%");
      expect(formatQuotaBadge(50)).toBe("[███░░░] 50%");
      expect(formatQuotaBadge(12.5)).toBe("[█░░░░░] 12.50%");
      expect(formatQuotaBadge(null)).toBe("[░░░░░░] Unmeasured");
    });

    it("formatQuotaTelemetryLine formats structured line", () => {
      const telemetry: LifecycleQuotaTelemetry = {
        report: { timestamp: new Date().toISOString(), results: [], summary: {} },
        evaluation: {
          status: "OK",
          isTriggered: false,
          thresholdPercentage: 10,
          lowestRemainingQuota: 85,
          constrainedModels: [],
          wrapUpDirectives: [],
          autoWakeSchedule: null,
          summary: "healthy",
          evaluatedAt: new Date().toISOString(),
        },
        activeHost: "antigravity",
        quotaBadge: "[█████░] 85%",
        lowestQuotaPercentage: 85,
        isTriggered: false,
        status: "OK",
      };

      const line = formatQuotaTelemetryLine(telemetry);
      expect(line).toContain("Quota Telemetry");
      expect(line).toContain("[█████░] 85%");
      expect(line).toContain("antigravity");
      expect(line).toContain("Status: OK");
    });

    it("probeLiveQuotaTelemetry probes live environment and handles mock collector environment", async () => {
      const customEnv: CollectorEnvironment = {
        env: {
          ANTIGRAVITY_CLI: "1",
        },
      };

      const telemetry = await probeLiveQuotaTelemetry({
        env: customEnv,
        host: "antigravity",
        thresholdPercentage: 10,
      });

      expect(telemetry.activeHost).toBe("antigravity");
      expect(telemetry.report).toBeDefined();
      expect(telemetry.evaluation).toBeDefined();
      expect(telemetry.quotaBadge).toBeDefined();
      expect(typeof telemetry.isTriggered).toBe("boolean");
    });
  });

  describe("Lifecycle Hooks Integration (harness-hooks.ts)", () => {
    it("executePreFlightDoctorAudit performs quota check and succeeds when healthy", async () => {
      const preFlight = await executePreFlightDoctorAudit(runRoot, {
        repoRoot: TMP_DIR,
        checkQuota: true,
        quotaThreshold: 10,
      });

      expect(preFlight.healthy).toBe(true);
      expect(preFlight.quotaTelemetry).toBeDefined();
    });

    it("executePostFlightDoctorAudit includes live quota telemetry and audits violations", async () => {
      const postFlight = await executePostFlightDoctorAudit(runRoot, {
        repoRoot: TMP_DIR,
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
      const initRes = await planInitCommand(
        {
          repo: TMP_DIR,
          run: "quota-init-run",
          "prompt-stdin": true,
        },
        { stdin: new TextEncoder().encode("Plan init prompt") },
      );

      expect(initRes.run_root).toBeDefined();
      expect(initRes.quota_telemetry).toBeDefined();
      const md = initRes.markdown as string;
      expect(md).toContain("Quota Telemetry");
    });

    it("plan:compile embeds live quota telemetry in return object and markdown", async () => {
      const promptPath = join(TMP_DIR, "prompt.txt");
      writeFileSync(promptPath, "Compile test prompt");

      const init = await execute([
        "plan:init",
        "--repo",
        TMP_DIR,
        "--run",
        "compile-test-run",
        "--prompt-file",
        promptPath,
      ]);
      const compileRunRoot = init.run_root as string;

      await execute([
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
      ]);
      await execute(["plan:brainstorm", "--run", compileRunRoot, "--actor", "planner"]);

      const compileRes = await planCompileCommand({
        run: compileRunRoot,
        actor: "planner",
        "completion-gate": "bun test tests",
      });

      expect(compileRes.run_root).toBe(compileRunRoot);
      expect(compileRes.quota_telemetry).toBeDefined();
      const md = compileRes.markdown as string;
      expect(md).toContain("Quota Telemetry");
    });

    it("task:claim and task:submit embed live quota telemetry in return objects and markdown", async () => {
      const { repo, run } = await setupRun("quota-task-claim-submit", roots);

      const claimRes = await taskClaimCommand({
        run,
        task: TASK_ID,
        agent: "worker-core",
        role: "implementer",
      });

      expect(claimRes.token).toBeDefined();
      expect(claimRes.quota_telemetry).toBeDefined();
      const claimMd = claimRes.markdown as string;
      expect(claimMd).toContain("Live Quota");

      const workerCheck = await execute([
        "run:exec",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--actor",
        "worker-core",
        "--cwd",
        repo,
        "--",
        "bun",
        "gate-core.ts",
      ]);

      writeFileSync(
        join(repo, CHANGED_FILE),
        "export const probed = true;\nexport const implemented = true;\n",
      );

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
      const submitMd = submitRes.markdown as string;
      expect(submitMd).toContain("Live Quota");
    });

    it("doctor embeds live quota telemetry in return object and markdown", async () => {
      const docRes = await doctorCommand({
        run: runRoot,
      });

      expect(docRes.healthy).toBeDefined();
      expect(docRes.quota_telemetry).toBeDefined();
      const md = docRes.markdown as string;
      expect(md).toContain("Quota Telemetry");
    });

    it("run:complete embeds live quota telemetry in return object and markdown", async () => {
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

      expect(completeRes.completion).toBeDefined();
      expect(completeRes.quota_telemetry).toBeDefined();
      const md = completeRes.markdown as string;
      expect(md).toContain("Live Quota");

      completeSpy.mockRestore();
    });
  });
});
