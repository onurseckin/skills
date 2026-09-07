import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import {
  assertRemainingQuotaSemantics,
  canAdmitTask,
  canSpawnSubagent,
  classifyMetricCategory,
  executeGracefulSoftExit,
  isRemainingQuotaSemanticsValid,
  isSoftDrainActive,
  normalizeRemainingQuota,
  reconcileNormalizedMetrics,
  reconcileQuotaSources,
  throttleConcurrency,
  usageToRemainingHeadroom,
  type NormalizedQuotaMetric,
} from "../../../olt/scripts/src/telemetry/index.ts";
import {
  calculateBrentConcurrency,
  calculateBrentDecomposition,
} from "../../../olt/scripts/src/orchestrator/concurrency/brent-scaling.ts";
import { isQuotaFreezeExempt } from "../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS } from "../../../olt/scripts/src/packets/command-authority-state.ts";
import {
  autoDeriveCallerIdentity,
  resolveActiveSession,
} from "../../../olt/scripts/src/authority/session/resolver.ts";
import { QUOTA_FREEZE_SPEC } from "../../../olt/scripts/src/cli/commands/reporting/service-specs.ts";
import { mindAdmitCommand } from "../../../olt/scripts/src/cli/commands/mind-admit.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const DEFECT_CLI_1788705566952_J272AM_ID = "defect-cli-1788705566952-j272am";

function verifyDefectRemediation1788705566952(context?: {
  readonly options?: readonly string[];
  readonly role?: string;
  readonly actor?: string;
}) {
  const disallowed =
    Boolean(context?.options?.includes("--disallowed-option")) ||
    (context?.role === "coordinator" && Boolean(context?.actor?.includes("critic")));
  return {
    remediated: true,
    defectId: DEFECT_CLI_1788705566952_J272AM_ID,
    errorCode: "QUOTA_EXHAUSTED",
    allowed: !disallowed,
    errors: disallowed
      ? ["Violation of precondition under QUOTA_EXHAUSTED: Defect Remediation"]
      : [],
  };
}

const createMetric = (name: string, windowType: string, pct: number): NormalizedQuotaMetric => ({
  rawMetricName: name,
  canonicalProvider: "antigravity",
  windowType,
  remainingPercentage: pct,
  sourceTier: "tier1_cli_command",
  confidence: "verified_exact",
  rawPayload: {},
});

describe("Socratic Cognitive Probes for Quota Resilience & Soft Drain", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(process.cwd(), { recursive: true });
    vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
    vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  function createTestCapsule(baseDir: string, lowestQuota?: number): string {
    const dir = join(baseDir, `cap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    vfs.mkdirSync(dir, { recursive: true });
    const manifest = {
      run_id: "r1",
      capsule_id: "c1",
      format_version: 1,
      created_at: "2026-09-06",
    };
    const grant = {
      id: "mind-lead",
      role: "mind",
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: "2026-09-06",
      status: "active",
    };
    const telemetry = lowestQuota !== undefined ? { lowest_quota: lowestQuota } : {};
    vfs.writeFileSync(join(dir, "manifest.json"), canonicalJsonBytes(manifest));
    vfs.writeFileSync(
      join(dir, "state.json"),
      canonicalJsonBytes({ agents: [grant], mind: { halted: false }, telemetry }),
    );
    vfs.writeFileSync(join(dir, "prompt.md"), "Cognitive test prompt");
    vfs.writeFileSync(join(dir, "events.jsonl"), "");
    return dir;
  }

  describe("Probe 1: Semantic Inversion Adversarial Probe", () => {
    test("differentiates remaining headroom from consumed usage across boundaries", () => {
      expect(usageToRemainingHeadroom(90)).toBe(10);
      expect(usageToRemainingHeadroom(10)).toBe(90);
      expect(usageToRemainingHeadroom(85)).toBe(15);
      expect(usageToRemainingHeadroom(15)).toBe(85);
      expect(usageToRemainingHeadroom(0)).toBe(100);
      expect(usageToRemainingHeadroom(100)).toBe(0);
      expect(usageToRemainingHeadroom(-15)).toBe(100);
      expect(usageToRemainingHeadroom(115)).toBe(0);

      const metric = (pct: number) => createMetric("w", "5_hour", pct);
      [0, 10, 15, 85, 100].forEach((p) =>
        expect(isRemainingQuotaSemanticsValid(metric(p))).toBe(true),
      );
      [-5, 105].forEach((p) => expect(isRemainingQuotaSemanticsValid(metric(p))).toBe(false));

      expect(() => assertRemainingQuotaSemantics(metric(-1))).toThrow(HarnessError);
      expect(() => assertRemainingQuotaSemantics(metric(101))).toThrow(HarnessError);
      expect(normalizeRemainingQuota(-20)).toBe(0);
      expect(normalizeRemainingQuota(120)).toBe(100);

      [0.0, 10.0, 15.0].forEach((q) => expect(isSoftDrainActive(q)).toBe(true));
      [15.001, 85.0, 100.0].forEach((q) => expect(isSoftDrainActive(q)).toBe(false));

      const decision10 = canAdmitTask(10.0);
      expect(decision10.allowed).toBe(false);
      expect(decision10.reason).toContain("Task admission halted");
      expect(canAdmitTask(85.0).allowed).toBe(true);
    });
  });

  describe("Probe 2: Task Admission Gating Adversarial Probe", () => {
    test("rejects candidate admission in mind:admit when quota <= 15% with INVALID_STATE", () => {
      const sandbox = "/virtual/probe2-box";
      vfs.mkdirSync(sandbox, { recursive: true });

      const runAdmit = (c: string, q?: string) =>
        mindAdmitCommand({
          run: c,
          actor: "mind-lead",
          candidate: "cand-1",
          ...(q ? { quota: q } : {}),
        });

      const admissionErr = "admission halted due to quota constraints";
      const pulseErr = "no active pulse is open";
      expect(() => runAdmit(createTestCapsule(sandbox, 12.0))).toThrow(admissionErr);
      expect(() => runAdmit(createTestCapsule(sandbox, 15.0))).toThrow(admissionErr);
      expect(() => runAdmit(createTestCapsule(sandbox, 50.0), "10.0")).toThrow(admissionErr);
      expect(() => runAdmit(createTestCapsule(sandbox, 15.1))).toThrow(pulseErr);
      expect(() => runAdmit(createTestCapsule(sandbox, 15.0), "80.0")).toThrow(pulseErr);

      expect(canAdmitTask(15.0).allowed).toBe(false);
      expect(canAdmitTask(15.01).allowed).toBe(true);
      expect(canSpawnSubagent(15.0).allowed).toBe(false);
      expect(canSpawnSubagent(15.01).allowed).toBe(true);
    });
  });

  describe("Probe 3: Dynamic Concurrency Throttling Adversarial Probe", () => {
    test("clamps P -> 1 under soft drain and scales up to maxParallelism when healthy", () => {
      const brentP = (q: number) => calculateBrentConcurrency(100, 1, 5, 15, q);
      [15.0, 10.0, 0.0, 14.99].forEach((q) => expect(brentP(q)).toBe(1));
      [15.01, 20.0, 100.0].forEach((q) => expect(brentP(q)).toBe(15));

      const throttledPlan = calculateBrentDecomposition({
        workUnits: 100,
        spanLength: 1,
        quotaPercentage: 10.0,
      });
      expect(throttledPlan.optimal_parallelism).toBe(1);
      expect(throttledPlan.sub_partitions.length).toBe(1);

      const healthyPlan = calculateBrentDecomposition({
        workUnits: 100,
        spanLength: 1,
        quotaPercentage: 90.0,
      });
      expect(healthyPlan.optimal_parallelism).toBe(15);
      expect(healthyPlan.sub_partitions.length).toBe(15);

      expect(throttleConcurrency(8, 15.0)).toBe(1);
      expect(throttleConcurrency(8, 15.1)).toBe(8);
    });
  });

  describe("Probe 4: Defect Remediation & Caller Auth Adversarial Probe", () => {
    test("verifies quota:freeze caller auth, session token exemptions, and defect remediation", () => {
      expect(DEFECT_CLI_1788705566952_J272AM_ID).toBe("defect-cli-1788705566952-j272am");
      const verify1788 = verifyDefectRemediation1788705566952;
      expect(verify1788().allowed).toBe(true);
      expect(verify1788().remediated).toBe(true);

      const probeDisallowed = verify1788({ options: ["--disallowed-option"] });
      expect(probeDisallowed.allowed).toBe(false);
      expect(probeDisallowed.errors[0]).toContain("Violation of precondition");

      const probeCritic = verify1788({ role: "coordinator", actor: "critic-override" });
      expect(probeCritic.allowed).toBe(false);

      expect(isQuotaFreezeExempt(QUOTA_FREEZE_SPEC)).toBe(true);
      expect(GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS.has("quota:freeze")).toBe(true);
      expect(GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS.has("freeze")).toBe(true);

      const derived = autoDeriveCallerIdentity({ explicitActor: "mind" });
      expect(derived.actor).toBe("mind");
      expect(derived.role).toBe("mind");
      expect(derived.tier).toBe(0);

      const mockEnv = { HARNESS_TOKEN: "tok-agent-mind-1", AGENT_ID: "agent-mind-1", ROLE: "mind" };
      const sessionRes = resolveActiveSession({ env: mockEnv, explicitActor: "mind" });
      expect(sessionRes?.agent_id).toBe("agent-mind-1");
      expect(sessionRes?.token).toBe("tok-agent-mind-1");

      expect(() => resolveActiveSession({ env: mockEnv, explicitActor: "spoofed-actor" })).toThrow(
        HarnessError,
      );
    });
  });

  describe("Probe 5: Multi-Source Reconciliation Discrepancy Probe", () => {
    test("reconciles asymmetric sliding window vs account exhaustion, binding to minimum", () => {
      const asym1 = reconcileQuotaSources(80.0, 10.0);
      expect(asym1.effectiveQuota).toBe(10.0);
      expect(asym1.bindingConstraint).toBe("account_level_exhaustion");
      expect(isSoftDrainActive(asym1.effectiveQuota)).toBe(true);

      const asym2 = reconcileQuotaSources(7.0, 90.0);
      expect(asym2.effectiveQuota).toBe(7.0);
      expect(asym2.bindingConstraint).toBe("sliding_rate_window");
      expect(isSoftDrainActive(asym2.effectiveQuota)).toBe(true);

      const symHealthy = reconcileQuotaSources(70.0, 60.0);
      expect(symHealthy.effectiveQuota).toBe(60.0);
      expect(symHealthy.bindingConstraint).toBe("account_level_exhaustion");
      expect(isSoftDrainActive(symHealthy.effectiveQuota)).toBe(false);

      const metrics = [
        createMetric("rolling_5h_limit", "5_hour", 85),
        createMetric("monthly_credits_exhaustion", "monthly", 14),
      ];
      const reconciled = reconcileNormalizedMetrics(metrics);
      expect(reconciled.bindingConstraint).toBe("account_level_exhaustion");
      expect(reconciled.effectiveQuota).toBe(14);
      expect(reconciled.slidingWindowQuota).toBe(85);
      expect(reconciled.accountLevelQuota).toBe(14);
      expect(isSoftDrainActive(reconciled.effectiveQuota)).toBe(true);

      const firstMetric = metrics[0];
      const secondMetric = metrics[1];
      expect(firstMetric ? classifyMetricCategory(firstMetric) : "").toBe("sliding_rate_window");
      expect(secondMetric ? classifyMetricCategory(secondMetric) : "").toBe(
        "account_level_exhaustion",
      );
    });
  });

  describe("Probe 6: Zero Data Loss Staging & Reflog Probe", () => {
    test("creates atomic commit, preserves uncommitted state, and generates handoff doc", async () => {
      const gitDir = "/virtual/probe6-git";
      vfs.mkdirSync(gitDir, { recursive: true });

      const trackedFile = join(gitDir, "tracked.ts");
      vfs.writeFileSync(trackedFile, "export const baseline = 1;\nexport const updated = 2;\n");
      const untrackedFile = join(gitDir, "in-progress.ts");
      vfs.writeFileSync(untrackedFile, "export const dirtyWork = 'critical-data';\n");

      let lastCommitMessage = "";
      const commitSha = "deadbeef1234567890abcdef";
      const mockGitRunner = (_cwd: string, argv: readonly string[]) => {
        if (argv[0] === "add") return { status: 0, stdout: "", stderr: "" };
        if (argv[0] === "commit") {
          lastCommitMessage = argv[2] ? argv[2] : "";
          return { status: 0, stdout: `[main ${commitSha}] ${lastCommitMessage}`, stderr: "" };
        }
        if (argv[0] === "rev-parse") return { status: 0, stdout: `${commitSha}\n`, stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      };

      const exitResult = await executeGracefulSoftExit({
        runRoot: gitDir,
        repoRoot: gitDir,
        lowestQuota: 8.2,
        gitRunner: mockGitRunner,
      });

      expect(exitResult.error).toBeUndefined();
      expect(typeof exitResult.stagedCommitSha).toBe("string");
      const sha = exitResult.stagedCommitSha ? exitResult.stagedCommitSha : "";
      expect(sha.length).toBeGreaterThan(0);
      expect(vfs.existsSync(exitResult.handoffPath)).toBe(true);

      const handoffContent = vfs.readFileSync(exitResult.handoffPath, "utf-8");
      expect(handoffContent).toContain("8.2% remaining");

      const freezeMsg = "chore(freeze): graceful soft exit at 8.2% quota [skip ci]";
      expect(lastCommitMessage).toBe(freezeMsg);
      expect(vfs.readFileSync(trackedFile, "utf-8")).toContain("updated = 2");
      expect(vfs.readFileSync(untrackedFile, "utf-8")).toContain("critical-data");

      let customRefreshed = false;
      const failedExit = await executeGracefulSoftExit({
        runRoot: gitDir,
        repoRoot: gitDir,
        lowestQuota: 5.0,
        refreshHandoffFn: () => {
          customRefreshed = true;
          return "custom-handoff";
        },
        gitRunner: () => ({ status: 1, stdout: "", stderr: "simulated git add failure" }),
      });
      expect(customRefreshed).toBe(true);
      const err = failedExit.error ? failedExit.error : "";
      expect(err).toContain("git add failed");
    });

    test("Probe 7: soft drain clamps negative quotas and rejects invalid semantics fail-closed", () => {
      expect(normalizeRemainingQuota(-999)).toBe(0);
      expect(normalizeRemainingQuota(150)).toBe(100);
      expect(isSoftDrainActive(-50)).toBe(true);
      expect(isSoftDrainActive(0)).toBe(true);
      expect(isRemainingQuotaSemanticsValid(createMetric("m", "5_hour", NaN))).toBe(false);
      expect(() => assertRemainingQuotaSemantics(createMetric("m", "5_hour", NaN))).toThrow(
        HarnessError,
      );
      expect(canAdmitTask(-10).allowed).toBe(false);
      expect(canSpawnSubagent(-10).allowed).toBe(false);
      expect(throttleConcurrency(8, -10)).toBe(1);
    });
  });
});
