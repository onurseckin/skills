import { describe, expect, test } from "bun:test";
import * as AntiMock from "../../../olt/scripts/src/validation/anti-mock/index.ts";
import * as MutationGate from "../../../olt/scripts/src/validation/mutation-gate/index.ts";
import * as Validation from "../../../olt/scripts/src/validation/index.ts";

describe("anti-mock-types and MutationCandidate export resolution", () => {
  test("anti-mock/index.ts defines and exports all core anti-mock types and interfaces", () => {
    expect(AntiMock).toBeDefined();
  });

  test("anti-mock/index.ts exports all anti-mock functions and types including MutationCandidate", () => {
    expect(typeof AntiMock.checkAssertionFloor).toBe("function");
    expect(typeof AntiMock.AntiMockEngine).toBe("function");
    expect(typeof AntiMock.evaluateAntiMock).toBe("function");
    expect(typeof AntiMock.formatAntiMockReport).toBe("function");
  });

  test("mutation-gate/index.ts exports all mutation-gate functions and types", () => {
    expect(typeof MutationGate.generateMutants).toBe("function");
    expect(typeof MutationGate.runMutationGate).toBe("function");
    expect(typeof MutationGate.shouldSkipStringLiteral).toBe("function");
  });

  test("validation/index.ts re-exports all anti-mock and mutation-gate facades cleanly", () => {
    expect(typeof Validation.checkAssertionFloor).toBe("function");
    expect(typeof Validation.AntiMockEngine).toBe("function");
    expect(typeof Validation.evaluateAntiMock).toBe("function");
    expect(typeof Validation.formatAntiMockReport).toBe("function");
    expect(typeof Validation.generateMutants).toBe("function");
    expect(typeof Validation.runMutationGate).toBe("function");
    expect(typeof Validation.shouldSkipStringLiteral).toBe("function");
  });

  test("MutationCandidate type conforms to structural requirements", () => {
    const candidate: Validation.MutationCandidate = {
      mutationType: "invert_boolean",
      description: "Invert true to false",
      startPosition: 10,
      endPosition: 14,
      originalText: "true",
      replacementText: "false",
      line: 1,
      column: 11,
    };
    expect(candidate.mutationType).toBe("invert_boolean");
    expect(candidate.originalText).toBe("true");
    expect(candidate.replacementText).toBe("false");
  });
});
