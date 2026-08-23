import { describe, expect, test } from "bun:test";
import {
  assertParentBranched,
  assertParentLease,
  assertParentWorking,
  resolveBranchParent,
  resumeParent,
  suspendParent,
} from "../../../../olt/scripts/src/workflow/branch/parent.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import { branchRecord, subTask } from "./fixture.ts";
import { draftWithTask, scopedLease, taskRecord } from "./task-fixture.ts";
import type { JsonObject } from "../../../../olt/scripts/src/contracts/json.ts";

const NOW = new Date("2026-08-19T00:30:00.000Z");

describe("resolveBranchParent", () => {
  test("resolves a plan task parent, filtering non-string write-scope noise", () => {
    const task = taskRecord({ write_scope: ["src/a", "src/b"] });
    const draft = draftWithTask(task);
    const parent = resolveBranchParent(draft, [], "T-1");
    expect(parent).toEqual({
      kind: "task",
      id: "T-1",
      task,
      writeScope: ["src/a", "src/b"],
      depth: 0,
    });
  });

  test("resolves a branch sub-task parent when the id is not a plan task", () => {
    const target = subTask({ id: "ST-1", write_scope: ["src/nested"] });
    const branch = branchRecord({ depth: 2, sub_tasks: [target] });
    const draft: JsonObject = { tasks: {} };
    const parent = resolveBranchParent(draft, [branch], "ST-1");
    expect(parent).toEqual({
      kind: "sub_task",
      id: "ST-1",
      branch,
      subTask: target,
      writeScope: ["src/nested"],
      depth: 2,
    });
  });

  test("throws INVALID_ARGUMENT when the parent id is neither a task nor a sub-task", () => {
    const draft: JsonObject = { tasks: {} };
    expect(() => resolveBranchParent(draft, [], "ghost")).toThrow(
      /unknown parent ghost: it is neither a plan task nor a branch sub-task/,
    );
  });

  test("throws INTEGRITY when state.tasks holds a malformed task record", () => {
    const draft: JsonObject = { tasks: { "T-1": { id: "T-1" } } };
    expect(() => resolveBranchParent(draft, [], "T-1")).toThrow(
      /state\.tasks\.T-1 is not a task record/,
    );
  });
});

describe("assertParentLease", () => {
  test("returns the lease when identity, token, and expiry all check out", () => {
    const token = "a-valid-token";
    const task = taskRecord({
      lease: scopedLease({ agent_id: "agent-1", token_digest: tokenDigest(token) }),
    });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    expect(assertParentLease(parent, "agent-1", token, NOW)).toEqual(
      task.lease as unknown as JsonObject,
    );
  });

  test("throws INVALID_STATE when the parent holds no lease at all", () => {
    const task = taskRecord();
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    expect(() => assertParentLease(parent, "agent-1", "tok", NOW)).toThrow(/T-1 holds no lease/);
  });

  test("throws INVALID_STATE when the agent id does not match", () => {
    const token = "a-valid-token";
    const task = taskRecord({
      lease: scopedLease({ agent_id: "agent-1", token_digest: tokenDigest(token) }),
    });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    expect(() => assertParentLease(parent, "agent-2", token, NOW)).toThrow(
      /lease identity or token is invalid/,
    );
  });

  test("throws INVALID_STATE when the token does not match the digest", () => {
    const task = taskRecord({
      lease: scopedLease({ agent_id: "agent-1", token_digest: tokenDigest("real-token") }),
    });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    expect(() => assertParentLease(parent, "agent-1", "wrong-token", NOW)).toThrow(
      /lease identity or token is invalid/,
    );
  });

  test("throws INVALID_STATE when an active (non-suspended) lease has expired", () => {
    const token = "a-valid-token";
    const task = taskRecord({
      lease: scopedLease({
        agent_id: "agent-1",
        token_digest: tokenDigest(token),
        expires_at: "2026-08-19T00:00:00.000Z",
      }),
    });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    expect(() => assertParentLease(parent, "agent-1", token, NOW)).toThrow(/lease has expired/);
  });

  test("accepts an expired lease when its clock is suspended", () => {
    const token = "a-valid-token";
    const task = taskRecord({
      lease: scopedLease({
        agent_id: "agent-1",
        token_digest: tokenDigest(token),
        expires_at: "2026-08-19T00:00:00.000Z",
        suspended_at: "2026-08-19T00:05:00.000Z",
      }),
    });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    expect(assertParentLease(parent, "agent-1", token, NOW)).toBeDefined();
  });

  test("resolves and asserts a sub-task parent's lease the same way", () => {
    const token = "a-valid-token";
    const target = subTask({
      id: "ST-1",
      status: "claimed",
      lease: {
        agent_id: "agent-9",
        token_digest: tokenDigest(token),
        issued_at: "t",
        expires_at: "2026-08-19T01:00:00.000Z",
        duration_seconds: 600,
      },
    });
    const branch = branchRecord({ sub_tasks: [target] });
    const parent = resolveBranchParent({ tasks: {} }, [branch], "ST-1");
    expect(assertParentLease(parent, "agent-9", token, NOW)).toBeDefined();
  });
});

describe("assertParentWorking", () => {
  test("accepts a task parent that is leased or running", () => {
    for (const status of ["leased", "running"] as const) {
      const parent = resolveBranchParent(draftWithTask(taskRecord({ status })), [], "T-1");
      expect(() => assertParentWorking(parent)).not.toThrow();
    }
  });

  test("rejects a task parent in any other status", () => {
    const parent = resolveBranchParent(draftWithTask(taskRecord({ status: "done" })), [], "T-1");
    expect(() => assertParentWorking(parent)).toThrow(/task T-1 is done and cannot open a branch/);
  });

  test("accepts a claimed sub-task parent", () => {
    const target = subTask({ id: "ST-1", status: "claimed" });
    const branch = branchRecord({ sub_tasks: [target] });
    const parent = resolveBranchParent({ tasks: {} }, [branch], "ST-1");
    expect(() => assertParentWorking(parent)).not.toThrow();
  });

  test("rejects a sub-task parent that is not claimed", () => {
    const target = subTask({ id: "ST-1", status: "open" });
    const branch = branchRecord({ sub_tasks: [target] });
    const parent = resolveBranchParent({ tasks: {} }, [branch], "ST-1");
    expect(() => assertParentWorking(parent)).toThrow(
      /sub-task ST-1 is open and cannot open a branch/,
    );
  });
});

describe("assertParentBranched", () => {
  test("accepts a task parent whose status is branched", () => {
    const parent = resolveBranchParent(
      draftWithTask(taskRecord({ status: "branched" })),
      [],
      "T-1",
    );
    expect(() => assertParentBranched(parent)).not.toThrow();
  });

  test("rejects a task parent whose status is not branched", () => {
    const parent = resolveBranchParent(draftWithTask(taskRecord({ status: "running" })), [], "T-1");
    expect(() => assertParentBranched(parent)).toThrow(/T-1 is running, not branched/);
  });

  test("checks the sub-task status for a sub-task parent", () => {
    const target = subTask({ id: "ST-1", status: "branched" });
    const branch = branchRecord({ sub_tasks: [target] });
    const parent = resolveBranchParent({ tasks: {} }, [branch], "ST-1");
    expect(() => assertParentBranched(parent)).not.toThrow();
  });
});

describe("suspendParent / resumeParent", () => {
  test("suspendParent suspends a task's lease and transitions it to branched, recording history", () => {
    const task = taskRecord({ status: "running", lease: scopedLease() });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    suspendParent(parent, "coordinator", NOW, "opening a branch");
    expect(task.status).toBe("branched");
    expect(task.lease?.suspended_at).toBe(NOW.toISOString());
    expect(task.history.at(-1)).toEqual({
      at: NOW.toISOString(),
      actor: "coordinator",
      from: "running",
      to: "branched",
      reason: "opening a branch",
      attempt: 0,
    });
  });

  test("suspendParent suspends a sub-task's lease and flips its status directly (no history)", () => {
    const target = subTask({
      id: "ST-1",
      status: "claimed",
      lease: {
        agent_id: "a",
        token_digest: "d",
        issued_at: "t",
        expires_at: "e",
        duration_seconds: 60,
      },
    });
    const branch = branchRecord({ sub_tasks: [target] });
    const parent = resolveBranchParent({ tasks: {} }, [branch], "ST-1");
    suspendParent(parent, "coordinator", NOW, "opening a branch");
    expect(target.status).toBe("branched");
    expect(target.lease?.suspended_at).toBe(NOW.toISOString());
  });

  test("resumeParent restores a task's lease duration and transitions it back to running", () => {
    const task = taskRecord({
      status: "branched",
      lease: scopedLease({ suspended_at: "2026-08-19T00:10:00.000Z", duration_seconds: 900 }),
    });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    resumeParent(parent, "coordinator", NOW, "branch collected");
    expect(task.status).toBe("running");
    expect(task.lease?.suspended_at).toBeUndefined();
    expect(task.lease?.expires_at).toBe(new Date(NOW.valueOf() + 900_000).toISOString());
  });

  test("resumeParent restores a sub-task's lease and flips its status back to claimed", () => {
    const target = subTask({
      id: "ST-1",
      status: "branched",
      lease: {
        agent_id: "a",
        token_digest: "d",
        issued_at: "t",
        expires_at: "e",
        duration_seconds: 300,
        suspended_at: "2026-08-19T00:10:00.000Z",
      },
    });
    const branch = branchRecord({ sub_tasks: [target] });
    const parent = resolveBranchParent({ tasks: {} }, [branch], "ST-1");
    resumeParent(parent, "coordinator", NOW, "branch collected");
    expect(target.status).toBe("claimed");
    expect(target.lease?.suspended_at).toBeUndefined();
  });

  test("resumeParent throws INTEGRITY when the lease has no usable duration", () => {
    const task = taskRecord({
      status: "branched",
      lease: scopedLease({ suspended_at: "2026-08-19T00:10:00.000Z", duration_seconds: 0 }),
    });
    const parent = resolveBranchParent(draftWithTask(task), [], "T-1");
    expect(() => resumeParent(parent, "coordinator", NOW, "x")).toThrow(
      /lease has no usable duration/,
    );
  });
});
