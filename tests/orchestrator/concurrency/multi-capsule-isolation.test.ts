import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  TrueMultiCapsuleOrchestrator,
  type CapsuleExecutionInput,
  type CapsuleExecutionResult,
  type CapsuleExecutor,
  type CapsuleSpec,
  type CapsuleStateChangeEvent,
  type MultiCapsuleSummary,
} from "../../../olt/scripts/src/orchestrator/multi-capsule.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("True Multi-Capsule Parallel Execution Engine & Isolation", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | undefined;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(process.cwd(), { recursive: true });
    vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = undefined;
    }
  });
  it("executes independent capsules in true parallel concurrency", async () => {
    const testDir = "/tmp/orchestrator-mc-parallel";
    const activeExecutions: string[] = [];
    let maxSimultaneous = 0;

    const mockExecutor: CapsuleExecutor = {
      async executeCapsule(input: CapsuleExecutionInput): Promise<CapsuleExecutionResult> {
        activeExecutions.push(input.spec.id);
        if (activeExecutions.length > maxSimultaneous) {
          maxSimultaneous = activeExecutions.length;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 80));

        const index = activeExecutions.indexOf(input.spec.id);
        if (index !== -1) {
          activeExecutions.splice(index, 1);
        }

        return {
          capsuleId: input.spec.id,
          status: "converged",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 80,
          gatePassed: true,
          findingsCount: 0,
          summary: `Capsule ${input.spec.id} converged cleanly in parallel`,
        };
      },
    };

    const stateTransitions: CapsuleStateChangeEvent[] = [];
    const orchestrator = new TrueMultiCapsuleOrchestrator({
      maxParallelCapsules: 3,
      executor: mockExecutor,
      outputDir: join(testDir, "output"),
      onCapsuleStateChange: (evt) => stateTransitions.push(evt),
    });

    const specs: CapsuleSpec[] = [
      { id: "capsule-lane-a", repoPath: testDir, writeScope: ["src/lane-a/"] },
      { id: "capsule-lane-b", repoPath: testDir, writeScope: ["src/lane-b/"] },
      { id: "capsule-lane-c", repoPath: testDir, writeScope: ["src/lane-c/"] },
    ];

    const start = Date.now();
    const summary = await orchestrator.orchestrate(specs);
    const totalElapsed = Date.now() - start;

    expect(summary.totalCapsules).toBe(3);
    expect(summary.convergedCount).toBe(3);
    expect(summary.failedCount).toBe(0);
    expect(summary.overallStatus).toBe("converged");
    expect(maxSimultaneous).toBeGreaterThanOrEqual(2);
    expect(totalElapsed).toBeLessThan(220);

    expect(summary.results["capsule-lane-a"]?.status).toBe("converged");
    expect(summary.results["capsule-lane-b"]?.status).toBe("converged");
    expect(summary.results["capsule-lane-c"]?.status).toBe("converged");

    const summaryJson = join(testDir, "output", "multi-capsule-summary.json");
    const summaryMd = join(testDir, "output", "multi-capsule-summary.md");
    expect(fs.existsSync(summaryJson)).toBe(true);
    expect(fs.existsSync(summaryMd)).toBe(true);

    const loadedSummary = JSON.parse(fs.readFileSync(summaryJson, "utf-8")) as MultiCapsuleSummary;
    expect(loadedSummary.totalCapsules).toBe(3);
    expect(loadedSummary.convergedCount).toBe(3);
  });

  it("respects maxParallelCapsules concurrency limit", async () => {
    const testDir = "/tmp/orchestrator-mc-limit";
    let currentActive = 0;
    let peakConcurrency = 0;

    const mockExecutor: CapsuleExecutor = {
      async executeCapsule(input: CapsuleExecutionInput): Promise<CapsuleExecutionResult> {
        currentActive++;
        if (currentActive > peakConcurrency) {
          peakConcurrency = currentActive;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        currentActive--;

        return {
          capsuleId: input.spec.id,
          status: "converged",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 50,
          gatePassed: true,
        };
      },
    };

    const orchestrator = new TrueMultiCapsuleOrchestrator({
      maxParallelCapsules: 2,
      executor: mockExecutor,
    });

    const specs: CapsuleSpec[] = [
      { id: "c1", repoPath: testDir, writeScope: ["src/1/"] },
      { id: "c2", repoPath: testDir, writeScope: ["src/2/"] },
      { id: "c3", repoPath: testDir, writeScope: ["src/3/"] },
      { id: "c4", repoPath: testDir, writeScope: ["src/4/"] },
    ];

    const summary = await orchestrator.orchestrate(specs);

    expect(summary.totalCapsules).toBe(4);
    expect(summary.convergedCount).toBe(4);
    expect(peakConcurrency).toBeLessThanOrEqual(2);
    expect(peakConcurrency).toBe(2);
  });

  it("handles failure isolation where independent capsules succeed while dependents are blocked", async () => {
    const testDir = "/tmp/orchestrator-mc-failure";

    const mockExecutor: CapsuleExecutor = {
      async executeCapsule(input: CapsuleExecutionInput): Promise<CapsuleExecutionResult> {
        if (input.spec.id === "failing-root") {
          throw new Error("Critical compilation error in root capsule");
        }
        return {
          capsuleId: input.spec.id,
          status: "converged",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 30,
          gatePassed: true,
        };
      },
    };

    const orchestrator = new TrueMultiCapsuleOrchestrator({
      maxParallelCapsules: 3,
      executor: mockExecutor,
    });

    const specs: CapsuleSpec[] = [
      { id: "failing-root", repoPath: testDir, writeScope: ["src/failing/"] },
      {
        id: "dependent-child",
        repoPath: testDir,
        writeScope: ["src/dep/"],
        dependencies: ["failing-root"],
      },
      { id: "independent-lane", repoPath: testDir, writeScope: ["src/independent/"] },
    ];

    const summary = await orchestrator.orchestrate(specs);

    expect(summary.totalCapsules).toBe(3);
    expect(summary.convergedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
    expect(summary.overallStatus).toBe("partial");

    expect(summary.results["failing-root"]?.status).toBe("failed");
    expect(summary.results["dependent-child"]?.status).toBe("blocked");
    expect(summary.results["independent-lane"]?.status).toBe("converged");
  });

  it("enforces strict anti-sequentiality option by throwing HarnessError if violations present", async () => {
    const testDir = "/tmp/orchestrator-mc-strict";
    vfs.mkdirSync(join(testDir, ".git"), { recursive: true });
    vfs.writeFileSync(join(testDir, "package.json"), "{}");
    const orchestrator = new TrueMultiCapsuleOrchestrator({
      strictAntiSequentiality: true,
      allowScopeOverlapInIsolatedWorktrees: false,
    });

    const collidingSpecs: CapsuleSpec[] = [
      { id: "cap-x", repoPath: testDir, writeScope: ["src/common.ts"] },
      { id: "cap-y", repoPath: testDir, writeScope: ["src/common.ts"] },
    ];

    await expect(orchestrator.orchestrate(collidingSpecs)).rejects.toThrow(HarnessError);
    await expect(orchestrator.orchestrate(collidingSpecs)).rejects.toThrow(
      "Strict Anti-Sequentiality violation",
    );
  });

  it("verifies zero TypeScript any and zero suppressions across all multi-capsule source and test files", () => {
    const pathsToCheck = [
      join(import.meta.dir, "../../../olt/scripts/src/orchestrator/multi-capsule.ts"),
      import.meta.path,
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of pathsToCheck) {
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
