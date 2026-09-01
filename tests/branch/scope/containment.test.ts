import { describe, expect, test } from "bun:test";
import { assertSubScopes, scopeContains } from "../../../olt/scripts/src/workflow/branch/scope.ts";

describe("Branch Scope: Containment & Boundaries", () => {
  test("accepts a scope the parent already owns", () => {
    expect(scopeContains(["src/one"], ["src/one/parser"])).toBeTrue();
    expect(scopeContains(["src/one"], ["src/one"])).toBeTrue();
    expect(scopeContains(["docs/**"], ["docs/concepts/api.md"])).toBeTrue();
    expect(scopeContains(["src/*/lib"], ["src/one/lib/deep"])).toBeTrue();
    expect(scopeContains(["src/a", "src/b"], ["src/b/one"])).toBeTrue();
  });

  test("refuses a scope that reaches outside the parent", () => {
    expect(scopeContains(["src/one"], ["src/two"])).toBeFalse();
    expect(scopeContains(["src/one/parser"], ["src/one"])).toBeFalse();
    expect(scopeContains(["docs/concepts/**"], ["docs"])).toBeFalse();
    // Two globs that are not identical are refused rather than approved on a guess.
    expect(scopeContains(["src/*.ts"], ["src/a*"])).toBeFalse();
  });

  test("rejects siblings that can name the same path", () => {
    expect(() =>
      assertSubScopes(
        ["src/one"],
        [
          { id: "S-1", write_scope: ["src/one/parser"] },
          { id: "S-2", write_scope: ["src/one/parser/lexer"] },
        ],
      ),
    ).toThrow("S-1 and S-2 claim overlapping write scope");
  });
});
