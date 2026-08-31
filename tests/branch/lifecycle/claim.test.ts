import { describe, expect, it } from "bun:test";
import {
  isBranchSubTaskStatus,
  type BranchSubTask,
} from "../../../olt/scripts/src/core/contracts/index.ts";

describe("Branch Lifecycle: Sub-Task Claims & Status Invariants", () => {
  it("discriminates valid branch sub-task statuses", () => {
    expect(isBranchSubTaskStatus("open")).toBe(true);
    expect(isBranchSubTaskStatus("claimed")).toBe(true);
    expect(isBranchSubTaskStatus("submitted")).toBe(true);
    expect(isBranchSubTaskStatus("abandoned")).toBe(true);
    expect(isBranchSubTaskStatus("branched")).toBe(true);
    expect(isBranchSubTaskStatus("invalid-status")).toBe(false);
  });

  it("evaluates claimed sub-task with lease", () => {
    const subTask: BranchSubTask = {
      id: "S-1",
      label: "Fix parser",
      write_scope: ["src/parser"],
      status: "claimed",
      agent_id: "agent-1",
      claimed_at: "2026-08-31T00:00:00Z",
      lease: {
        agent_id: "agent-1",
        token_digest: "digest123",
        issued_at: "2026-08-31T00:00:00Z",
        expires_at: "2026-08-31T00:10:00Z",
        duration_seconds: 600,
      },
    };
    expect(subTask.status).toBe("claimed");
    expect(subTask.lease?.duration_seconds).toBe(600);
  });
});
