import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createBoundReceiptPayload,
  createDeliveredReceiptPayload,
  createRefusedReceiptPayload,
  findCoveringLane,
  isPathCovered,
  normalizePath,
  verifyObligationScope,
  type DirectivePayload,
  type LaneScope,
  type PlanOrState,
} from "../../../olt/scripts/src/liaison/agent/index.ts";

describe("Obligation-to-Write-Scope Translation Engine", () => {
  test("normalizePath handles slashes and relative prefixes", () => {
    expect(normalizePath("./foo/bar/baz.ts")).toBe("foo/bar/baz.ts");
    expect(normalizePath("foo\\bar\\baz.ts")).toBe("foo/bar/baz.ts");
    expect(normalizePath("foo/bar/")).toBe("foo/bar");
    expect(normalizePath("/")).toBe("/");
  });

  test("isPathCovered evaluates exact, directory, and glob scopes", () => {
    expect(isPathCovered("olt/scripts/src/types.ts", "olt/scripts/src/types.ts")).toBe(true);
    expect(isPathCovered("olt/scripts/src/types.ts", "olt/scripts/src")).toBe(true);
    expect(isPathCovered("olt/scripts/src/sub/types.ts", "olt/scripts/src")).toBe(true);

    expect(isPathCovered("olt/scripts/src/types.ts", "olt/scripts/src/*.ts")).toBe(true);
    expect(isPathCovered("olt/scripts/src/sub/types.ts", "olt/scripts/src/*.ts")).toBe(false);
    expect(isPathCovered("olt/scripts/src/sub/types.ts", "olt/scripts/src/**")).toBe(true);

    expect(isPathCovered("olt/scripts/other/types.ts", "olt/scripts/src")).toBe(false);
    expect(isPathCovered("", "olt/scripts/src")).toBe(false);
  });

  test("findCoveringLane locates lane containing target path", () => {
    const lanes: readonly LaneScope[] = [
      {
        laneId: "task-1",
        runId: "run-cross-sys",
        writeScope: ["olt/scripts/src/liaison/agent", "tests/liaison/agent"],
      },
      {
        laneId: "task-2",
        runId: "run-cross-sys",
        writeScope: ["olt/scripts/src/liaison/daemon"],
      },
    ];

    const match1 = findCoveringLane("olt/scripts/src/liaison/agent/types.ts", lanes);
    expect(match1).not.toBeNull();
    expect(match1?.lane.laneId).toBe("task-1");

    const match2 = findCoveringLane("olt/scripts/src/liaison/daemon/service.ts", lanes);
    expect(match2).not.toBeNull();
    expect(match2?.lane.laneId).toBe("task-2");

    const match3 = findCoveringLane("olt/scripts/src/unrelated.ts", lanes);
    expect(match3).toBeNull();
  });

  test("verifyObligationScope emits checkable RECEIPT_BOUND when fully bound", () => {
    const plan: PlanOrState = {
      runId: "run-test-1",
      lanes: [
        {
          laneId: "lane-alpha",
          runId: "run-test-1",
          writeScope: ["olt/scripts/src/liaison/agent", "tests/liaison/agent"],
        },
      ],
    };

    const directive: DirectivePayload = {
      directiveId: "dir-101",
      targetPaths: [
        "olt/scripts/src/liaison/agent/types.ts",
        "tests/liaison/agent/identity.test.ts",
      ],
      expectation: "receipt",
    };

    const result = verifyObligationScope(directive, plan);
    expect(result.directiveId).toBe("dir-101");
    expect(result.isFullyBound).toBe(true);
    expect(result.isPartiallyBound).toBe(false);
    expect(result.isUnbound).toBe(false);
    expect(result.receiptType).toBe("RECEIPT_BOUND");
    expect(result.unboundPaths.length).toBe(0);
    expect(result.proof).toBeDefined();
    expect(result.proof?.runId).toBe("run-test-1");
    expect(result.proof?.bindings.length).toBe(2);
    expect(result.proof?.bindings[0]?.laneId).toBe("lane-alpha");
    expect(result.refusalReason).toBeUndefined();
  });

  test("verifyObligationScope emits RECEIPT_REFUSED with proof when unbound or partially bound", () => {
    const plan: PlanOrState = {
      runId: "run-test-2",
      lanes: [
        {
          laneId: "lane-beta",
          runId: "run-test-2",
          writeScope: ["olt/scripts/src/liaison/agent"],
        },
      ],
    };

    // Partially bound
    const partialDirective: DirectivePayload = {
      directiveId: "dir-102",
      targetPaths: ["olt/scripts/src/liaison/agent/identity.ts", "docs/unmapped/outside-scope.md"],
    };

    const partialResult = verifyObligationScope(partialDirective, plan);
    expect(partialResult.isFullyBound).toBe(false);
    expect(partialResult.isPartiallyBound).toBe(true);
    expect(partialResult.isUnbound).toBe(false);
    expect(partialResult.receiptType).toBe("RECEIPT_REFUSED");
    expect(partialResult.unboundPaths).toEqual(["docs/unmapped/outside-scope.md"]);
    expect(partialResult.refusalReason).toContain("outside-scope.md");

    // Completely unbound
    const unboundDirective: DirectivePayload = {
      directiveId: "dir-103",
      targetPaths: ["some/foreign/repo/file.ts"],
    };

    const unboundResult = verifyObligationScope(unboundDirective, plan);
    expect(unboundResult.isFullyBound).toBe(false);
    expect(unboundResult.isPartiallyBound).toBe(false);
    expect(unboundResult.isUnbound).toBe(true);
    expect(unboundResult.receiptType).toBe("RECEIPT_REFUSED");
    expect(unboundResult.unboundPaths).toEqual(["some/foreign/repo/file.ts"]);
  });

  test("receipt payload builders generate compliant wire structures", () => {
    const delivered = createDeliveredReceiptPayload("msg-1", "corr-1", "2026-09-06T00:00:00Z");
    expect(delivered.type).toBe("RECEIPT_DELIVERED");
    expect(delivered.message_id).toBe("msg-1");
    expect(delivered.correlation_id).toBe("corr-1");
    expect(delivered.read_timestamp).toBe("2026-09-06T00:00:00Z");

    const bound = createBoundReceiptPayload(
      "dir-1",
      "corr-1",
      { runId: "r1", bindings: [{ path: "p1", laneId: "l1" }] },
      "2026-09-06T00:01:00Z",
    );
    expect(bound.type).toBe("RECEIPT_BOUND");
    expect(bound.directive_id).toBe("dir-1");
    expect(bound.bound_timestamp).toBe("2026-09-06T00:01:00Z");

    const refused = createRefusedReceiptPayload(
      "dir-2",
      "corr-2",
      ["p2"],
      "Unallocated scope",
      "2026-09-06T00:02:00Z",
    );
    expect(refused.type).toBe("RECEIPT_REFUSED");
    expect(refused.directive_id).toBe("dir-2");
    expect(refused.unbound_paths).toEqual(["p2"]);
    expect(refused.reason).toBe("Unallocated scope");
  });

  test("verifyObligationScope rejects invalid inputs with HarnessError", () => {
    expect(() =>
      verifyObligationScope(null as unknown as DirectivePayload, {
        runId: "r",
        lanes: [],
      }),
    ).toThrow(HarnessError);

    expect(() =>
      verifyObligationScope({ directiveId: "d", targetPaths: [] }, null as unknown as PlanOrState),
    ).toThrow(HarnessError);
  });
});
