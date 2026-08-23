import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/commands.ts";
import { captureGateEnvironment } from "../../../olt/scripts/src/engine/runner/gate-environment.ts";
import { embeddedCommandIssues } from "../../../olt/scripts/src/engine/runner/command-shape.ts";
import { validateCompletionArtifactVerification } from "../../../olt/scripts/src/workflow/completion/artifact-verification.ts";
import { attachGateResult } from "../../../olt/scripts/src/workflow/gates/attach-result.ts";
import { at, commandRecord, repositoryBinding, TestPort, workflowState } from "./test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const argv = ["bun", "test", "tests/unit/workflow/trusted-host-gates.test.ts"];

function validatedPort(command: CommandRecord): TestPort {
  const state = workflowState();
  state.gates[0]!.command = argv;
  state.tasks["T-1"]!.status = "validated";
  state.commands[command.id] = command;
  return new TestPort(state);
}

function trustedCommand(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return commandRecord("C-GATE", {
    argv,
    task_id: "T-1",
    gate_id: "G-1",
    assurance: "trusted_host_observed_v1",
    repository_before: structuredClone(repositoryBinding),
    repository_after: structuredClone(repositoryBinding),
    ...overrides,
  });
}

describe("trusted-host workflow gates", () => {
  test("command fixtures persist the exact sanitized environment outside gates", () => {
    const command = commandRecord("C-NON-GATE", {
      task_id: null,
      gate_id: null,
      actor: "coordinator",
    });
    expect(command.environment).toEqual(
      captureGateEnvironment(process.env, "00000000-0000-4000-8000-000000000000"),
    );
    expect(command.path_bindings).toBeUndefined();
    expect(embeddedCommandIssues(command)).toEqual([]);
  });

  test("attaches only current terminal trusted-host observations", () => {
    const accepted = validatedPort(trustedCommand());
    expect(
      attachGateResult(accepted, "T-1", "G-1", "C-GATE", "coordinator", clock).tasks["T-1"]!
        .gate_results,
    ).toEqual([{ gate_id: "G-1", command_id: "C-GATE", status: "passed" }]);

    const invalid: Partial<CommandRecord>[] = [
      { assurance: undefined },
      { assurance: "trusted_host_observed_v0" as never },
      { repository_after: null },
    ];
    for (const override of invalid) {
      const port = validatedPort(trustedCommand(override));
      expect(() => attachGateResult(port, "T-1", "G-1", "C-GATE", "coordinator", clock)).toThrow(
        "command does not prove the gate contract",
      );
    }
  });

  test("completion rejects a gate post-binding that differs from the locked live binding", () => {
    const command = trustedCommand({
      repository_before: {
        ...repositoryBinding,
        content_sha256: "f".repeat(64),
        inspection_sha256: "a".repeat(64),
      },
      repository_after: {
        ...repositoryBinding,
        content_sha256: "f".repeat(64),
        inspection_sha256: "a".repeat(64),
      },
    });
    command.attempts![0]!.repository_after = structuredClone(command.repository_after!);
    const state = validatedPort(command).read();
    state.tasks["T-1"]!.gate_results = [{ gate_id: "G-1", command_id: "C-GATE", status: "passed" }];
    const input = {
      verified_at: clock.now().toISOString(),
      command_ids: ["C-GATE"],
      packets: [],
      repository_binding: structuredClone(repositoryBinding),
    };

    expect(() => validateCompletionArtifactVerification(state, input)).toThrow(
      "gate command C-GATE repository_after does not match live completion binding",
    );
  });
});
