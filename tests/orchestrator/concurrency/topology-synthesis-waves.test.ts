import { describe, expect, it } from "bun:test";
import {
  adaptTopologyWithCriticFeedback,
  partitionTopologyWaves,
  synthesizeDAGTopology,
  type CriticFeedbackAdjustment,
  type SynthesizedTaskSpec,
  type SynthesizedTopology,
} from "../../../olt/scripts/src/orchestrator/topology-synthesis.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Topology Synthesis Wave Partitioning & Critic Feedback", () => {
  describe("Wave Partitioning", () => {
    it("partitions independent tasks with disjoint scopes into single wave within capacity", () => {
      const tasks: SynthesizedTaskSpec[] = [
        { id: "t-1", writeScope: ["src/a.ts"], effort: 2 },
        { id: "t-2", writeScope: ["src/b.ts"], effort: 3 },
        { id: "t-3", writeScope: ["src/c.ts"], effort: 1 },
      ];

      const waves = partitionTopologyWaves(tasks, 4);
      expect(waves.length).toBe(1);
      expect(waves[0]?.wave).toBe(1);
      expect(waves[0]?.taskIds).toEqual(["t-1", "t-2", "t-3"]);
      expect(waves[0]?.estimatedEffort).toBe(6);
      expect(waves[0]?.writeScopes).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    });

    it("splits tasks exceeding maxParallel capacity across consecutive waves", () => {
      const tasks: SynthesizedTaskSpec[] = [
        { id: "t-1", writeScope: ["src/1.ts"] },
        { id: "t-2", writeScope: ["src/2.ts"] },
        { id: "t-3", writeScope: ["src/3.ts"] },
        { id: "t-4", writeScope: ["src/4.ts"] },
      ];

      const waves = partitionTopologyWaves(tasks, 2);
      expect(waves.length).toBe(2);
      expect(waves[0]?.taskIds.length).toBe(2);
      expect(waves[1]?.taskIds.length).toBe(2);
    });

    it("serializes tasks with colliding write scopes into distinct waves", () => {
      const tasks: SynthesizedTaskSpec[] = [
        { id: "t-1", writeScope: ["src/shared/config.ts"] },
        { id: "t-2", writeScope: ["src/shared/config.ts"] },
        { id: "t-3", writeScope: ["src/isolated.ts"] },
      ];

      const waves = partitionTopologyWaves(tasks, 4);
      expect(waves.length).toBe(2);
      expect(waves[0]?.taskIds).toContain("t-1");
      expect(waves[0]?.taskIds).toContain("t-3");
      expect(waves[1]?.taskIds).toEqual(["t-2"]);
    });

    it("preserves explicit dependency constraints across waves", () => {
      const tasks: SynthesizedTaskSpec[] = [
        { id: "t-core", writeScope: ["src/core.ts"] },
        { id: "t-service", writeScope: ["src/service.ts"], dependencies: ["t-core"] },
        { id: "t-api", writeScope: ["src/api.ts"], dependencies: ["t-service"] },
      ];

      const waves = partitionTopologyWaves(tasks, 4);
      expect(waves.length).toBe(3);
      expect(waves[0]?.taskIds).toEqual(["t-core"]);
      expect(waves[1]?.taskIds).toEqual(["t-service"]);
      expect(waves[2]?.taskIds).toEqual(["t-api"]);
      expect(waves[2]?.dependenciesSatisfied).toContain("t-core");
      expect(waves[2]?.dependenciesSatisfied).toContain("t-service");
    });

    it("handles empty task input gracefully", () => {
      expect(partitionTopologyWaves([])).toEqual([]);
    });
  });

  describe("Critic Feedback Adaptation", () => {
    function createBaseTopology(): SynthesizedTopology {
      return synthesizeDAGTopology({
        objective: "Core Framework",
        tasks: [
          { id: "t-core", writeScope: ["src/core.ts"], effort: 2 },
          { id: "t-plugin", writeScope: ["src/plugin.ts"], dependencies: ["t-core"], effort: 2 },
        ],
      });
    }

    it("returns approved revision when critic decision is 'approve'", () => {
      const base = createBaseTopology();
      const feedback: CriticFeedbackAdjustment = {
        feedbackId: "fb-01",
        roundNumber: 1,
        criticDecision: "approve",
        feedbackSummary: "All requirements proven and verified",
      };

      const adapted = adaptTopologyWithCriticFeedback(base, feedback);
      expect(adapted.revision).toBe(base.revision + 1);
      expect(adapted.metadata?.lastCriticDecision).toBe("approve");
      expect(adapted.metadata?.approvedRound).toBe(1);
    });

    it("adds new remediation tasks requested by critic feedback", () => {
      const base = createBaseTopology();
      const feedback: CriticFeedbackAdjustment = {
        feedbackId: "fb-02",
        roundNumber: 2,
        criticDecision: "request_changes",
        feedbackSummary: "Boundary edge case missing in plugin",
        newTasks: [
          {
            id: "t-plugin-repair",
            label: "Plugin boundary repair",
            writeScope: ["src/plugin-repair.ts"],
            dependencies: ["t-plugin"],
            effort: 1,
          },
        ],
      };

      const adapted = adaptTopologyWithCriticFeedback(base, feedback);
      expect(adapted.revision).toBe(2);
      expect(adapted.tasks.some((t) => t.id === "t-plugin-repair")).toBe(true);
      expect(adapted.waves.length).toBe(3);
      expect(adapted.waves[2]?.taskIds).toEqual(["t-plugin-repair"]);
    });

    it("decomposes parent tasks via splitTasks and rewires dependencies", () => {
      const base = createBaseTopology();
      const feedback: CriticFeedbackAdjustment = {
        feedbackId: "fb-03",
        roundNumber: 2,
        criticDecision: "request_changes",
        feedbackSummary: "Decompose monolithic core task",
        splitTasks: [
          {
            parentTaskId: "t-core",
            subTasks: [
              { id: "t-core-lexer", writeScope: ["src/core/lexer.ts"] },
              {
                id: "t-core-parser",
                writeScope: ["src/core/parser.ts"],
                dependencies: ["t-core-lexer"],
              },
            ],
          },
        ],
      };

      const adapted = adaptTopologyWithCriticFeedback(base, feedback);
      expect(adapted.tasks.some((t) => t.id === "t-core")).toBe(false);
      expect(adapted.tasks.some((t) => t.id === "t-core-lexer")).toBe(true);
      expect(adapted.tasks.some((t) => t.id === "t-core-parser")).toBe(true);

      const pluginTask = adapted.tasks.find((t) => t.id === "t-plugin");
      expect(pluginTask?.dependencies).toContain("t-core-lexer");
      expect(pluginTask?.dependencies).toContain("t-core-parser");
    });

    it("applies reordering rules and skill requirement enhancements", () => {
      const base = createBaseTopology();
      const feedback: CriticFeedbackAdjustment = {
        feedbackId: "fb-04",
        roundNumber: 2,
        criticDecision: "request_changes",
        feedbackSummary: "Enforce strict skill enhancement",
        skillEnhancements: [
          { taskId: "t-plugin", requiredSkill: "deep-parser-audit", minimumQuality: 0.95 },
        ],
      };

      const adapted = adaptTopologyWithCriticFeedback(base, feedback);
      const plugin = adapted.tasks.find((t) => t.id === "t-plugin");
      expect(plugin?.requiredSkills).toContain("deep-parser-audit");
    });

    it("throws HarnessError on escalated critic decisions", () => {
      const base = createBaseTopology();
      const feedback: CriticFeedbackAdjustment = {
        feedbackId: "fb-fatal",
        roundNumber: 3,
        criticDecision: "escalated",
        feedbackSummary: "Fatal deadlock between requirements",
      };

      expect(() => adaptTopologyWithCriticFeedback(base, feedback)).toThrow(HarnessError);
    });
  });
});
