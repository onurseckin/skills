import { describe, expect, it } from "bun:test";
import {
  formatNodeBadges,
  getNodeStatusGlyph,
  renderRoundedNodeBox,
  renderSugiyamaNodeBox,
} from "../../../../olt/scripts/src/reporting/sugiyama-dag/render-box.ts";
import {
  formatCoordinates,
  formatStatusBadge,
  formatSubagentAllocation,
  getStatusBadge,
  getStatusGlyph,
  renderSubagentExpandedItems,
} from "../../../../olt/scripts/src/reporting/sugiyama-dag/subagent-expansion.ts";
import type { SugiyamaNode } from "../../../../olt/scripts/src/reporting/sugiyama-dag/types.ts";

describe("sugiyama-dag-subagent-expansion-edge", () => {
  describe("getNodeStatusGlyph for lifecycle statuses", () => {
    it("returns correct glyph for completed/passed statuses", () => {
      expect(getNodeStatusGlyph("pass")).toBe("✓");
      expect(getNodeStatusGlyph("passed")).toBe("✓");
      expect(getNodeStatusGlyph("done")).toBe("✓");
      expect(getNodeStatusGlyph("satisfied")).toBe("✓");
      expect(getNodeStatusGlyph("completed")).toBe("✓");
    });

    it("returns correct glyph for running/active statuses", () => {
      expect(getNodeStatusGlyph("active")).toBe("●");
      expect(getNodeStatusGlyph("leased")).toBe("●");
      expect(getNodeStatusGlyph("running")).toBe("●");
      expect(getNodeStatusGlyph("in_progress")).toBe("●");
    });

    it("returns correct glyph for probing/investigating statuses", () => {
      expect(getNodeStatusGlyph("probing")).toBe("🔍");
      expect(getNodeStatusGlyph("probe")).toBe("🔍");
      expect(getNodeStatusGlyph("investigating")).toBe("🔍");
    });

    it("returns correct glyph for repairing/remediation statuses", () => {
      expect(getNodeStatusGlyph("repairing")).toBe("⟳");
      expect(getNodeStatusGlyph("repair")).toBe("⟳");
      expect(getNodeStatusGlyph("remediation")).toBe("⟳");
      expect(getNodeStatusGlyph("changes_requested")).toBe("⟳");
    });

    it("returns correct glyph for validating and validated statuses", () => {
      expect(getNodeStatusGlyph("validating")).toBe("🔄");
      expect(getNodeStatusGlyph("validated")).toBe("🟣");
    });

    it("returns correct glyph for ready and retry_ready statuses", () => {
      expect(getNodeStatusGlyph("ready")).toBe("○");
      expect(getNodeStatusGlyph("retry_ready")).toBe("○");
    });

    it("returns correct glyph for failure/rejection statuses", () => {
      expect(getNodeStatusGlyph("failed")).toBe("✗");
      expect(getNodeStatusGlyph("rejected")).toBe("✗");
      expect(getNodeStatusGlyph("escalated")).toBe("✗");
      expect(getNodeStatusGlyph("error")).toBe("✗");
    });

    it("returns correct glyph for draft and blocked/pending with dependencies", () => {
      expect(getNodeStatusGlyph("draft", true)).toBe("⏳");
      expect(getNodeStatusGlyph("draft", false)).toBe("○");
      expect(getNodeStatusGlyph("blocked")).toBe("⏳");
      expect(getNodeStatusGlyph("proposed")).toBe("⏳");
      expect(getNodeStatusGlyph("pending")).toBe("⏳");
      expect(getNodeStatusGlyph("unknown_status")).toBe("⏳");
    });
  });

  describe("formatNodeBadges", () => {
    it("formats default metrics when no agents or rounds assigned", () => {
      const task: SugiyamaNode = { id: "T1", label: "T1", status: "ready", dependencies: [] };
      expect(formatNodeBadges(task)).toBe("W:1 S:1");
    });

    it("formats role tags for implementer, validator, and coordinator", () => {
      const task: SugiyamaNode = {
        id: "T2",
        label: "Task 2",
        status: "active",
        dependencies: [],
        implementerAgent: "impl-42",
        validatorId: "val-99",
        coordinatorId: "coord-1",
      };
      expect(formatNodeBadges(task)).toBe("[I: impl-42] [V: val-99] [C: coord-1] W:1 S:1");
    });

    it("formats rounds tag with repair and probe rounds", () => {
      const taskBoth: SugiyamaNode = {
        id: "T3",
        label: "Task 3",
        status: "repairing",
        dependencies: [],
        round: 2,
        probeRound: 3,
        effort: 4,
        criticalDepth: 2,
      };
      expect(formatNodeBadges(taskBoth)).toBe("[R2 P3] W:4 S:3");

      const taskRepairOnly: SugiyamaNode = {
        id: "T3b",
        label: "T3b",
        status: "repairing",
        dependencies: [],
        round: 4,
      };
      expect(formatNodeBadges(taskRepairOnly)).toBe("[R4] W:1 S:1");

      const taskProbeOnly: SugiyamaNode = {
        id: "T3c",
        label: "T3c",
        status: "probing",
        dependencies: [],
        probeRound: 2,
      };
      expect(formatNodeBadges(taskProbeOnly)).toBe("[P2] W:1 S:1");
    });
  });

  describe("renderSugiyamaNodeBox styles and backward compatibility", () => {
    const sampleTask: SugiyamaNode = {
      id: "task-alpha",
      label: "Alpha Service",
      status: "completed",
      dependencies: [],
    };

    it("renders rounded box style by default", () => {
      const box = renderSugiyamaNodeBox(sampleTask);
      expect(box[0]?.startsWith("╭")).toBe(true);
      expect(box[0]?.endsWith("╮")).toBe(true);
      expect(box[box.length - 1]?.startsWith("╰")).toBe(true);
      expect(box[box.length - 1]?.endsWith("╯")).toBe(true);
      expect(box.some((line) => line.includes("task-alpha"))).toBe(true);
    });

    it("renders sharp box style when requested", () => {
      const box = renderSugiyamaNodeBox(sampleTask, { boxStyle: "sharp" });
      expect(box[0]?.startsWith("┌")).toBe(true);
      expect(box[0]?.endsWith("┐")).toBe(true);
      expect(box[box.length - 1]?.startsWith("└")).toBe(true);
      expect(box[box.length - 1]?.endsWith("┘")).toBe(true);
    });

    it("renders ascii box style when requested", () => {
      const box = renderSugiyamaNodeBox(sampleTask, { boxStyle: "ascii" });
      expect(box[0]?.startsWith("+")).toBe(true);
      expect(box[0]?.endsWith("+")).toBe(true);
      expect(box[box.length - 1]?.startsWith("+")).toBe(true);
      expect(box[box.length - 1]?.endsWith("+")).toBe(true);
      expect(box[1]?.startsWith("|")).toBe(true);
    });

    it("maintains renderRoundedNodeBox as backward-compatible wrapper", () => {
      const boxRounded = renderRoundedNodeBox(sampleTask);
      const boxSugiyama = renderSugiyamaNodeBox(sampleTask, { boxStyle: "rounded" });
      expect(boxRounded).toEqual(boxSugiyama);
    });
  });

  describe("Uniform box width guarantee", () => {
    it("ensures all lines within a rendered box have strictly identical width", () => {
      const complexTask: SugiyamaNode = {
        id: "task-heavy",
        label: "Heavy Computation & Distributed Consensus Engine",
        status: "leased",
        dependencies: ["dep-a", "dep-b"],
        assignedAgent: "worker-bob",
        validatorId: "validator-alice",
        coordinatorId: "coord-main",
        round: 2,
        probeRound: 1,
        effort: 8,
        criticalDepth: 3,
        writeScope: ["src/core", "src/network"],
        depReasons: { "dep-a": "Need schema", "dep-b": "Need auth" },
      };

      const box = renderSugiyamaNodeBox(complexTask);
      const expectedWidth = box[0]?.length ?? 0;
      expect(expectedWidth).toBeGreaterThan(0);
      for (const line of box) {
        expect(line.length).toBe(expectedWidth);
      }
    });

    it("enforces identical box width across multiple heterogeneous nodes with specified boxWidth", () => {
      const nodeA: SugiyamaNode = { id: "A", label: "A", status: "ready", dependencies: [] };
      const nodeB: SugiyamaNode = {
        id: "long-task-identifier-b",
        label: "Detailed Feature Label",
        status: "active",
        dependencies: ["A"],
        implementerAgent: "impl-1",
        validatorId: "val-1",
        coordinatorId: "coord-1",
      };

      const targetWidth = 85;
      const boxA = renderSugiyamaNodeBox(nodeA, { boxWidth: targetWidth });
      const boxB = renderSugiyamaNodeBox(nodeB, { boxWidth: targetWidth });

      expect(boxA[0]?.length).toBe(targetWidth);
      expect(boxB[0]?.length).toBe(targetWidth);
      for (const line of boxA) expect(line.length).toBe(targetWidth);
      for (const line of boxB) expect(line.length).toBe(targetWidth);
    });
  });

  describe("Dynamic subagent expansion trees inside node boxes", () => {
    it("renders hierarchical subtask tree with connectors and role allocations", () => {
      const parentTask: SugiyamaNode = {
        id: "task-parent",
        label: "Parent Orchestrator",
        status: "active",
        dependencies: [],
        branchId: "branch-omega",
        expandedSubtasks: [
          {
            id: "sub-1",
            label: "Sub 1",
            status: "passed",
            assignedAgent: "agent-a",
            role: "worker",
          },
          {
            id: "sub-2",
            label: "Sub 2",
            status: "validating",
            validatorId: "agent-v",
            role: "validator",
          },
          "plain-string-subtask-id",
        ],
      };

      const box = renderSugiyamaNodeBox(parentTask);
      const rendered = box.join("\n");
      expect(rendered).toContain("↳ Dynamic Branch [branch-omega] (3 sub-tasks):");
      expect(rendered).toContain("├──► [sub-1] [✓ PASS]");
      expect(rendered).toContain("├──► [sub-2] [🔄 VALIDATING]");
      expect(rendered).toContain("└──► [plain-string-subtask-id]");
    });

    it("handles multi-depth recursive subagent expansion", () => {
      const treeLines = renderSubagentExpandedItems([
        {
          id: "sub-level-1",
          status: "active",
          expandedSubtasks: [{ id: "sub-level-2", status: "ready" }],
        },
      ]);
      expect(treeLines.some((l) => l.includes("[sub-level-1]"))).toBe(true);
      expect(treeLines.some((l) => l.includes("[sub-level-2]"))).toBe(true);
    });
  });

  describe("Cycle and Bypass Diagnostics Badges", () => {
    const baseNode: SugiyamaNode = {
      id: "node-c",
      label: "Node C",
      status: "ready",
      dependencies: [],
    };

    it("renders cycle badge when isCycle is true", () => {
      const box = renderSugiyamaNodeBox(baseNode, { isCycle: true });
      expect(box.join("\n")).toContain("⚡[CYCLE]");
    });

    it("renders bypass badge when isBypass is true", () => {
      const box = renderSugiyamaNodeBox(baseNode, { isBypass: true });
      expect(box.join("\n")).toContain("❌[BYPASS]");
    });

    it("renders both badges when both are true", () => {
      const box = renderSugiyamaNodeBox(baseNode, { isCycle: true, isBypass: true });
      const rendered = box.join("\n");
      expect(rendered).toContain("⚡[CYCLE]");
      expect(rendered).toContain("❌[BYPASS]");
    });
  });
});
