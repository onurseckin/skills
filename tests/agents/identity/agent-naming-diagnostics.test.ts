import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  isStandardAgentId,
  recommendStandardAgentId,
  validateAgentNamingConvention,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

describe("Agent Naming - Negative and Boundary Validation Diagnostics", () => {
  test("detects role mismatches between agent ID prefix and declared role", () => {
    const validation = validateAgentNamingConvention(
      "implementer_task-1-fix",
      "validator",
      3,
      "task-1",
    );
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("Role mismatch");
    expect(validation.recommendedAgentId).toBe("validator_task-1");
  });

  test("detects tier mismatches between declared tier and agent identifier tier", () => {
    const validation = validateAgentNamingConvention("coordinator_domain-cli", "coordinator", 3);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("Tier mismatch");
  });

  test("detects task ID mismatch between agent identifier and leased task", () => {
    const validation = validateAgentNamingConvention(
      "implementer_task-p54-naming",
      "implementer",
      3,
      "task-p55",
    );
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("Task ID mismatch");
    expect(validation.recommendedAgentId).toBe("implementer_task-p55-naming");
  });

  test("rejects malformed syntax like dashes instead of underscores, spaces, or uppercase", () => {
    expect(isStandardAgentId("implementer-task-1")).toBe(false);
    expect(isStandardAgentId("Implementer_task-1")).toBe(false);
    expect(isStandardAgentId("implementer_task_1")).toBe(false);
    expect(isStandardAgentId("implementer task-1")).toBe(false);
    expect(isStandardAgentId("")).toBe(false);
  });

  test("handles unstandardized role names in recommendStandardAgentId gracefully", () => {
    expect(recommendStandardAgentId("rogue-agent", "task-99")).toBe("rogue-agent_task-99");
    expect(recommendStandardAgentId("HACKER", "exploit-1", "patch")).toBe("hacker_exploit-1-patch");
  });

  test("rejects identifiers containing unicode, emojis, multiple underscores or punctuation with diagnostics", () => {
    const emojiResult = validateAgentNamingConvention("implementer_task-1-🔥");
    expect(emojiResult.valid).toBe(false);
    expect(emojiResult.reason).toContain("does not match the standardized naming convention");

    const doubleUnderscoreResult = validateAgentNamingConvention("implementer__task-1");
    expect(doubleUnderscoreResult.valid).toBe(false);

    const splitRoleResult = validateAgentNamingConvention("valida_tor_task-1");
    expect(splitRoleResult.valid).toBe(false);
  });
});
