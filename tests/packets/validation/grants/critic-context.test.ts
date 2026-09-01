import { describe, expect, test } from "bun:test";
import { criticContext } from "../../../../olt/scripts/src/packets/critic-context.ts";
import type { PacketInput } from "../../../../olt/scripts/src/packets/types.ts";
import { repositoryBindingFromInspection } from "../../../../olt/scripts/src/packets/repository-inspection.ts";
import { completionReadinessSnapshot } from "../../../../olt/scripts/src/workflow/completion/readiness-snapshot.ts";
import { commandRecord, workflowState } from "../../../workflow/index.ts";
import { inspection } from "../../payloads/slicing/inspection-fixture.ts";

const COMMAND_ID = "C-11111111-1111-4111-8111-111111111111";

function createValidInput(): PacketInput {
  const currentInsp = inspection("current");
  const binding = repositoryBindingFromInspection(currentInsp);
  const state = workflowState();
  state.current_repository_binding = binding;
  state.baseline_repository_binding = binding;
  const cmd = commandRecord(COMMAND_ID, {
    task_id: null,
    gate_id: null,
    status: "succeeded",
    exit_code: 0,
    actor: "coordinator",
  });
  state.commands = { [COMMAND_ID]: cmd };

  const readiness = completionReadinessSnapshot(state, 1, "critic-1");
  state.completion_critic = {
    critic_id: "critic-1",
    attempt: 1,
    status: "assigned",
    assigned_at: "2026-08-14T00:00:00.000Z",
    deadline_at: "2026-08-14T01:00:00.000Z",
    token_digest: "0".repeat(64),
    readiness_sha256: readiness.sha256,
    repository_binding: binding,
    packet_id: null,
    review_sha256: null,
  };

  return {
    template: "completeness-critic",
    role: "completeness-critic",
    authoritativeContext: {
      original_prompt: "Build feature",
      integrity_evidence: [{ kind: "run_hash", sha256: "0".repeat(64) }],
      graph: { version: 1, tasks: [] },
      plan_history: [{ revision: 1 }],
      repository_evidence: {
        command_ids: [COMMAND_ID],
      },
      current_repository_state: currentInsp,
    },
    state,
  };
}

describe("critic-context", () => {
  test("builds and isolates valid critic context with optional review & result", () => {
    const input = createValidInput();
    input.state.completion_review = {
      critic_id: "critic-1",
      attempt: 1,
      verdict: "pass",
      summary: "all good",
      issues: [],
      reviewed_requirement_ids: ["R-1"],
      readiness_sha256: "0".repeat(64),
      repository_binding: input.state.current_repository_binding,
      signature: "sig",
      created_at: "2026-08-14T00:00:00.000Z",
    };
    input.state.completion_result = {
      status: "complete",
      completed_at: "2026-08-14T00:00:00.000Z",
      summary: "done",
    };

    const context = criticContext(input);
    expect(context.original_prompt).toBe("Build feature");
    expect(context.repository_evidence).toBeDefined();
    expect(context.completion_readiness).toBeDefined();
    expect(context.requirements).toBeDefined();
    expect(context.completion_review).toBeDefined();
    expect(context.completion_result).toBeDefined();
  });

  test("rejects missing or invalid completion critic authorization", () => {
    const input = createValidInput();
    input.state.completion_critic = null;
    expect(() => criticContext(input)).toThrow("completion critic authorization is missing");
  });

  test("rejects when readiness sha256 changed before publication", () => {
    const input = createValidInput();
    input.state.completion_critic!.readiness_sha256 = "invalid_sha";
    expect(() => criticContext(input)).toThrow(
      "completion readiness changed before packet publication",
    );
  });

  test("rejects when repository binding changed before critic publication", () => {
    const input = createValidInput();
    input.state.completion_critic!.repository_binding = {
      ...input.state.completion_critic!.repository_binding,
      content_sha256: "1".repeat(64),
    };
    expect(() => criticContext(input)).toThrow(
      "repository bytes changed before critic packet publication",
    );
  });

  test("validates repository_evidence command_ids format and authoritativeness", () => {
    const input1 = createValidInput();
    (input1.authoritativeContext.repository_evidence as { command_ids: unknown }).command_ids = [];
    expect(() => criticContext(input1)).toThrow("repository_evidence.command_ids must be nonempty");

    const input2 = createValidInput();
    (input2.authoritativeContext.repository_evidence as { command_ids: unknown }).command_ids = [
      COMMAND_ID,
      COMMAND_ID,
    ];
    expect(() => criticContext(input2)).toThrow(
      "repository_evidence.command_ids must be nonempty and duplicate-free",
    );

    const input3 = createValidInput();
    (input3.authoritativeContext.repository_evidence as { command_ids: unknown }).command_ids = [
      "C-nonexistent",
    ];
    expect(() => criticContext(input3)).toThrow("repository evidence is not authoritative");
  });

  test("validates object helper validation and empty object checks", () => {
    const input = createValidInput();
    (input.authoritativeContext.graph as unknown) = null;
    expect(() => criticContext(input)).toThrow("graph must be an object");

    const input2 = createValidInput();
    (input2.authoritativeContext.graph as unknown) = {};
    expect(() => criticContext(input2)).toThrow("graph must not be empty");
  });
});
