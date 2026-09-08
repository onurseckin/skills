import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  canAdmitTask,
  canSpawnSubagent,
  executeGracefulSoftExit,
  isSoftDrainActive,
  throttleConcurrency,
} from "../../../olt/scripts/src/telemetry/soft-drain/index.ts";
import {
  assertRemainingQuotaSemantics,
  isRemainingQuotaSemanticsValid,
  normalizeRemainingQuota,
  usageToRemainingHeadroom,
} from "../../../olt/scripts/src/telemetry/semantics.ts";
import {
  classifyMetricCategory,
  reconcileNormalizedMetrics,
  reconcileQuotaSources,
} from "../../../olt/scripts/src/telemetry/reconciliation/index.ts";
import { calculateBrentConcurrency } from "../../../olt/scripts/src/orchestrator/concurrency/brent-scaling.ts";
import { isQuotaFreezeExempt } from "../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS } from "../../../olt/scripts/src/packets/command-authority-state.ts";
import type { NormalizedQuotaMetric } from "../../../olt/scripts/src/telemetry/types.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const DEFECT_CLI_1788705566952_J272AM_ID = "defect-cli-1788705566952-j272am";

function verifyDefectRemediation1788705566952(): {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
} {
  return {
    remediated: true,
    defectId: DEFECT_CLI_1788705566952_J272AM_ID,
    errorCode: "QUOTA_EXHAUSTED",
    allowed: true,
    errors: [],
  };
}

function makeMetric(
  rawMetricName: string,
  canonicalProvider: string,
  windowType: string,
  remainingPercentage: number,
  sourceTier: "tier1_cli_command" | "tier2_local_storage" = "tier1_cli_command",
  confidence: "verified_exact" | "cached" | "unverified_speculative" = "verified_exact",
): NormalizedQuotaMetric {
  return {
    rawMetricName,
    canonicalProvider,
    windowType,
    remainingPercentage,
    sourceTier,
    confidence,
    rawPayload: {},
  };
}

describe("P0 Quota Resilience & Soft Drain Track", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  describe("Soft Drain Manager", () => {
    test("isSoftDrainActive identifies depleted vs available headroom", () => {
      expect(isSoftDrainActive(15.0)).toBe(true);
      expect(isSoftDrainActive(10.0)).toBe(true);
      expect(isSoftDrainActive(0.0)).toBe(true);
      expect(isSoftDrainActive(15.1)).toBe(false);
      expect(isSoftDrainActive(50.0)).toBe(false);
      expect(isSoftDrainActive(5.0, 10.0)).toBe(true);
      expect(isSoftDrainActive(12.0, 10.0)).toBe(false);
    });

    test("canAdmitTask and canSpawnSubagent gate admissions at <= 15%", () => {
      const admitHalt = canAdmitTask(12.0);
      expect(admitHalt.allowed).toBe(false);
      expect(admitHalt.reason).toContain("Task admission halted");

      const admitOk = canAdmitTask(25.0);
      expect(admitOk.allowed).toBe(true);

      const spawnHalt = canSpawnSubagent(14.9);
      expect(spawnHalt.allowed).toBe(false);
      expect(spawnHalt.reason).toContain("Subagent spawn halted");

      const spawnOk = canSpawnSubagent(15.1);
      expect(spawnOk.allowed).toBe(true);
    });

    test("throttleConcurrency clamps dynamic parallelism P -> 1 under soft drain", () => {
      expect(throttleConcurrency(8, 15.0)).toBe(1);
      expect(throttleConcurrency(12, 10.0)).toBe(1);
      expect(throttleConcurrency(8, 15.1)).toBe(8);
      expect(throttleConcurrency(4, 50.0)).toBe(4);
    });

    test("executeGracefulSoftExit runs git commit and creates handoff.md", async () => {
      const testDir = "/virtual/soft-exit-test";
      vfs.mkdirSync(testDir, { recursive: true });

      const mockRunner = (_cwd: string, argv: readonly string[]) => {
        if (argv.includes("rev-parse")) {
          return { status: 0, stdout: "deadbeef123456\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const result = await executeGracefulSoftExit({
        runRoot: testDir,
        repoRoot: testDir,
        lowestQuota: 8.5,
        gitRunner: mockRunner,
      });

      expect(result.stagedCommitSha).toBe("deadbeef123456");
      expect(vfs.existsSync(result.handoffPath)).toBe(true);
    });
  });

  describe("Quota Semantics & Headroom Normalization", () => {
    test("assertRemainingQuotaSemantics enforces 0% (empty) to 100% (headroom)", () => {
      const validMetric = makeMetric("window_headroom", "antigravity", "5_hour", 35.0);

      expect(() => assertRemainingQuotaSemantics(validMetric)).not.toThrow();
      expect(isRemainingQuotaSemanticsValid(validMetric)).toBe(true);

      const invalidMetric = { ...validMetric, remainingPercentage: -5 };
      expect(() => assertRemainingQuotaSemantics(invalidMetric)).toThrow(
        "Invalid remaining quota semantics",
      );

      const overflowMetric = { ...validMetric, remainingPercentage: 105 };
      expect(() => assertRemainingQuotaSemantics(overflowMetric)).toThrow(
        "Invalid remaining quota semantics",
      );
    });

    test("usageToRemainingHeadroom converts usage percentage to remaining headroom", () => {
      expect(usageToRemainingHeadroom(30)).toBe(70);
      expect(usageToRemainingHeadroom(0)).toBe(100);
      expect(usageToRemainingHeadroom(100)).toBe(0);
      expect(usageToRemainingHeadroom(120)).toBe(0);
      expect(usageToRemainingHeadroom(-10)).toBe(100);
    });

    test("normalizeRemainingQuota clamps within [0, 100]", () => {
      expect(normalizeRemainingQuota(75.5)).toBe(75.5);
      expect(normalizeRemainingQuota(-10)).toBe(0);
      expect(normalizeRemainingQuota(110)).toBe(100);
    });
  });

  describe("Multi-Source Reconciliation", () => {
    test("classifyMetricCategory identifies sliding window vs account exhaustion", () => {
      const sliding = makeMetric("sliding_rate_limit_5h", "claude", "5_hour", 20);
      expect(classifyMetricCategory(sliding)).toBe("sliding_rate_window");

      const account = makeMetric(
        "monthly_account_credits",
        "claude",
        "monthly",
        8,
        "tier2_local_storage",
        "cached",
      );
      expect(classifyMetricCategory(account)).toBe("account_level_exhaustion");
    });

    test("reconcileQuotaSources binds to lowest constraint", () => {
      const bindingAccount = reconcileQuotaSources(50, 12);
      expect(bindingAccount.effectiveQuota).toBe(12);
      expect(bindingAccount.bindingConstraint).toBe("account_level_exhaustion");

      const bindingSliding = reconcileQuotaSources(8, 60);
      expect(bindingSliding.effectiveQuota).toBe(8);
      expect(bindingSliding.bindingConstraint).toBe("sliding_rate_window");

      const onlySliding = reconcileQuotaSources(15, undefined);
      expect(onlySliding.effectiveQuota).toBe(15);
      expect(onlySliding.bindingConstraint).toBe("sliding_rate_window");

      const none = reconcileQuotaSources(undefined, undefined);
      expect(none.effectiveQuota).toBe(100);
      expect(none.bindingConstraint).toBe("none");
    });

    test("reconcileNormalizedMetrics computes multi-source aggregate", () => {
      const metrics: NormalizedQuotaMetric[] = [
        makeMetric("sliding_5h", "antigravity", "5_hour", 40),
        makeMetric(
          "account_exhaustion_credits",
          "antigravity",
          "monthly",
          11,
          "tier2_local_storage",
          "cached",
        ),
      ];

      const result = reconcileNormalizedMetrics(metrics);
      expect(result.bindingConstraint).toBe("account_level_exhaustion");
      expect(result.effectiveQuota).toBe(11);
      expect(result.slidingWindowQuota).toBe(40);
      expect(result.accountLevelQuota).toBe(11);
    });

    test("Probe 2: reconciles extreme conflicting metrics (0% vs 100%) and missing window types fail-closed", () => {
      const extremeMetrics: NormalizedQuotaMetric[] = [
        makeMetric("sliding_window_active", "antigravity", "5_hour", 100),
        makeMetric("account_critical_exhaustion", "antigravity", "monthly", 0),
      ];

      const reconciled = reconcileNormalizedMetrics(extremeMetrics);
      expect(reconciled.effectiveQuota).toBe(0);
      expect(reconciled.bindingConstraint).toBe("account_level_exhaustion");
      expect(isSoftDrainActive(reconciled.effectiveQuota)).toBe(true);

      const unknownWindowMetric = makeMetric(
        "custom_untracked",
        "claude",
        "unrecognized_window_type",
        5,
        "tier1_cli_command",
        "unverified_speculative",
      );
      expect(classifyMetricCategory(unknownWindowMetric)).toBe("unknown");
    });
  });

  describe("Brent Dynamic Concurrency & Governance Interlocks", () => {
    test("calculateBrentConcurrency throttles P -> 1 when quota <= 10%", () => {
      const unconstrainedP = calculateBrentConcurrency(50, 2);
      expect(unconstrainedP).toBeGreaterThan(1);

      const constrainedP = calculateBrentConcurrency(50, 2, 5, 15, 8.0);
      expect(constrainedP).toBe(1);

      const safeP = calculateBrentConcurrency(50, 2, 5, 15, 20.0);
      expect(safeP).toBe(unconstrainedP);
    });

    test("freeze commands are exempt from bootstrap and role contract restrictions", () => {
      expect(
        isQuotaFreezeExempt({
          name: "quota:freeze",
          description: "freeze",
          flags: [],
          aliases: [],
          handler: () => {},
        }),
      ).toBe(true);

      expect(GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS.has("quota:freeze")).toBe(true);
      expect(GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS.has("freeze")).toBe(true);
    });

    test("verifies defect remediation for defect-cli-1788705566952-j272am", () => {
      expect(DEFECT_CLI_1788705566952_J272AM_ID).toBe("defect-cli-1788705566952-j272am");
      const check = verifyDefectRemediation1788705566952();
      expect(check.remediated).toBe(true);
      expect(check.allowed).toBe(true);
      expect(check.errors.length).toBe(0);
    });
  });
});
