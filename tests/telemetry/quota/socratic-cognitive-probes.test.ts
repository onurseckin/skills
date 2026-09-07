import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import {
  assertRemainingQuotaSemantics,
  canAdmitTask,
  canSpawnSubagent,
  isRemainingQuotaSemanticsValid,
  isSoftDrainActive,
  normalizeRemainingQuota,
  throttleConcurrency,
  usageToRemainingHeadroom,
  type NormalizedQuotaMetric,
} from "../../../olt/scripts/src/telemetry/index.ts";
import {
  calculateBrentConcurrency,
  calculateBrentDecomposition,
} from "../../../olt/scripts/src/orchestrator/concurrency/brent-scaling.ts";
import { mindAdmitCommand } from "../../../olt/scripts/src/cli/commands/mind-admit.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

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
});
