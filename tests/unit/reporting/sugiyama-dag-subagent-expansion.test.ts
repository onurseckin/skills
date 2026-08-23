import { describe, expect, it } from "bun:test";
import {
  formatCoordinates,
  formatStatusBadge,
  formatSubagentAllocation,
  getStatusBadge,
  getStatusGlyph,
  renderRoundedNodeBox,
  renderSugiyamaDag,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../../../olt/scripts/src/reporting/sugiyama-dag.ts";
import {
  dynamicDagStateToSugiyama,
  renderBranchExpansionHierarchy,
  renderDynamicDagView,
  renderSubagentRelationship,
} from "../../../olt/scripts/src/reporting/dag-view.ts";
import {
  buildDynamicDagState,
  renderDynamicDagAscii,
} from "../../../olt/scripts/src/reporting/living-tracer.ts";
import type { HarnessEvent } from "../../../olt/scripts/src/contracts/capsule.ts";

function createMockEvent(
  sequence: number,
  kind: string,
  actor: string,
  payload: Record<string, unknown> = {},
): HarnessEvent {
  return {
    schema: "harness.event",
    version: 1,
    run_id: "test-expansion-run",
    capsule_id: "capsule-p44",
    sequence,
    revision: 1,
    timestamp: "2026-08-22T03:00:00.000Z",
    actor,
    kind,
    payload,
    previous_hash: null,
    projection: null,
    hash: `hash_${sequence}`,
  };
}

describe("Dynamic DAG Subagent Relationship & Live Branch Expansion Visualizer (p44)", () => {
  describe("Active Subagent Allocation Rendering", () => {
    it("renders paired implementer and validator subagent allocations inside node box", () => {
      const task: SugiyamaNode = {
        id: "task-core-engine",
        label: "Engine Implementation",
        status: "active",
        dependencies: [],
        assignedAgent: "impl-lead",
        assignedRole: "implementer",
        validatorAgent: "val-adversary",
        coordinates: { wave: 1, lane: 1 },
      };

      const boxLines = renderRoundedNodeBox(task, { boxStyle: "rounded" });
      const boxText = boxLines.join("\n");

      // Verify subagent allocation line
      expect(boxText).toContain("[● IMPLEMENTER: impl-lead ──► VALIDATOR: val-adversary]");
      expect(boxText).toContain("Coordinates: [W1:L1]");
      expect(boxLines[0]!.startsWith("╭")).toBeTrue();
      expect(boxLines[boxLines.length - 1]!.startsWith("╰")).toBeTrue();
    });

    it("renders role-specific subagent allocation for repairer and validator", () => {
      const task: SugiyamaNode = {
        id: "task-repair-r2",
        label: "Repair Engine Logic",
        status: "repairing",
        dependencies: ["task-core-engine"],
        assignedAgent: "repairer-01",
        assignedRole: "repairer",
        validatorId: "critic-verifier",
        round: 2,
        coordinates: "[W2:L1]",
      };

      const boxLines = renderRoundedNodeBox(task, { boxStyle: "rounded" });
      const boxText = boxLines.join("\n");

      expect(boxText).toContain("[● REPAIRER: repairer-01 ──► VALIDATOR: critic-verifier]");
      expect(boxText).toContain("Repair Round: R2 (⟳ REPAIRING)");
      expect(boxText).toContain("Coordinates: [W2:L1]");
    });

    it("renders single subagent allocation when only implementer or validator is assigned", () => {
      const implOnly: SugiyamaNode = {
        id: "task-impl-only",
        label: "Implement Only",
        status: "leased",
        dependencies: [],
        assignedAgent: "worker-alpha",
        assignedRole: "implementer",
      };
      const boxImpl = renderRoundedNodeBox(implOnly).join("\n");
      expect(boxImpl).toContain("[● IMPLEMENTER: worker-alpha]");

      const valOnly: SugiyamaNode = {
        id: "task-val-only",
        label: "Validate Only",
        status: "validating",
        dependencies: [],
        validatorAgent: "verifier-beta",
      };
      const boxVal = renderRoundedNodeBox(valOnly).join("\n");
      expect(boxVal).toContain("[● VALIDATOR: verifier-beta]");
    });

    it("formats subagent relationship pairs via helper functions", () => {
      const formatted = formatSubagentAllocation("agent-x", "agent-y", "implementer");
      expect(formatted).toBe("[● IMPLEMENTER: agent-x ──► VALIDATOR: agent-y]");

      const rendered = renderSubagentRelationship("worker-1", "validator-1");
      expect(rendered).toBe("[● IMPLEMENTER: worker-1 ──► VALIDATOR: validator-1]");

      expect(formatSubagentAllocation("worker-1", null)).toBe("[● IMPLEMENTER: worker-1]");
      expect(formatSubagentAllocation(null, "val-1")).toBe("[● VALIDATOR: val-1]");
      expect(formatSubagentAllocation(null, null)).toBe("");
    });
  });

  describe("Status Badges & Active Coordinates", () => {
    it("formats status badges across all lifecycle variants", () => {
      expect(formatStatusBadge("active")).toBe("[● ACTIVE]");
      expect(formatStatusBadge("running")).toBe("[● ACTIVE]");
      expect(formatStatusBadge("leased")).toBe("[● ACTIVE]");
      expect(formatStatusBadge("pass")).toBe("[✓ PASS]");
      expect(formatStatusBadge("done")).toBe("[✓ PASS]");
      expect(formatStatusBadge("satisfied")).toBe("[✓ PASS]");
      expect(formatStatusBadge("passed")).toBe("[✓ PASS]");
      expect(formatStatusBadge("ready")).toBe("[○ READY]");
      expect(formatStatusBadge("repairing")).toBe("[⟳ REPAIRING]");
      expect(formatStatusBadge("repair")).toBe("[⟳ REPAIRING]");
      expect(formatStatusBadge("changes_requested")).toBe("[⟳ REPAIRING]");
      expect(formatStatusBadge("probing")).toBe("[🔍 PROBING]");
      expect(formatStatusBadge("probe")).toBe("[🔍 PROBING]");
      expect(formatStatusBadge("validating")).toBe("[🔄 VALIDATING]");
      expect(formatStatusBadge("validated")).toBe("[🟣 VALIDATED]");
      expect(formatStatusBadge("failed")).toBe("[❌ REJECTED]");
      expect(formatStatusBadge("escalated")).toBe("[🚨 ESCALATED]");
      expect(formatStatusBadge("blocked")).toBe("[⏳ BLOCKED]");
    });

    it("formats coordinates cleanly from object and string descriptors", () => {
      expect(formatCoordinates({ wave: 1, lane: 2 })).toBe("[W1:L2]");
      expect(formatCoordinates({ rank: 0, order: 0 })).toBe("[W1:L1]");
      expect(formatCoordinates("[W3:L4]")).toBe("[W3:L4]");
      expect(formatCoordinates("W2:L1")).toBe("[W2:L1]");
      expect(formatCoordinates(null, 2, 3)).toBe("[W2:L3]");
    });

    it("renders probing state with probe round indicators", () => {
      const probeNode: SugiyamaNode = {
        id: "task-probe-01",
        label: "Investigate Stale Lease Flake",
        status: "probing",
        dependencies: [],
        assignedAgent: "probe-agent",
        probeRound: 1,
      };

      const box = renderRoundedNodeBox(probeNode).join("\n");
      expect(box).toContain("Probe Round: P1 (🔍 PROBING)");
      expect(box).toContain("task-probe-01");
    });
  });

  describe("Dynamically Expanded Branch Sub-tasks & Live Relationship Arrows", () => {
    it("renders dynamically expanded branch subtasks with live relationship arrows in node box", () => {
      const parentTask: SugiyamaNode = {
        id: "parent-task-1",
        label: "Parent Coordinator Task",
        status: "active",
        dependencies: [],
        branchId: "branch-feature-expansion",
        coordinates: { wave: 1, lane: 1 },
        expandedSubtasks: [
          {
            id: "subtask-1a",
            label: "Subtask 1A Auth",
            status: "active",
            assignedAgent: "sub-impl-1",
            validatorAgent: "sub-val-1",
            role: "implementer",
          },
          {
            id: "subtask-1b",
            label: "Subtask 1B Storage",
            status: "ready",
            role: "implementer",
          },
          {
            id: "subtask-1c",
            label: "Subtask 1C Review",
            status: "probing",
            assignedAgent: "probe-investigator",
            role: "investigator",
          },
        ],
      };

      const boxLines = renderRoundedNodeBox(parentTask);
      const boxText = boxLines.join("\n");

      expect(boxText).toContain("↳ Dynamic Branch [branch-feature-expansion] (3 sub-tasks):");
      expect(boxText).toContain(
        "  ├──► [subtask-1a] [● ACTIVE] [● IMPLEMENTER: sub-impl-1 ──► VALIDATOR: sub-val-1]",
      );
      expect(boxText).toContain("  ├──► [subtask-1b] [○ READY]");
      expect(boxText).toContain(
        "  └──► [subtask-1c] [🔍 PROBING] [● INVESTIGATOR: probe-investigator]",
      );
    });

    it("renders branch expansion hierarchy using renderBranchExpansionHierarchy helper", () => {
      const subtasks = [
        {
          id: "branch-sub-1",
          status: "active",
          assignedAgent: "impl-a",
          validatorAgent: "val-a",
        },
        {
          id: "branch-sub-2",
          status: "ready",
        },
      ];

      const lines = renderBranchExpansionHierarchy("parent-1", subtasks, {
        branchId: "branch-exp-01",
      });

      expect(lines[0]).toBe("↳ Dynamic Branch [branch-exp-01] (2 sub-tasks):");
      expect(lines[1]).toContain(
        "  ├──► [branch-sub-1] [● ACTIVE] [● IMPLEMENTER: impl-a ──► VALIDATOR: val-a]",
      );
      expect(lines[2]).toContain("  └──► [branch-sub-2] [○ READY]");
    });
  });

  describe("Sugiyama Execution Subgraphs & Dynamic DAG View", () => {
    it("renders active execution subgraph header when active nodes are present", () => {
      const nodes: SugiyamaNode[] = [
        {
          id: "task-root",
          label: "Root Setup",
          status: "done",
          dependencies: [],
        },
        {
          id: "task-lane-1",
          label: "Lane 1 Processing",
          status: "active",
          dependencies: ["task-root"],
          assignedAgent: "agent-alpha",
          validatorAgent: "agent-val-alpha",
        },
        {
          id: "task-lane-2",
          label: "Lane 2 Processing",
          status: "running",
          dependencies: ["task-root"],
          assignedAgent: "agent-beta",
        },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "task-root", to: "task-lane-1" },
        { from: "task-root", to: "task-lane-2" },
      ];

      const report = renderSugiyamaDag(nodes, edges);
      expect(report.renderedDag).toContain("⚡ [ACTIVE EXECUTION SUBGRAPH]");
      expect(report.renderedDag).toContain("task-lane-1");
      expect(report.renderedDag).toContain(
        "[● IMPLEMENTER: agent-alpha ──► VALIDATOR: agent-val-alpha]",
      );
      expect(report.renderedDag).toContain("task-lane-2");
    });

    it("renders dynamic DAG view from telemetry dynamic state", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", {
          task_id: "dyn-task-1",
          label: "Initial Task",
          dependencies: [],
          coordinates: { wave: 1, lane: 1 },
        }),
        createMockEvent(2, "task-claimed", "impl-1", {
          task_id: "dyn-task-1",
          role: "implementer",
          validator_id: "val-1",
        }),
        createMockEvent(3, "begin-validation", "val-1", {
          task_id: "dyn-task-1",
        }),
        createMockEvent(4, "dynamic-expansion", "coordinator-1", {
          task_id: "dyn-child-1",
          label: "Child Subtask",
          dependencies: ["dyn-task-1"],
          parent_task_id: "dyn-task-1",
          coordinates: { wave: 2, lane: 1 },
        }),
      ];

      const dynamicDagState = buildDynamicDagState(events, "test-p44-dyn");
      const { nodes, edges } = dynamicDagStateToSugiyama(dynamicDagState);

      expect(nodes.length).toBe(2);
      expect(edges.length).toBe(1);

      const report = renderDynamicDagView(dynamicDagState, { detailed: true });
      expect(report.markdown).toContain("Sugiyama Hierarchical DAG Visualization");
      expect(report.renderedDag).toContain("dyn-task-1");
      expect(report.renderedDag).toContain("dyn-child-1");
    });

    it("renders sharp and ascii styles with subagent allocations", () => {
      const task: SugiyamaNode = {
        id: "sharp-task",
        label: "Sharp Style Task",
        status: "active",
        dependencies: [],
        assignedAgent: "agent-1",
        validatorAgent: "val-1",
      };

      const sharp = renderRoundedNodeBox(task, { boxStyle: "sharp" });
      expect(sharp[0]!.startsWith("┌")).toBeTrue();
      expect(sharp.join("\n")).toContain("[● IMPLEMENTER: agent-1 ──► VALIDATOR: val-1]");

      const ascii = renderRoundedNodeBox(task, { boxStyle: "ascii" });
      expect(ascii[0]!.startsWith("+")).toBeTrue();
      expect(ascii.join("\n")).toContain("[● IMPLEMENTER: agent-1 ──► VALIDATOR: val-1]");
    });
  });

  describe("Living Tracer Dynamic DAG ASCII Integration", () => {
    it("renders subagent allocations and dynamically sprouted repair branches with relationship arrows", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coord", {
          task_id: "task-auth",
          label: "Auth Token Service",
        }),
        createMockEvent(2, "task-claimed", "impl-alice", {
          task_id: "task-auth",
          role: "implementer",
          validator_id: "val-bob",
        }),
        createMockEvent(3, "begin-validation", "val-bob", {
          task_id: "task-auth",
        }),
        createMockEvent(4, "task-rejected", "val-bob", {
          task_id: "task-auth",
          reason: "JWT secret rotation policy missing",
        }),
      ];

      const state = buildDynamicDagState(events, "tracer-run");
      const asciiDag = renderDynamicDagAscii(state);

      expect(asciiDag).toContain("[task-auth] [❌ REJECTED - R1]");
      expect(asciiDag).toContain("├──► [task-auth-repair-r2] [⏳ READY - R2 Repair]");
      expect(asciiDag).toContain("└──► [val-task-auth-r2] [⏳ PROPOSED - R2 Validator]");
    });
  });

  describe("Invariants & View-Layer Isolation", () => {
    it("strictly preserves input immutability and never mutates underlying graph state", () => {
      const frozenNode: SugiyamaNode = Object.freeze({
        id: "immutable-task",
        label: "Frozen Node",
        status: "active",
        dependencies: Object.freeze(["dep-1"]) as readonly string[],
        assignedAgent: "agent-locked",
        validatorAgent: "val-locked",
        coordinates: Object.freeze({ wave: 1, lane: 1 }),
      });
      const frozenEdge: SugiyamaEdge = Object.freeze({
        from: "dep-1",
        to: "immutable-task",
      });

      // Rendering should execute without mutating frozen objects
      const boxLines = renderRoundedNodeBox(frozenNode);
      expect(boxLines.length).toBeGreaterThan(0);

      const report = renderSugiyamaDag([frozenNode], [frozenEdge]);
      expect(report.rankedNodes.length).toBe(1);
      expect(frozenNode.id).toBe("immutable-task");
    });
  });
});
