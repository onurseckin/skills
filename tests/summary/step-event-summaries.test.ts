import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../olt/scripts/src/core/contracts/index.ts";
import { narrateUnclassifiedEvent } from "../../olt/scripts/src/summary/metrics/index.ts";

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

  test("plan-recompiled names its repair round and how many new tasks it produced", () => {
    expect(
      narrateUnclassifiedEvent(
        createEvent(
          "plan-recompiled",
          { new_tasks: ["T-9", "T-10"], repair_round: 2 },
          "coordinator-1",
        ),
      )?.summary,
    ).toBe("Plan recompiled by coordinator-1 for repair round 2: 2 new task(s)");
    // With neither field, the round clause drops out and the count reads as zero, not a guess.
    expect(
      narrateUnclassifiedEvent(createEvent("plan-recompiled", {}, "coordinator-1"))?.summary,
    ).toBe("Plan recompiled by coordinator-1: 0 new task(s)");
  });

  test("plan-audited counts blocking findings, and plan-audit-accepted names the overridden invariant", () => {
    const audited = narrateUnclassifiedEvent(
      createEvent("plan-audited", { blocking_count: 2, task_count: 4 }, "auditor-1"),
    );
    expect(audited?.phase).toBe("planning");
    expect(audited?.summary).toBe(
      "Plan audited by auditor-1: 2 blocking finding(s) across 4 task(s)",
    );
    expect(narrateUnclassifiedEvent(createEvent("plan-audited", {}, "auditor-1"))?.summary).toBe(
      "Plan audited by auditor-1: 0 blocking finding(s)",
    );

    expect(
      narrateUnclassifiedEvent(
        createEvent(
          "plan-audit-accepted",
          { invariant: "no-orphan-tasks", reason: "the orphan is a genuine no-op" },
          "coordinator-1",
        ),
      )?.summary,
    ).toBe(
      "Audit override recorded by coordinator-1 for no-orphan-tasks: the orphan is a genuine no-op",
    );
  });

  test("critic-assigned, completion-reviewed and completion-remediated each name the critic's own record", () => {
    expect(narrateUnclassifiedEvent(createEvent("critic-assigned", {}, "critic-1"))?.summary).toBe(
      "Completeness critic round assigned to critic-1",
    );

    const reviewed = narrateUnclassifiedEvent(
      createEvent(
        "completion-reviewed",
        { packet_id: "P-1", status: "findings", summary: "two residual risks accepted" },
        "critic-1",
      ),
    );
    expect(reviewed?.phase).toBe("review");
    expect(reviewed?.summary).toBe(
      "Completion review recorded by critic-1 (packet P-1) [findings]: two residual risks accepted",
    );
    // Without a packet id or status, both bracketed clauses drop rather than rendering empty.
    expect(
      narrateUnclassifiedEvent(createEvent("completion-reviewed", {}, "critic-1"))?.summary,
    ).toBe("Completion review recorded by critic-1: no summary recorded");

    expect(
      narrateUnclassifiedEvent(createEvent("completion-remediated", {}, "coordinator-1"))?.summary,
    ).toBe("Completion remediation recorded by coordinator-1");
  });

  test("requirement-authority-decided names the requirement and the decision reached", () => {
    const narrated = narrateUnclassifiedEvent(
      createEvent(
        "requirement-authority-decided",
        { requirement_id: "REQ-1", decision: "waived" },
        "coordinator-1",
      ),
    );
    expect(narrated?.phase).toBe("review");
    expect(narrated?.summary).toBe("Requirement REQ-1 authority decision by coordinator-1: waived");
  });

  test("repository-inspected, lease-heartbeat, lease-released and stale-recovery each state their own moment", () => {
    expect(
      narrateUnclassifiedEvent(
        createEvent("repository-inspected", { phase: "baseline" }, "coordinator-1"),
      )?.summary,
    ).toBe("Repository inspected (baseline) by coordinator-1");

    expect(
      narrateUnclassifiedEvent(createEvent("lease-heartbeat", { task_id: "T-1" }, "worker-1"))
        ?.summary,
    ).toBe("Lease for task T-1 heartbeat recorded by worker-1");
    expect(
      narrateUnclassifiedEvent(createEvent("lease-released", { task_id: "T-1" }, "worker-1"))
        ?.summary,
    ).toBe("Lease for task T-1 released by worker-1");

    expect(
      narrateUnclassifiedEvent(createEvent("stale-recovery", {}, "coordinator-1"))?.summary,
    ).toBe("Stale lease recovery run by coordinator-1");
  });

  test("orphan-evidence-dispositioned names the orphan's own digest, truncated, when one was recorded", () => {
    const withSha = narrateUnclassifiedEvent(
      createEvent(
        "orphan-evidence-dispositioned",
        { orphan_sha256: "abcdef0123456789fedcba9876543210" },
        "coordinator-1",
      ),
    );
    expect(withSha?.summary).toBe(
      "Orphan evidence disposition recorded by coordinator-1 (abcdef012345)",
    );
    expect(
      narrateUnclassifiedEvent(createEvent("orphan-evidence-dispositioned", {}, "coordinator-1"))
        ?.summary,
    ).toBe("Orphan evidence disposition recorded by coordinator-1");
  });
});
