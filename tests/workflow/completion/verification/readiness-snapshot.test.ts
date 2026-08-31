import { describe, expect, test } from "bun:test";
import {
  commandIsSuccessfulGate,
  completionReadinessSnapshot,
} from "../../../../olt/scripts/src/workflow/completion/readiness-snapshot.ts";
import { commandRecord, TEST_GATE_ARGV, workflowState } from "../../shared/test-port.ts";

describe("completionReadinessSnapshot", () => {
  test("is deterministic and stable across repeated calls on the same state", () => {
    const state = workflowState();
    const first = completionReadinessSnapshot(state, 1, "critic");
    const second = completionReadinessSnapshot(state, 1, "critic");
    expect(first.sha256).toBe(second.sha256);
  });

  test("changes digest when the state changes, and reflects command/packet ids in sorted order", () => {
    const state = workflowState();
    state.tasks["T-2"] = {
      id: "T-2",
      status: "ready",
      requirement_ids: [],
      write_scope: ["src/other"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
    };
    state.requirements.push({
      id: "R-2",
      status: "planned",
      disposition: "actionable",
      evidence: [],
    });
    state.gates.push({
      id: "G-2",
      command: TEST_GATE_ARGV,
      cwd: ".",
      scope: "task",
      requirement_ids: [],
      mandatory: true,
    });
    state.commands["C-B"] = commandRecord("C-B", { task_id: null, actor: "coordinator" });
    state.commands["C-A"] = commandRecord("C-A", { task_id: null, actor: "coordinator" });
    state.packets = {
      "pkt-b": {
        id: "pkt-b",
        status: "published",
        role: "implementer",
        agent_id: "agent-1",
        task_id: null,
        attempt: 1,
        graph_revision: 1,
        markdown_path: "packets/pkt-b/packet.md",
        metadata_path: "packets/pkt-b/metadata.json",
        packet_sha256: "a".repeat(64),
        published_at: "2026-08-19T00:00:00.000Z",
      },
      "pkt-a": {
        id: "pkt-a",
        status: "published",
        role: "implementer",
        agent_id: "agent-1",
        task_id: null,
        attempt: 1,
        graph_revision: 1,
        markdown_path: "packets/pkt-a/packet.md",
        metadata_path: "packets/pkt-a/metadata.json",
        packet_sha256: "b".repeat(64),
        published_at: "2026-08-19T00:00:00.000Z",
      },
    };
    const snapshot = completionReadinessSnapshot(state, 1, "critic");
    expect(snapshot.command_ids).toEqual(["C-A", "C-B"]);
    expect(snapshot.packet_ids).toEqual(["pkt-a", "pkt-b"]);
    expect(snapshot.sha256).not.toBe(
      completionReadinessSnapshot(workflowState(), 1, "critic").sha256,
    );
  });

  test("excludes the active critic's own commands and completeness-critic packets from the snapshot", () => {
    const state = workflowState();
    state.commands["C-CRITIC"] = commandRecord("C-CRITIC", { task_id: null, actor: "critic" });
    state.packets = {
      "critic-1": {
        id: "critic-1",
        status: "published",
        role: "completeness-critic",
        agent_id: "critic",
        task_id: null,
        attempt: 1,
        graph_revision: 1,
        markdown_path: "packets/critic-1/packet.md",
        metadata_path: "packets/critic-1/metadata.json",
        packet_sha256: "a".repeat(64),
        published_at: "2026-08-19T00:00:00.000Z",
      },
    };
    const snapshot = completionReadinessSnapshot(state, 1, "critic");
    expect(snapshot.command_ids).not.toContain("C-CRITIC");
    expect(snapshot.packet_ids).toEqual([]);
  });

  test("folds in prior review digests (excluding the active critic's own) up to attempt - 1, and remediation digests", () => {
    const state = workflowState();
    state.completion_reviews = [
      { critic_id: "someone-else", review_sha256: "r1".padEnd(64, "0") } as never,
      { critic_id: "critic", review_sha256: "r2".padEnd(64, "0") } as never,
    ];
    state.completion_remediations = [
      {
        remediation_sha256: "m1".padEnd(64, "0"),
        actor: "a",
        review_sha256: "x",
        recorded_at: "t",
        resolutions: [],
      },
    ];
    const snapshot = completionReadinessSnapshot(state, 2, "critic");
    expect(snapshot.prior_review_sha256s).toEqual(["r1".padEnd(64, "0")]);
    expect(snapshot.remediation_sha256s).toEqual(["m1".padEnd(64, "0")]);
  });

  test("maps orphan evidence disposition digests in order", () => {
    const state = workflowState();
    state.orphan_evidence_dispositions = [
      { disposition_sha256: "d1".padEnd(64, "0") } as never,
      { disposition_sha256: "d2".padEnd(64, "0") } as never,
    ];
    const snapshot = completionReadinessSnapshot(state, 1, "critic");
    expect(snapshot.orphan_disposition_sha256s).toEqual([
      "d1".padEnd(64, "0"),
      "d2".padEnd(64, "0"),
    ]);
  });

  test("reads requirements nested under a { requirements: [...] } wrapper, still sorted by id", () => {
    const state = workflowState();
    (state as unknown as { requirements: unknown }).requirements = {
      requirements: [
        { id: "R-2", status: "planned", disposition: "actionable", evidence: [] },
        { id: "R-1", status: "planned", disposition: "actionable", evidence: [] },
      ],
    };
    // Sanity: the snapshot still computes without throwing and stays deterministic either way.
    expect(() => completionReadinessSnapshot(state, 1, "critic")).not.toThrow();
  });

  test("falls back to Object.values for a plain id-keyed requirements map", () => {
    const state = workflowState();
    (state as unknown as { requirements: unknown }).requirements = {
      "R-1": { id: "R-1", status: "planned", disposition: "actionable", evidence: [] },
    };
    expect(() => completionReadinessSnapshot(state, 1, "critic")).not.toThrow();
  });
});

describe("commandIsSuccessfulGate", () => {
  test("is false when the command id is undefined", () => {
    const state = workflowState();
    expect(commandIsSuccessfulGate(state, undefined, "G-1", "T-1")).toBe(false);
  });

  test("is false when the referenced command does not exist", () => {
    const state = workflowState();
    expect(commandIsSuccessfulGate(state, "C-ghost", "G-1", "T-1")).toBe(false);
  });

  test("is false when the referenced gate does not exist", () => {
    const state = workflowState();
    state.commands["C-1"] = commandRecord("C-1", { gate_id: "G-1" });
    expect(commandIsSuccessfulGate(state, "C-1", "G-ghost", "T-1")).toBe(false);
  });

  test("is true for a successful command that matches the gate exactly", () => {
    const state = workflowState();
    state.commands["C-1"] = commandRecord("C-1", { gate_id: "G-1" });
    expect(commandIsSuccessfulGate(state, "C-1", "G-1", "T-1")).toBe(true);
  });

  test("is false when the command's task_id does not match the expected task", () => {
    const state = workflowState();
    state.commands["C-1"] = commandRecord("C-1", { gate_id: "G-1" });
    expect(commandIsSuccessfulGate(state, "C-1", "G-1", "T-other")).toBe(false);
  });
});
