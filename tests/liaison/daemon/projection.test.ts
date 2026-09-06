import { describe, expect, it } from "bun:test";
import {
  computeStateProjection,
  inspectDirectCapsule,
} from "../../../olt/scripts/src/liaison/daemon/projection.ts";
import type { GitRunner } from "../../../olt/scripts/src/liaison/daemon/types.ts";

describe("computeStateProjection", () => {
  it("exposes serial execution masquerading as parallel plan via concurrency ratio", () => {
    // 4 tasks, but all leased or claimed by ONE single implementer (forensics §2.9)
    const mockState = {
      run_id: "wave-serial",
      tasks: {
        "lane-1": {
          id: "lane-1",
          status: "leased",
          lease: { agent_id: "implementer_single", role: "implementer" },
        },
        "lane-2": {
          id: "lane-2",
          status: "leased",
          lease: { agent_id: "implementer_single", role: "implementer" },
        },
        "lane-3": {
          id: "lane-3",
          status: "ready",
          original_implementer: "implementer_single",
        },
        "lane-4": {
          id: "lane-4",
          status: "ready",
          attempts: [{ agent_id: "implementer_single", role: "implementer" }],
        },
      },
    };

    const dummyGit: GitRunner = () => ({
      ok: true,
      stdout: "# branch.oid c0ffee\n# branch.head feature\n# branch.ab +0 -0\n",
      stderr: "",
    });

    const projection = computeStateProjection({
      stateJson: mockState,
      gitRunner: dummyGit,
    });

    expect(projection.run_id).toBe("wave-serial");
    expect(projection.concurrency.lane_count).toBe(4);
    expect(projection.concurrency.distinct_implementer_count).toBe(1);
    expect(projection.concurrency.distinct_implementers).toEqual(["implementer_single"]);
    expect(projection.concurrency.ratio).toBe(0.25);

    const parallelismMetric = projection.metrics.find(
      (m) => m.name === "implementer_parallelism_ratio",
    );
    expect(parallelismMetric).toBeDefined();
    expect(parallelismMetric?.passed).toBe(false);
    expect(parallelismMetric?.value).toBe(0.25);
  });

  it("computes true parallel execution with distinct implementers per lane", () => {
    const mockState = {
      run_id: "wave-parallel",
      tasks: {
        "lane-1": {
          id: "lane-1",
          status: "done",
          lease: { agent_id: "implementer_alpha", role: "implementer" },
        },
        "lane-2": {
          id: "lane-2",
          status: "done",
          lease: { agent_id: "implementer_beta", role: "implementer" },
        },
        "lane-3": {
          id: "lane-3",
          status: "done",
          lease: { agent_id: "implementer_gamma", role: "implementer" },
        },
      },
    };

    const dummyGit: GitRunner = () => ({
      ok: true,
      stdout: "# branch.oid deadbeef\n# branch.head main\n# branch.ab +1 -0\n",
      stderr: "",
    });

    const projection = computeStateProjection({
      stateJson: mockState,
      gitRunner: dummyGit,
    });

    expect(projection.run_state).toBe("completed");
    expect(projection.concurrency.lane_count).toBe(3);
    expect(projection.concurrency.distinct_implementer_count).toBe(3);
    expect(projection.concurrency.distinct_implementers).toEqual([
      "implementer_alpha",
      "implementer_beta",
      "implementer_gamma",
    ]);
    expect(projection.concurrency.ratio).toBe(1);

    const parallelismMetric = projection.metrics.find(
      (m) => m.name === "implementer_parallelism_ratio",
    );
    expect(parallelismMetric?.passed).toBe(true);

    const completionMetric = projection.metrics.find((m) => m.name === "task_completion_rate");
    expect(completionMetric?.passed).toBe(true);
    expect(completionMetric?.value).toBe(1);
  });

  it("parses git status porcelain v2 correctly", () => {
    const mockGit: GitRunner = (args) => {
      if (args.includes("status")) {
        return {
          ok: true,
          stdout: [
            "# branch.oid 1234567890abcdef",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +3 -2",
            "1 .M... 100644 100644 100644 abc def src/file.ts",
            "? untracked.txt",
          ].join("\n"),
          stderr: "",
        };
      }
      return { ok: false, stdout: "", stderr: "unknown" };
    };

    const projection = computeStateProjection({
      stateJson: { run_id: "test-git", tasks: {} },
      gitRunner: mockGit,
    });

    expect(projection.git.available).toBe(true);
    expect(projection.git.head).toBe("1234567890abcdef");
    expect(projection.git.branch).toBe("main");
    expect(projection.git.ahead).toBe(3);
    expect(projection.git.behind).toBe(2);
    expect(projection.git.dirty_count).toBe(2);

    const cleanliness = projection.metrics.find((m) => m.name === "working_tree_cleanliness");
    expect(cleanliness?.passed).toBe(false);
    expect(cleanliness?.value).toBe(2);
  });

  it("handles git failure gracefully", () => {
    const failingGit: GitRunner = () => ({
      ok: false,
      stdout: "",
      stderr: "fatal: not a git repository",
    });

    const projection = computeStateProjection({
      stateJson: { run_id: "no-git", tasks: {} },
      gitRunner: failingGit,
    });

    expect(projection.git.available).toBe(false);
    expect(projection.git.head).toBeNull();
    expect(projection.git.dirty_count).toBe(0);
  });

  it("parses capsule events for event count and last event timestamp", () => {
    const eventLines = [
      JSON.stringify({ sequence: 1, timestamp: "2026-09-06T00:00:00.000Z", actor: "mind-1" }),
      JSON.stringify({
        sequence: 2,
        timestamp: "2026-09-06T00:01:00.000Z",
        actor: "implementer_agent_1",
        payload: { role: "implementer", agent_id: "implementer_agent_1" },
      }),
    ];

    const projection = computeStateProjection({
      stateJson: { run_id: "events-run", tasks: {} },
      eventsJsonlLines: eventLines,
      gitRunner: () => ({ ok: true, stdout: "", stderr: "" }),
    });

    expect(projection.capsule_event_count).toBe(2);
    expect(projection.last_event_timestamp).toBe("2026-09-06T00:01:00.000Z");
    expect(projection.last_event_sequence).toBe(2);
    expect(projection.distinct_implementer_identities).toContain("implementer_agent_1");
  });
});

describe("inspectDirectCapsule (graceful fallback)", () => {
  it("inspects the actual active run capsule directly without daemon process", () => {
    const projection = inspectDirectCapsule(
      ".olt/capsules/cross-system-communication-system",
      process.cwd(),
    );

    expect(projection.run_id).toBe("cross-system-communication-system");
    expect(projection.tasks.length).toBeGreaterThanOrEqual(4);
    expect(projection.capsule_event_count).toBeGreaterThan(0);
    expect(projection.git.available).toBe(true);
    expect(projection.metrics.length).toBeGreaterThanOrEqual(4);
  });

  it("degrades gracefully without throwing when capsule directory does not exist", () => {
    const projection = inspectDirectCapsule(
      "/tmp/nonexistent-capsule-directory-xyz",
      process.cwd(),
    );

    expect(projection).toBeDefined();
    expect(projection.tasks).toEqual([]);
    expect(projection.capsule_event_count).toBe(0);
  });
});
