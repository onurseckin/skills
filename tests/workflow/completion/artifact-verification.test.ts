import { describe, expect, test } from "bun:test";
import {
  completionArtifactRequirements,
  validateCompletionArtifactVerification,
} from "../../../olt/scripts/src/workflow/completion/artifact-verification.ts";
import { commandRecord, repositoryBinding, TEST_GATE_ARGV, workflowState } from "../test-port.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import type { CompletionRemediation } from "../../../olt/scripts/src/workflow/completion/types.ts";

function baseState(): WorkflowState {
  const state = workflowState();
  delete state.tasks["T-1"]; // no plan tasks needed for this file's requirement-gathering logic
  state.requirements = [];
  state.gates = [
    {
      id: "G-RUN",
      command: TEST_GATE_ARGV,
      cwd: ".",
      scope: "run",
      requirement_ids: [],
      mandatory: true,
    },
  ];
  state.commands["C-RUN"] = commandRecord("C-RUN", {
    argv: TEST_GATE_ARGV,
    task_id: null,
    gate_id: "G-RUN",
    actor: "coordinator",
  });
  return state;
}

function validActual(state: WorkflowState) {
  const expected = completionArtifactRequirements(state);
  return {
    verified_at: "2026-08-19T00:00:00.000Z",
    command_ids: [...expected.command_ids],
    packets: expected.packets,
    repository_binding: expected.repository_binding,
  };
}

describe("completionArtifactRequirements: completion remediations", () => {
  test("folds command ids referenced by remediation resolutions into the required set", () => {
    const state = baseState();
    const remediation: CompletionRemediation = {
      actor: "coordinator",
      review_sha256: "a".repeat(64),
      recorded_at: "2026-08-19T00:00:00.000Z",
      remediation_sha256: "b".repeat(64),
      resolutions: [{ finding_id: "F-1", method: "fixed", command_ids: ["C-REMEDY"] }],
    };
    state.completion_remediations = [remediation];
    const requirements = completionArtifactRequirements(state);
    expect(requirements.command_ids).toContain("C-REMEDY");
  });
});

describe("validateCompletionArtifactVerification: command_ids validation", () => {
  test("rejects a non-array command_ids field", () => {
    const state = baseState();
    const actual = { ...validActual(state), command_ids: "not-an-array" };
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /artifact command_ids must be duplicate-free strings/,
    );
  });

  test("rejects command_ids containing a blank entry", () => {
    const state = baseState();
    const actual = { ...validActual(state), command_ids: ["C-RUN", "  "] };
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /artifact command_ids must be duplicate-free strings/,
    );
  });

  test("rejects duplicate command_ids", () => {
    const state = baseState();
    const actual = { ...validActual(state), command_ids: ["C-RUN", "C-RUN"] };
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /artifact command_ids must be duplicate-free strings/,
    );
  });
});

describe("validateCompletionArtifactVerification: exact requirement coverage", () => {
  test("rejects when the submitted command_ids do not exactly match the expected set", () => {
    const state = baseState();
    const actual = validActual(state);
    (actual.command_ids as string[]).push("C-EXTRA-NOT-EXPECTED");
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /artifact verification does not cover exact requirements/,
    );
  });

  test("rejects when the submitted packets do not exactly match the expected set", () => {
    const state = baseState();
    state.packets = {
      "pkt-1": {
        id: "pkt-1",
        status: "published",
        role: "implementer",
        agent_id: "agent-1",
        task_id: null,
        attempt: 1,
        graph_revision: 1,
        markdown_path: "packets/pkt-1/packet.md",
        metadata_path: "packets/pkt-1/metadata.json",
        packet_sha256: "a".repeat(64),
        published_at: "2026-08-19T00:00:00.000Z",
      },
    };
    const actual = validActual(state);
    (actual.packets as unknown[]) = [];
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /artifact verification does not cover exact requirements/,
    );
  });

  test("sorts two or more packets by id, both in the expected requirements and in the submitted list", () => {
    const state = baseState();
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
        agent_id: "agent-2",
        task_id: null,
        attempt: 1,
        graph_revision: 1,
        markdown_path: "packets/pkt-a/packet.md",
        metadata_path: "packets/pkt-a/metadata.json",
        packet_sha256: "b".repeat(64),
        published_at: "2026-08-19T00:00:00.000Z",
      },
    };
    const requirements = completionArtifactRequirements(state);
    expect(requirements.packets.map((p) => p.id)).toEqual(["pkt-a", "pkt-b"]);
    const actual = validActual(state);
    const verification = validateCompletionArtifactVerification(state, actual);
    expect(verification.packets.map((p) => p.id)).toEqual(["pkt-a", "pkt-b"]);
  });
});

// `gateCommandIds` is gathered two ways: from mandatoryRunGateCommands() (which only admits a
// command that already satisfies commandMatchesGate — including trusted-host assurance and a
// matching repository_before/after) and, independently, from every task's own gate_results,
// which records a {gate_id, command_id} pair without re-checking commandMatchesGate at all. That
// second path is the only way to get a non-compliant command into the trusted-host-assurance
// check at all, so these tests build a task-scoped gate result rather than a run gate.
describe("validateCompletionArtifactVerification: gate command trusted-host assurance", () => {
  function taskGateState(
    mutateCommand: (command: ReturnType<typeof commandRecord>) => void,
  ): WorkflowState {
    const state = workflowState();
    state.requirements = [];
    state.gates = [];
    state.tasks["T-1"]!.gate_results = [{ gate_id: "G-1", command_id: "C-1", status: "passed" }];
    const command = commandRecord("C-1", { gate_id: "G-1" });
    mutateCommand(command);
    state.commands["C-1"] = command;
    return state;
  }

  test("rejects when a gate command lacks trusted-host assurance", () => {
    const state = taskGateState((command) => {
      command.assurance = "unattested" as never;
    });
    const actual = validActual(state);
    expect(actual.command_ids).toEqual(["C-1"]);
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /gate command C-1 lacks terminal trusted-host assurance/,
    );
  });

  test("rejects when a gate command has no repository_after snapshot", () => {
    const state = taskGateState((command) => {
      delete command.repository_after;
    });
    const actual = validActual(state);
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /gate command C-1 lacks terminal trusted-host assurance/,
    );
  });

  test("rejects when the gate command's repository_after does not match the live completion binding", () => {
    const state = taskGateState((command) => {
      command.repository_after = { ...repositoryBinding, content_sha256: "9".repeat(64) };
    });
    const actual = validActual(state);
    expect(() => validateCompletionArtifactVerification(state, actual)).toThrow(
      /gate command C-1 repository_after does not match live completion binding/,
    );
  });

  test("accepts a fully consistent verification and stamps a verification digest", () => {
    const state = baseState();
    const actual = validActual(state);
    const verification = validateCompletionArtifactVerification(state, actual);
    expect(verification.verification_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verification.command_ids).toEqual(["C-RUN"]);
  });
});
