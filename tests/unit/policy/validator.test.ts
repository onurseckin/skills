import { describe, expect, it } from "bun:test";
import * as schema from "../../../olt/scripts/src/policy/schema/index.ts";
import {
  assertValidPolicy,
  isPolicyValid,
  validateCommandIntegrity,
  validateHooksIntegrity,
  validatePlanningPolicy,
  validatePolicy,
  validatePolicyStructure,
  validateReviewProtocol,
} from "../../../olt/scripts/src/policy/validator.ts";

import { samplePolicy } from "./rbac/fixtures.ts";

describe("policy validator", () => {
  it("validates valid policy with validatePolicy and assertValidPolicy", () => {
    const validated = validatePolicy(samplePolicy);
    expect(validated.ecosystem).toBe("bun");

    expect(() => assertValidPolicy(samplePolicy)).not.toThrow();
  });

  it("checks validity using isPolicyValid", () => {
    expect(isPolicyValid(samplePolicy)).toBe(true);
    expect(isPolicyValid(null)).toBe(false);
    expect(isPolicyValid({ schema_version: "invalid" })).toBe(false);
  });

  it("validates command integrity", () => {
    expect(validateCommandIntegrity(["bun test"], ["git push"])).toEqual([]);
    expect(validateCommandIntegrity(["bun test", "curl"], ["curl", "git push"])).toEqual([
      "Command 'curl' is both allowed and forbidden",
    ]);
    expect(validateCommandIntegrity(undefined, ["git push"])).toEqual([]);
    expect(validateCommandIntegrity(["bun test"], undefined)).toEqual([]);
    expect(validateCommandIntegrity(undefined, undefined)).toEqual([]);
  });

  it("validates planning policy", () => {
    expect(validatePlanningPolicy(null)).toEqual(["Planning policy must be an object"]);
    expect(validatePlanningPolicy("invalid")).toEqual(["Planning policy must be an object"]);

    const validPlanning = {
      mandatory_brainstorming_rounds: 1,
      min_tasks_per_complex_prompt: 2,
      max_files_per_task: 5,
    };
    expect(validatePlanningPolicy(validPlanning)).toEqual([]);

    const invalidPlanning = {
      mandatory_brainstorming_rounds: -1,
      min_tasks_per_complex_prompt: 0,
      max_files_per_task: -5,
    };
    const errors = validatePlanningPolicy(invalidPlanning);
    expect(errors).toContain("mandatory_brainstorming_rounds must be a non-negative integer");
    expect(errors).toContain("min_tasks_per_complex_prompt must be a positive integer >= 1");
    expect(errors).toContain("max_files_per_task must be a positive integer >= 1");

    const nonIntegerPlanning = {
      mandatory_brainstorming_rounds: 1.5,
      min_tasks_per_complex_prompt: 2.3,
      max_files_per_task: 4.1,
    };
    const floatErrors = validatePlanningPolicy(nonIntegerPlanning);
    expect(floatErrors).toHaveLength(3);
  });

  it("validates review protocol", () => {
    expect(validateReviewProtocol(null)).toEqual(["Review protocol must be an object"]);
    expect(validateReviewProtocol(123)).toEqual(["Review protocol must be an object"]);

    const validReview = {
      max_adversarial_pushes: 3,
      cognitive_pushes: 2,
    };
    expect(validateReviewProtocol(validReview)).toEqual([]);

    const invalidReview = {
      max_adversarial_pushes: 0,
      cognitive_pushes: -1,
    };
    const errors = validateReviewProtocol(invalidReview);
    expect(errors).toContain("max_adversarial_pushes must be a positive integer >= 1");
    expect(errors).toContain("cognitive_pushes must be a non-negative integer");

    const floatReview = {
      max_adversarial_pushes: 1.5,
      cognitive_pushes: 0.5,
    };
    const floatErrors = validateReviewProtocol(floatReview);
    expect(floatErrors).toHaveLength(2);
  });

  it("validates hooks integrity", () => {
    expect(validateHooksIntegrity(null)).toEqual(["Hooks must be an object"]);
    expect(validateHooksIntegrity(true)).toEqual(["Hooks must be an object"]);

    const validHooks = {
      pre_claim: ["echo start"],
      post_submit: ["echo done"],
    };
    expect(validateHooksIntegrity(validHooks)).toEqual([]);

    const notArrayHooks = {
      pre_claim: "echo start",
    };
    expect(validateHooksIntegrity(notArrayHooks)).toEqual([
      "Hook 'pre_claim' must be an array of strings",
    ]);

    const invalidItemHooks = {
      pre_claim: ["valid", "", 123, "   "],
    };
    const itemErrors = validateHooksIntegrity(invalidItemHooks);
    expect(itemErrors).toEqual([
      "Hook 'pre_claim' entries must be non-empty strings",
      "Hook 'pre_claim' entries must be non-empty strings",
      "Hook 'pre_claim' entries must be non-empty strings",
    ]);
  });

  it("validates structure with validatePolicyStructure", () => {
    const validResult = validatePolicyStructure(samplePolicy);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toEqual([]);
    expect(validResult.policy).toBeDefined();

    const invalidResult = validatePolicyStructure({ invalid: true });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
  });

  it("handles non-Error thrown during validatePolicyStructure", () => {
    const proxyObj = new Proxy(
      {},
      {
        get() {
          throw "custom string error";
        },
      },
    );
    const stringErrResult = validatePolicyStructure(proxyObj);
    expect(stringErrResult.valid).toBe(false);
    expect(stringErrResult.errors).toEqual(["custom string error"]);
  });
});
