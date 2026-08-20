import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import {
  buildStateTransitions,
  readLog,
  readLogText,
  LOG_READ_CEILING_BYTES,
} from "../../../orchestrating-long-tasks/scripts/src/summary/node-evidence.ts";
import { makeCommand, makeEvent, makeGrant, makeState, makeTask } from "./graph-fixtures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function runRootWithStdout(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "node-evidence-"));
  roots.push(root);
  mkdirSync(join(root, "commands", "C-1"), { recursive: true });
  writeFileSync(join(root, "commands", "C-1", "stdout.log"), contents);
  return root;
}

describe("node scripts", () => {
  test("reads the real log bytes the runner wrote, whole", () => {
    const body = `${"x".repeat(8192)}TAIL-MARKER`;
    const runRoot = runRootWithStdout(body);
    const command = makeCommand("C-1", {
      task_id: "T-1",
      logs: {
        stdout: { path: "commands/C-1/stdout.log", bytes: 4096, sha256: "a" },
        stderr: { path: "commands/C-1/stderr.log", bytes: 0, sha256: "b" },
      },
    });
    const dataset = generateGraphDataset({
      runId: "run-scripts",
      state: makeState([makeTask("T-1")]),
      commands: { "C-1": command },
      runRoot,
    });

    const script = dataset.nodes.find((node) => node.id === "node-task-T-1")?.scripts?.[0];
    expect(script?.commandId).toBe("C-1");
    expect(script?.argv).toEqual(["bun", "test"]);
    expect(script?.exitCode).toBe(0);
    expect(script?.durationMs).toBe(1000);
    expect(script?.evidence_class).toBe("harness_observed");
    expect(script?.stdoutTail).toBe(body);
    expect(script?.stdoutTruncated).toBeUndefined();
    expect(script?.stdoutBytes).toBe(4096);
    expect(script?.stdoutSha256).toBe("a");
    expect(script?.stderrTail).toBeUndefined();
  });

  test("flags the one case a log is clipped, and never clips silently", () => {
    const runRoot = runRootWithStdout(`HEAD${"x".repeat(200)}TAIL-MARKER`);
    const clipped = readLog("commands/C-1/stdout.log", runRoot, 32);
    expect(clipped?.truncated).toBe(true);
    expect(clipped?.text.endsWith("TAIL-MARKER")).toBe(true);
    expect(clipped?.text.includes("HEAD")).toBe(false);
    const whole = readLog("commands/C-1/stdout.log", runRoot);
    expect(whole?.truncated).toBe(false);
    expect(whole?.text.startsWith("HEAD")).toBe(true);
    expect(LOG_READ_CEILING_BYTES).toBeGreaterThan(1024 * 1024);
  });

  test("leaves the log absent when the file is missing", () => {
    expect(readLog("commands/C-1/stdout.log", "/nonexistent")).toBeUndefined();
    expect(readLog(undefined)).toBeUndefined();
    expect(readLogText(undefined)).toBeUndefined();
  });
});

describe("node tools", () => {
  test("come from the grant ledger with their own evidence class", () => {
    const grants = [
      makeGrant("worker-1", {
        tools_used: [
          {
            name: "Edit",
            evidence_class: "host_reported",
            first_reported_at: "2026-08-14T20:01:00.000Z",
          },
        ],
        tools_granted: {
          value: [{ name: "Edit" }, { name: "Bash", category: "shell" }],
          evidence_class: "agent_reported",
        },
      }),
    ];
    const task = makeTask("T-1", {
      lease: {
        agent_id: "worker-1",
        role: "implementer",
        attempt: 1,
        token_digest: "tok",
        issued_at: "2026-08-14T20:00:00.000Z",
        expires_at: "2026-08-14T21:00:00.000Z",
        heartbeat_at: "2026-08-14T20:00:00.000Z",
        duration_seconds: 3600,
        write_scope: ["src/T-1.ts"],
        resource_scope: [],
      },
    });
    const dataset = generateGraphDataset({
      runId: "run-tools",
      state: makeState([task], { agents: grants }),
    });

    expect(dataset.nodes.find((node) => node.id === "node-task-T-1")?.tools).toEqual([
      {
        name: "Edit",
        evidence_class: "host_reported",
        firstReportedAt: "2026-08-14T20:01:00.000Z",
      },
      { name: "Bash", category: "shell", evidence_class: "agent_reported" },
    ]);
  });

  test("are absent for an agent with no grant", () => {
    const dataset = generateGraphDataset({
      runId: "run-no-tools",
      state: makeState([makeTask("T-1")]),
    });
    expect(dataset.nodes.find((node) => node.id === "node-task-T-1")?.tools).toBeUndefined();
  });
});

describe("state transitions", () => {
  const task = makeTask("T-1", {
    status: "done",
    probe_round: 1,
    repair_round: 1,
    history: [
      {
        at: "2026-08-14T20:00:00.000Z",
        actor: "worker-1",
        from: "ready",
        to: "leased",
        reason: "claimed",
        attempt: 1,
      },
      {
        at: "2026-08-14T20:20:00.000Z",
        actor: "val-1",
        from: "validating",
        to: "changes_requested",
        reason: "review",
        attempt: 1,
      },
    ],
  });

  test("mirror task.history as harness-observed moves", () => {
    const transitions = buildStateTransitions(task);
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toEqual({
      at: "2026-08-14T20:00:00.000Z",
      actor: "worker-1",
      from: "ready",
      to: "leased",
      reason: "claimed",
      attempt: 1,
      evidence_class: "harness_observed",
    });
  });

  test("absorb the enriched review payload and record the probe round separately", () => {
    const events = [
      makeEvent("probe-recorded", 1, "2026-08-14T20:10:00.000Z", "val-1", {
        task_id: "T-1",
        round: 1,
        finding_ids: ["F-demand"],
      }),
      makeEvent("review-recorded", 2, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
        verdict: "reject",
        round: 1,
        class: "defect",
        finding_count: 2,
      }),
    ];
    const transitions = buildStateTransitions(task, events);

    const probe = transitions.find((entry) => entry.verdict === "probe");
    expect(probe?.from).toBe("validating");
    expect(probe?.to).toBe("validating");
    expect(probe?.round).toBe(1);
    expect(probe?.findingCount).toBe(1);

    const review = transitions.find((entry) => entry.to === "changes_requested");
    expect(review?.verdict).toBe("reject");
    expect(review?.findingClass).toBe("defect");
    expect(review?.findingCount).toBe(2);
  });

  test("refuse to label a pass with the class of the findings it closed", () => {
    // A passing review states the class of the findings it RESOLVED. Carrying that onto the move it
    // caused made a pass that closed a probe demand read as a probe round in the state machine.
    const passing = makeTask("T-1", {
      status: "done",
      history: [
        {
          at: "2026-08-14T20:20:00.000Z",
          actor: "val-1",
          from: "validating",
          to: "validated",
          reason: "review",
          attempt: 1,
        },
      ],
    });
    const events = [
      makeEvent("review-recorded", 1, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
        verdict: "pass",
        round: 0,
        class: "probe_demand",
        finding_count: 0,
        resolved_count: 1,
      }),
    ];
    const review = buildStateTransitions(passing, events).find((entry) => entry.to === "validated");
    expect(review?.verdict).toBe("pass");
    expect(review?.findingClass).toBeUndefined();
    expect(review?.findingCount).toBe(0);
  });

  test("tolerate a capsule whose review events carry only a task id", () => {
    const events = [
      makeEvent("review-recorded", 1, "2026-08-14T20:20:00.000Z", "val-1", { task_id: "T-1" }),
    ];
    const review = buildStateTransitions(task, events).find(
      (entry) => entry.to === "changes_requested",
    );
    expect(review?.verdict).toBeUndefined();
    expect(review?.findingCount).toBeUndefined();
    expect(review?.evidence_class).toBe("harness_observed");
  });

  test("land on the implementer node and nowhere else", () => {
    const dataset = generateGraphDataset({
      runId: "run-transitions",
      state: makeState([task]),
    });
    const withTransitions = dataset.nodes.filter((node) => node.stateTransitions !== undefined);
    expect(withTransitions.map((node) => node.id)).toEqual(["node-task-T-1"]);
    expect(withTransitions[0]?.stateTransitions).toHaveLength(2);
  });
});
