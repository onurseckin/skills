import { describe, expect, test } from "bun:test";
import { pairValidatorsStrictly } from "../../../../olt/scripts/src/engine/scheduler/index.ts";

describe("Unlimited Depth DAG: Validator Pairing", () => {
  describe("pairValidatorsStrictly", () => {
    test("pairs code-quality as baseline validator for generic tasks", () => {
      const tasks = [
        {
          id: "task-backend",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/utils/calc.ts"],
        },
      ];

      const pairings = pairValidatorsStrictly(tasks);
      expect(pairings.length).toBe(1);
      expect(pairings[0]!.taskId).toBe("task-backend");
      expect(pairings[0]!.applicableDomains).toEqual(["code-quality"]);
      expect(pairings[0]!.pairedValidatorDomains).toEqual(["code-quality"]);
      expect(pairings[0]!.isPaired).toBe(true);
      expect(pairings[0]!.pairingStrictness).toBe("strict");
    });

    test("strictly pairs multi-domain validators for UI and system design write scopes", () => {
      const tasks = [
        {
          id: "task-ui",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/components/Modal.tsx", "src/styles/theme.css"],
        },
        {
          id: "task-schema",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/contracts/user.graphql"],
        },
      ];

      const pairings = pairValidatorsStrictly(tasks);
      expect(pairings.length).toBe(2);

      const uiPair = pairings.find((p) => p.taskId === "task-ui");
      expect(uiPair).toBeDefined();
      expect(uiPair?.applicableDomains).toContain("code-quality");
      expect(uiPair?.applicableDomains).toContain("ui-design");
      expect(uiPair?.pairedValidatorDomains).toContain("code-quality");
      expect(uiPair?.pairedValidatorDomains).toContain("ui-design");
      expect(uiPair?.isPaired).toBe(true);

      const schemaPair = pairings.find((p) => p.taskId === "task-schema");
      expect(schemaPair).toBeDefined();
      expect(schemaPair?.applicableDomains).toContain("code-quality");
      expect(schemaPair?.applicableDomains).toContain("system-design");
      expect(schemaPair?.pairedValidatorDomains).toContain("code-quality");
      expect(schemaPair?.pairedValidatorDomains).toContain("system-design");
      expect(schemaPair?.isPaired).toBe(true);
    });

    test("pairs UI validator domain from requirement text signals", () => {
      const tasks = [
        {
          id: "task-req-ui",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/logic/state.ts"],
        },
      ];
      const reqTexts = new Map([
        ["task-req-ui", ["Verify responsive visual viewport and WCAG contrast ratio"]],
      ]);

      const pairings = pairValidatorsStrictly(tasks, { requirementTexts: reqTexts });
      expect(pairings[0]!.applicableDomains).toContain("ui-design");
      expect(pairings[0]!.pairedValidatorDomains).toContain("ui-design");
      expect(pairings[0]!.isPaired).toBe(true);
    });

    test("supports relaxed pairing mode and assigned implementer metadata", () => {
      const tasks = [
        {
          id: "task-rel",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/view.tsx"],
        },
      ];
      const assigned = new Map([["task-rel", "implementer_task-rel"]]);

      const pairings = pairValidatorsStrictly(tasks, {
        pairingStrictness: "relaxed",
        assignedImplementers: assigned,
      });

      expect(pairings[0]!.assignedImplementer).toBe("implementer_task-rel");
      expect(pairings[0]!.pairingStrictness).toBe("relaxed");
    });

    test("accepts Record objects for taskMap, requirementTexts, and assignedImplementers", () => {
      const taskRecord = {
        t1: {
          id: "t1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/ui.tsx"],
        },
      };
      const deps = new Map([["t1", new Set<string>()]]);
      const pairingResult = pairValidatorsStrictly([taskRecord.t1], {
        requirementTexts: { t1: ["WCAG contrast"] },
        assignedImplementers: { t1: "worker-1" },
      });
      expect(pairingResult[0]!.assignedImplementer).toBe("worker-1");
      expect(pairingResult[0]!.applicableDomains).toContain("ui-design");

      const fallbackPairings = pairValidatorsStrictly([taskRecord.t1], {
        requirementTexts: "invalid" as unknown as Record<string, string[]>,
        assignedImplementers: 123 as unknown as Record<string, string>,
      });
      expect(fallbackPairings[0]!.assignedImplementer).toBeNull();
    });
  });
});
