import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import { narrateUnclassifiedEvent } from "../../../orchestrating-long-tasks/scripts/src/summary/step-event-summaries.ts";

function createEvent(
  kind: string,
  payload: Record<string, unknown> = {},
  actor = "actor-1",
): HarnessEvent {
  return {
    schema: "harness.event",
    version: 1,
    run_id: "test-run",
    capsule_id: "test-capsule",
    sequence: 1,
    revision: 1,
    timestamp: "2026-08-20T20:00:00.000Z",
    actor,
    kind,
    payload,
    previous_hash: null,
    projection: {
      schema: "harness.state",
      version: 1,
      revision: 1,
      event_sequence: 1,
      event_head: null,
    },
    hash: "hash",
  };
}

describe("narrateUnclassifiedEvent", () => {
  test("a kind genuinely nobody has named yet stays undefined, not a guess", () => {
    expect(
      narrateUnclassifiedEvent(createEvent("some-future-kind-nobody-wrote-yet")),
    ).toBeUndefined();
  });

  test("branch-opened carries the parent task and the reason the branch was opened for", () => {
    const narrated = narrateUnclassifiedEvent(
      createEvent(
        "branch-opened",
        {
          branch_id: "B-1",
          parent_task_id: "T-1",
          reason: "the flush path needs its own investigation",
        },
        "worker-beta",
      ),
    );
    expect(narrated?.phase).toBe("branch");
    expect(narrated?.summary).toBe(
      "Branch B-1 opened off T-1 by worker-beta: the flush path needs its own investigation",
    );
  });

  test("branch-submitted carries the sub-task's own submitted summary, not a placeholder", () => {
    const narrated = narrateUnclassifiedEvent(
      createEvent(
        "branch-submitted",
        {
          branch_id: "B-1",
          sub_task_id: "S-1",
          summary: "a partial flush reproduces under a short buffer",
        },
        "sub-beta-1",
      ),
    );
    expect(narrated?.summary).toBe(
      "Sub-task S-1 of branch B-1 submitted by sub-beta-1: a partial flush reproduces under a short buffer",
    );
  });

  test("branch-collected, branch-claimed and branch-abandoned each surface their own payload", () => {
    expect(
      narrateUnclassifiedEvent(
        createEvent("branch-collected", { branch_id: "B-1", summary: "unblocked" }, "worker-beta"),
      )?.summary,
    ).toBe("Branch B-1 collected by worker-beta: unblocked");
    expect(
      narrateUnclassifiedEvent(
        createEvent("branch-claimed", { branch_id: "B-1", sub_task_id: "S-1" }, "sub-beta-1"),
      )?.summary,
    ).toBe("Sub-task S-1 of branch B-1 claimed by sub-beta-1");
    expect(
      narrateUnclassifiedEvent(createEvent("branch-abandoned", { branch_id: "B-1" }, "worker-beta"))
        ?.summary,
    ).toBe("Branch B-1 abandoned by worker-beta: no reason recorded");
  });

  test("agent-registered names the role and host; agent-released names the reason", () => {
    expect(
      narrateUnclassifiedEvent(
        createEvent("agent-registered", {
          agent_id: "A-1",
          role: "implementer",
          host: "claude-code",
        }),
      )?.summary,
    ).toBe("Agent A-1 registered as implementer on claude-code");
    expect(
      narrateUnclassifiedEvent(
        createEvent("agent-released", { agent_id: "A-1", reason: "task-1 submitted" }),
      )?.summary,
    ).toBe("Agent A-1 released by actor-1: task-1 submitted");
  });

  test("agent-reported names the tools and token counts it actually carried, nothing invented", () => {
    const withData = narrateUnclassifiedEvent(
      createEvent("agent-reported", { agent_id: "A-1", tools: ["Read", "Edit"], tokens_in: 100 }),
    );
    expect(withData?.summary).toBe("Agent A-1 reported telemetry (tools: Read, Edit, in: 100)");
    // No tools, no token counts on the payload: the parenthetical is dropped rather than emitted empty.
    const empty = narrateUnclassifiedEvent(createEvent("agent-reported", { agent_id: "A-1" }));
    expect(empty?.summary).toBe("Agent A-1 reported telemetry");
  });

  test("probe-recorded states the round and finding count the payload actually carried", () => {
    const narrated = narrateUnclassifiedEvent(
      createEvent(
        "probe-recorded",
        { task_id: "T-1", round: 2, finding_ids: ["F-1", "F-2"] },
        "val-1",
      ),
    );
    expect(narrated?.phase).toBe("validation");
    expect(narrated?.summary).toBe("Probe recorded by val-1 for task T-1 round 2 (2 finding(s))");
  });

  test("gate-attached, packet-prepared and packet-published name their own subject", () => {
    expect(
      narrateUnclassifiedEvent(
        createEvent("gate-attached", { task_id: "T-1", gate_id: "gate-1" }, "val-1"),
      )?.summary,
    ).toBe("Gate gate-1 attached to task T-1 by val-1");
    expect(
      narrateUnclassifiedEvent(createEvent("packet-prepared", { packet_id: "P-1" }, "worker-1"))
        ?.summary,
    ).toBe("Packet P-1 prepared by worker-1");
    expect(
      narrateUnclassifiedEvent(createEvent("packet-published", { packet_id: "P-1" }, "worker-1"))
        ?.summary,
    ).toBe("Packet P-1 published by worker-1");
  });

  test("topology-recorded and plan-enhanced state the counts the payload carried", () => {
    expect(
      narrateUnclassifiedEvent(
        createEvent("topology-recorded", { wave_count: 3, task_count: 5 }, "coordinator-1"),
      )?.summary,
    ).toBe("Topology recorded by coordinator-1: 3 wave(s) over 5 task(s)");
    expect(
      narrateUnclassifiedEvent(
        createEvent("plan-enhanced", { todo_count: 2, observation_count: 1 }, "coordinator-1"),
      )?.summary,
    ).toBe("Plan enhanced by coordinator-1 (1 observations, 2 todos)");
  });

  test("a field the payload never stated renders as an explicit absence, never a fabricated one", () => {
    const narrated = narrateUnclassifiedEvent(
      createEvent("replacement-repairer-assigned", {}, "coordinator-1"),
    );
    expect(narrated?.summary).toBe(
      "Task an unrecorded task reassigned to an unrecorded agent by coordinator-1: no reason recorded",
    );
  });
});
