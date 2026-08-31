import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  validateCategory,
  type FeedbackCategory,
} from "../../olt/scripts/src/mind/feedback/queue/types.ts";

describe("Feedback Category Normalization & Backlog Parsing", () => {
  test("validates and parses all canonical FeedbackCategory variants", () => {
    const canonicalCategories: readonly FeedbackCategory[] = [
      "DOCUMENTATION",
      "AGENT_CONTRACTS",
      "CLI_TOOLING",
      "WATCHDOG",
      "SCALING",
      "ARCHITECTURE",
      "CORE_ENGINE",
      "ENGINE",
      "REPAIR",
      "GENERAL",
      "GOVERNANCE",
      "ORCHESTRATION",
      "AUDITING",
      "COMMUNICATION",
      "VALIDATION",
      "NOTIFICATION",
    ];

    for (const category of canonicalCategories) {
      expect(validateCategory(category)).toBe(category);
      expect(validateCategory(category.toLowerCase())).toBe(category);
      expect(validateCategory(`  ${category}  `)).toBe(category);
    }
  });

  test("normalizes category synonyms deterministically", () => {
    const synonymMappings: readonly [string, FeedbackCategory][] = [
      ["DOCS", "DOCUMENTATION"],
      ["DOC", "DOCUMENTATION"],
      ["docs", "DOCUMENTATION"],
      ["CONTRACTS", "AGENT_CONTRACTS"],
      ["AGENT", "AGENT_CONTRACTS"],
      ["contracts", "AGENT_CONTRACTS"],
      ["CLI", "CLI_TOOLING"],
      ["TOOLING", "CLI_TOOLING"],
      ["cli", "CLI_TOOLING"],
      ["BUGFIX", "REPAIR"],
      ["FIX", "REPAIR"],
      ["fix", "REPAIR"],
      ["POLICY", "GOVERNANCE"],
      ["policy", "GOVERNANCE"],
      ["WORKFLOW", "ORCHESTRATION"],
      ["workflow", "ORCHESTRATION"],
      ["AUDIT", "AUDITING"],
      ["audit", "AUDITING"],
      ["MSG", "COMMUNICATION"],
      ["MESSAGING", "COMMUNICATION"],
      ["msg", "COMMUNICATION"],
      ["VALIDATOR", "VALIDATION"],
      ["validator", "VALIDATION"],
      ["NOTIFICATIONS", "NOTIFICATION"],
      ["NOTIFY", "NOTIFICATION"],
      ["notify", "NOTIFICATION"],
    ];

    for (const [input, expected] of synonymMappings) {
      expect(validateCategory(input)).toBe(expected);
      expect(validateCategory(` ${input} `)).toBe(expected);
    }
  });

  test("throws HarnessError INTEGRITY on invalid or unmapped category inputs", () => {
    const invalidInputs: readonly unknown[] = [
      "",
      "INVALID_CATEGORY",
      "UNKNOWN",
      123,
      null,
      undefined,
      {},
      [],
      true,
    ];

    for (const input of invalidInputs) {
      expect(() => validateCategory(input)).toThrow(HarnessError);
      try {
        validateCategory(input);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    }
  });

  test("verifies test file contains zero any and zero suppressions", () => {
    const testFile = readFileSync(__filename, "utf-8");
    expect(testFile).not.toContain("@ts-" + "ignore");
    expect(testFile).not.toContain("@ts-" + "expect-error");
    expect(testFile).not.toContain("eslint-" + "disable");
    expect(testFile).not.toContain(": " + "any");
  });
});
