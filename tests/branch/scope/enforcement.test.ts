import { afterEach, describe, expect, test } from "bun:test";
import {
  branchCapsule,
  branchChain,
  cleanupRoots,
  openBranchVia,
  openChainLevel,
} from "../core/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

describe("Branch Scope: CLI Enforcement & Containment Validation", () => {
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
