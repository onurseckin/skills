import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  factoryPreplanCommand,
  factoryStatusCommand,
  formatFactoryPreplanBrief,
  formatFactoryStatusBrief,
} from "../../../../../olt/scripts/src/cli/commands/factory-ops.ts";

describe("CLI Operations for Pre-Planning & Assembly Stations (Task 4.1)", () => {
  it("formats factory preplan brief and factory status brief cleanly in markdown", () => {
    const mockPreplanResult = {
      clusters: [
        {
          cluster_id: "cluster-mind-123",
          domain: "mind" as const,
          title: "Mind Cluster",
          plan_path: "docs/planning/cluster-mind-123/PLAN.md",
          backlog_item_ids: ["item-1"],
          defect_ids: ["def-1"],
          planned_at: "2026-08-29T10:00:00Z",
        },
      ],
      items_planned: 1,
      defects_planned: 1,
      plan_files_written: ["docs/planning/cluster-mind-123/PLAN.md"],
      started_at: "2026-08-29T10:00:00Z",
      completed_at: "2026-08-29T10:00:01Z",
      duration_ms: 1000,
    };

    const brief = formatFactoryPreplanBrief(mockPreplanResult);
    expect(brief).toContain("Continuous Pre-Planning Factory Run Summary");
    expect(brief).toContain("Clusters Created**: 1");
    expect(brief).toContain("docs/planning/cluster-mind-123/PLAN.md");

    const statusBrief = formatFactoryStatusBrief({
      pending_backlog: 2,
      open_defects: 1,
      is_stagnant: false,
      is_concurrency_saturated: true,
      preplanning_needed: true,
      findings: ["All systems operational"],
    });

    expect(statusBrief).toContain("Factory Engine & Assembly Pipeline Status");
    expect(statusBrief).toContain("Pending Backlog Items**: 2");
    expect(statusBrief).toContain("Pre-Planning Needed**: YES");
    expect(statusBrief).toContain("All systems operational");
  });

  it("executes factoryPreplanCommand and generates plans on workspace", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "factory-cli-test-"));
    try {
      const oltDir = join(tempDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const backlogFile = join(oltDir, "backlog.jsonl");
      const defectsFile = join(oltDir, "defects.jsonl");

      writeFileSync(
        backlogFile,
        JSON.stringify({
          id: "fb-cli-1",
          title: "Implement CLI factory commands",
          category: "tooling",
          status: "PENDING",
        }) + "\n",
      );
      writeFileSync(defectsFile, "");

      const res = factoryPreplanCommand({ root: tempDir });
      expect(res.result.clusters.length).toBe(1);
      expect(res.result.items_planned).toBe(1);
      expect(res.markdown).toContain("Clusters Created**: 1");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("executes factoryStatusCommand and reports accurate queue and audit metrics", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "factory-status-test-"));
    try {
      const oltDir = join(tempDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const backlogFile = join(oltDir, "backlog.jsonl");
      const defectsFile = join(oltDir, "defects.jsonl");

      writeFileSync(
        backlogFile,
        JSON.stringify({
          id: "fb-open-1",
          title: "Open feedback item",
          category: "core",
          status: "PENDING",
        }) + "\n",
      );
      writeFileSync(defectsFile, "");

      const res = factoryStatusCommand({ root: tempDir });
      expect(res.status.pending_backlog).toBe(1);
      expect(res.status.open_defects).toBe(0);
      expect(res.status.preplanning_needed).toBe(true);
      expect(res.markdown).toContain("Factory Engine & Assembly Pipeline Status");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
