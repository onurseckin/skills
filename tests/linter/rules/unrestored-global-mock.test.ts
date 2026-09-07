import { describe, expect, it } from "bun:test";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/index.ts";
import { unrestoredGlobalMockRule } from "../../../olt/scripts/src/linter/rules/testing/unrestored_global_mock.ts";

export const unrestoredGlobalMockSuiteName =
  "AST Unrestored Global Mock Rule (unrestored_global_mock)";

describe(unrestoredGlobalMockSuiteName, () => {
  it("exports the correct rule identifier", () => {
    expect(unrestoredGlobalMockRule.rule).toBe("unrestored_global_mock");
  });

  it("flags a top-level mock.module call that is never restored", () => {
    const code = `
      import { describe, expect, mock, test } from "bun:test";
      mock.module("../../src/thing.ts", () => ({ thing: () => 1 }));
      describe("x", () => {
        test("y", () => {
          expect(1).toBe(1);
        });
      });
    `;
    const result = lintSourceCode(code, "tests/example.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unrestored_global_mock).toBe(1);
    const violation = result.violations.find((v) => v.rule === "unrestored_global_mock");
    expect(violation?.message).toContain('"../../src/thing.ts"');
    expect(violation?.message).toContain("never calls mock.restore()");
  });

  it("flags a mock.module call made inside beforeEach with no restoration", () => {
    const code = `
      import { beforeEach, describe, expect, mock, test } from "bun:test";
      describe("x", () => {
        beforeEach(() => {
          mock.module("../../src/thing.ts", () => ({ thing: () => 1 }));
        });
        test("y", () => {
          expect(1).toBe(1);
        });
      });
    `;
    const result = lintSourceCode(code, "tests/example-before-each.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unrestored_global_mock).toBe(1);
  });

  it("does not flag a mock.module call when the file also calls mock.restore()", () => {
    const code = `
      import { afterEach, describe, expect, mock, test } from "bun:test";
      mock.module("../../src/thing.ts", () => ({ thing: () => 1 }));
      describe("x", () => {
        afterEach(() => {
          mock.restore();
        });
        test("y", () => {
          const value = 1 + 1;
          expect(value).toBe(2);
        });
      });
    `;
    const result = lintSourceCode(code, "tests/example-restored.test.ts");

    expect(result.valid).toBe(true);
    expect(result.summaryByRule.unrestored_global_mock).toBe(0);
  });

  it("does not flag a mock.module call when the same specifier is re-established later in the file", () => {
    const code = `
      import * as thing from "../../src/thing.ts";
      import { describe, expect, it, mock } from "bun:test";
      const realThing = { ...thing };
      function restoreMocks() {
        mock.module("../../src/thing.ts", () => realThing);
      }
      describe("x", () => {
        it("y", () => {
          mock.module("../../src/thing.ts", () => ({ thing: () => 1 }));
          const result = 1;
          restoreMocks();
          expect(result).toBe(1);
        });
      });
    `;
    const result = lintSourceCode(code, "tests/example-remocked.test.ts");

    expect(result.valid).toBe(true);
    expect(result.summaryByRule.unrestored_global_mock).toBe(0);
  });

  it("ignores files that never import mock from bun:test", () => {
    const code = `
      const mock = { module: (id: string, factory: () => unknown) => factory() };
      mock.module("../../src/thing.ts", () => ({ thing: () => 1 }));
    `;
    const result = lintSourceCode(code, "tests/example-not-bun-mock.test.ts");

    expect(result.valid).toBe(true);
    expect(result.summaryByRule.unrestored_global_mock).toBe(0);
  });

  it("flags each distinct unrestored specifier independently", () => {
    const code = `
      import { describe, mock, test, expect } from "bun:test";
      mock.module("../../src/a.ts", () => ({}));
      mock.module("../../src/b.ts", () => ({}));
      describe("x", () => {
        test("y", () => {
          expect(1).toBe(1);
        });
      });
    `;
    const result = lintSourceCode(code, "tests/example-two-specifiers.test.ts");

    expect(result.summaryByRule.unrestored_global_mock).toBe(2);
  });
});
