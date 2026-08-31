import { describe, expect, it } from "bun:test";
import {
  formatDagSnapshotMarkdown,
  formatDagResumeMarkdown,
  STANDARD_SUPERVISORY_CRONS,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import type { CircuitBreakerEvaluation } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { resolveQuotaDagSnapshotPath } from "../../../olt/scripts/src/core/shared/paths.ts";

describe("DAG Snapshot Markdown Formatting & Path Resolution", () => {
  const snapshot: QuotaDagSnapshot = {
    version: "2",
    repositoryRoot: "/fake/repo",
    runRoot: "/fake/run",
    frozenAt: "2024-01-01T00:00:00Z",
    status: "frozen",
    tasks: [{ id: "t1", status: "running", effortMath: "1 Work", dependencies: [] }],
    agents: [],
    cronsSuspended: [],
    uncommittedFiles: ["src/index.ts"],
    lowestQuotaObserved: 2,
    constrainedModels: ["gemini-pro"],
    autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
  };

  const evaluation: CircuitBreakerEvaluation = {
    status: "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
    isTriggered: true,
    thresholdPercentage: 10,
    lowestRemainingQuota: 2,
    constrainedModels: [
      { platformId: "antigravity", modelName: "gemini-pro", remainingPercentage: 2 },
    ],
    wrapUpDirectives: [],
    autoWakeSchedule: null,
    summary: "Constrained",
    evaluatedAt: "2024-01-01T00:00:00Z",
  };

  it("should format snapshot summary", () => {
    const md = formatDagSnapshotMarkdown(snapshot, evaluation, false);
    expect(md).toContain("Quota DAG Snapshot");
    expect(md).toContain("frozen");
    expect(md).toContain("gemini-pro");
    expect(md).not.toContain("src/index.ts");
  });

  it("should format detailed snapshot", () => {
    const md = formatDagSnapshotMarkdown(snapshot, evaluation, true);
    expect(md).toContain("src/index.ts");
    expect(md).toContain("1 Work");
  });

  it("should format resume summary", () => {
    const result = {
      restoredWaveLanes: ["lane-1"],
      cronsToReRegister: STANDARD_SUPERVISORY_CRONS,
      resumeDirectives: ["Directive 1"],
    };

    const md = formatDagResumeMarkdown(result, true);
    expect(md).toContain("DAG Resume State");
    expect(md).toContain("lane-1");
    expect(md).toContain("Directive 1");
  });

  describe("resolveQuotaDagSnapshotPath", () => {
    it("should resolve relative to repoRoot", () => {
      const resolved = resolveQuotaDagSnapshotPath("/repo");
      expect(resolved.replace(/\\/g, "/")).toContain("/repo/.olt/quota-dag-snapshot.json");
    });

    it("should prefer customPath", () => {
      const resolved = resolveQuotaDagSnapshotPath("/repo", "/custom/path.json");
      expect(resolved.replace(/\\/g, "/")).toBe("/custom/path.json");
    });
  });
});
