import { describe, it, expect } from "bun:test";
import {
  BrainstormEngine,
  SOCRATIC_VECTORS,
  type SocraticVector,
  type ExpandedBrainstormItem,
  type BrainstormResult,
} from "../../../olt/scripts/src/graph/brainstorm-engine.ts";

describe("BrainstormEngine", () => {
  it("exports SOCRATIC_VECTORS with exactly 8 failure vectors", () => {
    expect(SOCRATIC_VECTORS.length).toBe(8);
    expect(BrainstormEngine.SOCRATIC_VECTORS.length).toBe(8);

    const expectedVectorIds = [
      "EMPTY_PAYLOAD",
      "TIMEOUT_STAGNATION",
      "CONCURRENCY_MUTATION",
      "HOST_BOUNDARY",
      "STATE_TRANSITION",
      "TYPE_INVARIANT",
      "CLI_TELEMETRY",
      "ADVERSARIAL_GATE",
    ];

    for (const id of expectedVectorIds) {
      const vector = SOCRATIC_VECTORS.find((v) => v.id === id);
      expect(vector).toBeDefined();
      expect(vector?.name).toBeDefined();
      expect(vector?.description).toBeDefined();
      expect(vector?.focus).toBeDefined();
    }
  });

  it("expands prompt requirements across all 8 Socratic failure vectors", () => {
    const prompt = "Harden agent system against small model errors and improve CLI error handling";
    const result = BrainstormEngine.expandPromptToVectors(prompt, 3);

    expect(result.roundsExecuted).toBe(3);
    expect(result.vectors.length).toBe(8);
    expect(result.expandedItems.length).toBeGreaterThanOrEqual(8);
    expect(result.totalExpandedItems).toBe(result.expandedItems.length);

    const vectorNames = result.vectors.map((v) => v.id);
    expect(vectorNames).toContain("EMPTY_PAYLOAD");
    expect(vectorNames).toContain("TIMEOUT_STAGNATION");
    expect(vectorNames).toContain("CONCURRENCY_MUTATION");
    expect(vectorNames).toContain("HOST_BOUNDARY");
    expect(vectorNames).toContain("STATE_TRANSITION");
    expect(vectorNames).toContain("TYPE_INVARIANT");
    expect(vectorNames).toContain("CLI_TELEMETRY");
    expect(vectorNames).toContain("ADVERSARIAL_GATE");
  });

  it("handles multi-line prompts and generates items for all lines across rounds", () => {
    const prompt = [
      "Requirement 1: Add input schema validation",
      "Requirement 2: Enforce process timeout bounds",
      "Requirement 3: Prevent concurrent mutation races",
    ].join("\n");

    const result = BrainstormEngine.expandPromptToVectors(prompt, 2);

    expect(result.roundsExecuted).toBe(2);
    expect(result.vectors.length).toBe(8);
    expect(result.expandedItems.length).toBe(48);
    expect(result.totalExpandedItems).toBe(48);

    for (const item of result.expandedItems) {
      expect(item.id).toBeDefined();
      expect(item.vectorId).toBeDefined();
      expect(item.vectorName).toBeDefined();
      expect(item.round).toBeGreaterThanOrEqual(1);
      expect(item.round).toBeLessThanOrEqual(2);
      expect(item.sourceRequirement.length).toBeGreaterThan(0);
      expect(item.risk.length).toBeGreaterThan(0);
      expect(item.mitigation.length).toBeGreaterThan(0);
    }
  });

  it("handles default rounds parameter (default = 3)", () => {
    const prompt = "Implement mechanical step prerequisites in plan compile";
    const result = BrainstormEngine.expandPromptToVectors(prompt);

    expect(result.roundsExecuted).toBe(3);
    expect(result.expandedItems.length).toBe(24);
  });

  it("handles empty or whitespace-only prompt gracefully", () => {
    const result = BrainstormEngine.expandPromptToVectors("   ", 3);

    expect(result.roundsExecuted).toBe(3);
    expect(result.vectors.length).toBe(8);
    expect(result.expandedItems.length).toBe(0);
    expect(result.totalExpandedItems).toBe(0);
  });

  it("retrieves vector by id using getVectorById", () => {
    const vector = BrainstormEngine.getVectorById("TIMEOUT_STAGNATION");
    expect(vector).toBeDefined();
    expect(vector?.id).toBe("TIMEOUT_STAGNATION");
    expect(vector?.name).toContain("Timeout");

    const missing = BrainstormEngine.getVectorById("NON_EXISTENT");
    expect(missing).toBeUndefined();
  });

  it("formats ASCII summary table without errors", () => {
    const prompt = "Audit lifecycle state transitions in doctor";
    const result = BrainstormEngine.expandPromptToVectors(prompt, 1);
    const table = BrainstormEngine.formatBrainstormTable(result);

    expect(table).toContain("Socratic 8-Vector Brainstorming Matrix");
    expect(table).toContain("EMPTY_PAYLOAD");
    expect(table).toContain("ADVERSARIAL_GATE");
  });
});
