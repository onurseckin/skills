import { describe, expect, it } from "bun:test";
import {
  isDualValidationRequired,
  getRequiredValidatorDomains,
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  dispatchMultiDomainValidators,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";

describe("Multi-Domain Dispatch & Validator Pairing", () => {
  describe("1. Dual-Validation Detection Helpers", () => {
    it("identifies tasks with UI scopes as requiring dual validation", () => {
      const task = {
        id: "task-ui",
        write_scope: ["src/components/Modal.tsx"],
      };

      expect(isDualValidationRequired(task)).toBe(true);
      expect(getRequiredValidatorDomains(task)).toEqual(["code-quality", "ui-design"]);
    });

    it("identifies tasks with UI requirement text as requiring dual validation", () => {
      const task = {
        id: "task-backend-with-ui-req",
        write_scope: ["src/api/handler.ts"],
      };
      const requirementTexts = [
        "Ensure response renders properly in frontend visual UI screenshot",
      ];

      expect(isDualValidationRequired(task, requirementTexts)).toBe(true);
      expect(getRequiredValidatorDomains(task, requirementTexts)).toEqual([
        "code-quality",
        "ui-design",
      ]);
    });

    it("identifies single-domain non-UI tasks as not requiring dual validation", () => {
      const task = {
        id: "task-pure-core",
        write_scope: ["src/core/math.ts"],
      };

      expect(isDualValidationRequired(task)).toBe(false);
      expect(getRequiredValidatorDomains(task)).toEqual(["code-quality"]);
    });

    it("identifies multi-domain tasks with schema/contracts as requiring system-design", () => {
      const task = {
        id: "task-multi-domain",
        write_scope: ["src/schema/user.graphql", "src/views/User.vue"],
      };

      expect(isDualValidationRequired(task)).toBe(true);
      expect(getRequiredValidatorDomains(task)).toEqual([
        "code-quality",
        "system-design",
        "ui-design",
      ]);
    });
  });

  describe("2. Task and Domain Classification", () => {
    it("classifies frontend-ui domain accurately", () => {
      const task = {
        id: "task-button",
        write_scope: ["src/components/Button.tsx"],
      };
      expect(classifyTaskDomain(task)).toBe("frontend-ui");
      expect(derivePrimaryValidatorDomain(task)).toBe("ui-design");
    });

    it("classifies backend-system domain accurately", () => {
      const task = {
        id: "task-api",
        write_scope: ["src/api/routes.ts"],
      };
      expect(classifyTaskDomain(task)).toBe("backend-system");
    });
  });

  describe("3. Validator Dispatch across Distinct Domains", () => {
    it("dispatches validators for submitted tasks without scope collisions", () => {
      const state = {
        tasks: {
          "task-1": {
            id: "task-1",
            status: "submitted",
            write_scope: ["src/components/A.tsx"],
            requirement_ids: ["REQ-1"],
            priority: 10,
          },
          "task-2": {
            id: "task-2",
            status: "submitted",
            write_scope: ["src/engine/B.ts"],
            requirement_ids: ["REQ-2"],
            priority: 5,
          },
        },
      };

      const result = dispatchMultiDomainValidators(state, { parallelismFactor: 3.0 });
      expect(result.validatorDispatches.length).toBe(2);
      expect(result.scopeIsolated).toBe(true);
      expect(result.dispatchedDomains).toEqual(["core-engine", "frontend-ui"]);
    });
  });
});
