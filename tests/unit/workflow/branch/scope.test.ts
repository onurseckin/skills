import { describe, expect, test } from "bun:test";
import {
  assertSubScopes,
  scopeContains,
  scopeStrictlyContains,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/branch/scope.ts";

describe("scopeContains", () => {
  test("an exact single-segment match contains itself", () => {
    expect(scopeContains(["src"], ["src"])).toBe(true);
  });

  test("a literal owner does not contain an unrelated path", () => {
    expect(scopeContains(["src/pkg-a"], ["src/pkg-b"])).toBe(false);
  });

  test("a single-star segment owns any one sibling segment", () => {
    expect(scopeContains(["src/*"], ["src/pkg-a"])).toBe(true);
  });

  test("a partial glob segment matches via the compiled regex branch", () => {
    expect(scopeContains(["src/lib*.ts"], ["src/libfoo.ts"])).toBe(true);
    expect(scopeContains(["src/lib*.ts"], ["src/other.ts"])).toBe(false);
  });

  test("a wildcard inner segment is never contained by a literal owner", () => {
    expect(scopeContains(["src/pkg-a"], ["src/*"])).toBe(false);
  });

  test("a double-star owner reaches into deeper nested descendants", () => {
    expect(scopeContains(["src/**/util.ts"], ["src/pkg/nested/util.ts"])).toBe(true);
    expect(scopeContains(["src/**/util.ts"], ["src/util.ts"])).toBe(true);
  });

  test("a double-star owner does not match past a differing trailing segment", () => {
    expect(scopeContains(["src/**/util.ts"], ["src/pkg/other.ts"])).toBe(false);
  });

  test("a shorter owner path implicitly owns everything nested beneath it, like a directory prefix", () => {
    expect(scopeContains(["src/pkg"], ["src/pkg/nested"])).toBe(true);
  });

  test("an inner path is contained when any one of several owners covers it", () => {
    expect(scopeContains(["docs/**", "src/pkg-a"], ["src/pkg-a"])).toBe(true);
  });

  test("every inner candidate must be covered, not just one of several", () => {
    expect(scopeContains(["src/pkg-a"], ["src/pkg-a", "src/pkg-b"])).toBe(false);
  });
});

describe("scopeStrictlyContains", () => {
  test("is false when the two scopes are exactly equal", () => {
    expect(scopeStrictlyContains(["src/pkg"], ["src/pkg"])).toBe(false);
  });

  test("is true when the owner is a proper superset of the inner scope", () => {
    expect(scopeStrictlyContains(["src/**"], ["src/pkg/nested"])).toBe(true);
  });

  test("is false when the inner scope is not contained at all", () => {
    expect(scopeStrictlyContains(["src/pkg-a"], ["src/pkg-b"])).toBe(false);
  });
});

describe("assertSubScopes", () => {
  test("accepts sub-tasks whose scopes are proper, non-overlapping subsets of the parent", () => {
    expect(() =>
      assertSubScopes(
        ["src/pkg/**"],
        [
          { id: "ST-1", write_scope: ["src/pkg/a.ts"] },
          { id: "ST-2", write_scope: ["src/pkg/b.ts"] },
        ],
      ),
    ).not.toThrow();
  });

  test("throws INVALID_STATE when a sub-task's scope escapes the parent scope entirely", () => {
    expect(() =>
      assertSubScopes(["src/pkg/**"], [{ id: "ST-1", write_scope: ["src/other/a.ts"] }]),
    ).toThrow(/write scope escapes the parent scope/);
  });

  test("throws INVALID_STATE when a sub-task's scope equals the parent scope exactly (not a proper subset)", () => {
    expect(() =>
      assertSubScopes(["src/pkg/a.ts"], [{ id: "ST-1", write_scope: ["src/pkg/a.ts"] }]),
    ).toThrow(/is not a proper subset of the parent scope/);
  });

  test("throws INVALID_STATE when two sibling sub-tasks claim overlapping write scope", () => {
    expect(() =>
      assertSubScopes(
        ["src/pkg/**"],
        [
          { id: "ST-1", write_scope: ["src/pkg/shared"] },
          { id: "ST-2", write_scope: ["src/pkg/shared/nested.ts"] },
        ],
      ),
    ).toThrow(/ST-1 and ST-2 claim overlapping write scope/);
  });

  test("accepts an empty list of sub-tasks without complaint", () => {
    expect(() => assertSubScopes(["src/pkg/**"], [])).not.toThrow();
  });
});
