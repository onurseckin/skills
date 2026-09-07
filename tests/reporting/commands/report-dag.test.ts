import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { reportDagCommand } from "../../../olt/scripts/src/cli/commands/reporting/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

mock.module("../../../olt/scripts/src/engine/store/integrity/integrity.ts", () => ({
  verifyIntegrity: () => [],
}));

describe("Reporting Commands - report:dag Handler", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let capsule: string;

  function createVirtualCapsule(name: string): string {
    const repo = `/virtual/reporting/${name}`;
    vfs.mkdirSync(repo, { recursive: true });
    const runRoot = initRun(
      repo,
      `${name}-run`,
      new TextEncoder().encode("Test prompt content"),
      "file",
      true,
    );

    transact(runRoot, "planner", "plan-applied", {}, (state) => {
      state.graph = {
        revision: 1,
        nodes: [
          {
            id: "task-1",
            requirement_ids: ["R-1"],
            read_scope: [],
            write_scope: ["src/index.ts"],
            type: "task",
          },
        ],
        edges: [],
        gates: [
          {
            id: "gate-1",
            scope: "task",
            cwd: ".",
            command: ["bun", "test"],
            requirement_ids: ["R-1"],
            mandatory: true,
          },
        ],
      };
      state.requirements = {
        requirements: [{ id: "R-1", disposition: "actionable", status: "planned", evidence: [] }],
      };
      state.tasks = {
        "task-1": {
          id: "task-1",
          status: "ready",
          requirement_ids: ["R-1"],
          dependencies: [],
          write_scope: ["src/index.ts"],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      };
    });

    return runRoot;
  }

  beforeAll(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(process.cwd(), { recursive: true });
    session = createVirtualFSSession(vfs);
    capsule = createVirtualCapsule("report-dag");
  });

  afterAll(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  it("executes reportDagCommand without crash on default repo", () => {
    const res = reportDagCommand({ run: capsule });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
  });

  it("handles --json flag cleanly", () => {
    const res = reportDagCommand({ run: capsule, json: true });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
  });
});
