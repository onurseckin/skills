import { afterEach, describe, expect, test } from "bun:test";
import {
  assertSubScopes,
  scopeContains,
  scopeStrictlyContains,
} from "../../../olt/scripts/src/workflow/branch/scope.ts";
import {
  branchCapsule,
  branchChain,
  cleanupRoots,
  openBranchVia,
  openChainLevel,
} from "./fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

describe("branch write-scope containment", () => {
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

describe("proper-subset narrowing", () => {
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

describe("branch:open scope enforcement", () => {
  test("rejects a sub-scope that escapes the parent scope", async () => {
    const fixture = await branchCapsule(roots, "branch-escape");
    await expect(
      openBranchVia(fixture, {
        subTasks: [{ id: "S-1", label: "Touch someone else", scopes: ["src/two"] }],
      }),
    ).rejects.toThrow("write scope escapes the parent scope");
  });

  test("rejects siblings that collide with each other", async () => {
    const fixture = await branchCapsule(roots, "branch-collide");
    await expect(
      openBranchVia(fixture, {
        subTasks: [
          { id: "S-1", label: "Parser", scopes: ["src/one/parser"] },
          { id: "S-2", label: "Lexer", scopes: ["src/one/parser/lexer"] },
        ],
      }),
    ).rejects.toThrow("claim overlapping write scope");
  });

  test("rejects a sub-scope equal to the parent scope", async () => {
    const fixture = await branchCapsule(roots, "branch-equal-scope");
    await expect(
      openBranchVia(fixture, {
        subTasks: [{ id: "S-1", label: "The whole thing again", scopes: ["src/one"] }],
      }),
    ).rejects.toThrow(
      "sub-task S-1 write scope src/one is not a proper subset of the parent scope src/one: a branch must hand down strictly less than it holds",
    );
  });

  test("accepts a strictly narrower sub-scope", async () => {
    const fixture = await branchCapsule(roots, "branch-narrower-scope");
    const opened = await openBranchVia(fixture, {
      subTasks: [{ id: "S-1", label: "Parser only", scopes: ["src/one/parser"] }],
    });
    expect(opened.branch_id).toBeString();
  });

  test("refuses a chain that tries to recurse on an unchanged scope at the second hop", async () => {
    const fixture = await branchCapsule(roots, "branch-chain-recursion");
    const [first] = await branchChain(fixture, 1);
    await expect(
      openBranchVia(fixture, {
        parentTask: first!.subTaskId,
        agent: first!.agent,
        token: first!.token,
        reason: "the same ground, one level down",
        subTasks: [{ id: "S-1-a", label: "Same scope", scopes: ["src/one/parser"] }],
      }),
    ).rejects.toThrow(
      "is not a proper subset of the parent scope src/one/parser: a branch must hand down strictly less than it holds",
    );
    // The honest narrowing at the same hop is accepted, so the refusal is about the scope, not the depth.
    const second = await openChainLevel(fixture, 2, {
      taskId: first!.subTaskId,
      agent: first!.agent,
      token: first!.token,
    });
    expect(second.branchId).toBeString();
  }, 20_000);

  test("rejects a sub-task declared without a label or a scope", async () => {
    const fixture = await branchCapsule(roots, "branch-underspecified");
    await expect(
      openBranchVia(fixture, {
        subTasks: [{ id: "S-1", label: "Parser", scopes: [] }],
      }),
    ).rejects.toThrow("sub-task S-1 has no --sub-scope");
  });
});
