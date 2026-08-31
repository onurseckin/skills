import { describe, expect, test } from "bun:test";
import {
  assertSubScopes,
  scopeStrictlyContains,
} from "../../../olt/scripts/src/workflow/branch/scope.ts";

describe("Branch Scope: Proper-Subset Narrowing", () => {
  test("counts a strictly smaller scope as a narrowing", () => {
    expect(scopeStrictlyContains(["src/one"], ["src/one/parser"])).toBeTrue();
    expect(scopeStrictlyContains(["src/a", "src/b"], ["src/a"])).toBeTrue();
    expect(scopeStrictlyContains(["src/*/lib"], ["src/one/lib"])).toBeTrue();
  });

  test("narrows a glob only when the glob itself gets smaller", () => {
    expect(scopeStrictlyContains(["docs/**"], ["docs/concepts/**"])).toBeTrue();
    expect(scopeStrictlyContains(["docs/**"], ["docs/concepts/api.md"])).toBeTrue();
    expect(scopeStrictlyContains(["docs/**"], ["docs/**"])).toBeFalse();
    expect(scopeStrictlyContains(["docs/concepts/**"], ["docs/**"])).toBeFalse();
  });

  test("refuses a scope that is equal to, or wider than, the parent", () => {
    expect(scopeStrictlyContains(["src/one"], ["src/one"])).toBeFalse();
    expect(scopeStrictlyContains(["src/one/parser"], ["src/one"])).toBeFalse();
    expect(() => assertSubScopes(["src/one"], [{ id: "S-1", write_scope: ["src/one"] }])).toThrow(
      "is not a proper subset of the parent scope src/one",
    );
  });
});
