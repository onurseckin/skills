import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/render-packet.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TestPort,
  workflowState,
} from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";
import { completionReadinessSnapshot } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/readiness-snapshot.ts";

const commonBytes = new TextEncoder().encode(
  "  Preserve unrelated changes.\nRun focused tests.  \n",
);
const common = {
  bytes: commonBytes,
  sha256: createHash("sha256").update(commonBytes).digest("hex"),
};
const clock = at("2026-08-13T12:00:00.000Z");

const base = () => {
  const state = workflowState();
  const claim = claimTask(new TestPort(state), "T-1", "agent", "implementer", { clock });
  const claimed = claim.state;
  claimed.requirements[0]!.context = { task_reports: [{ summary: "requirement alias leak" }] };
  return {
    runId: "run-1",
    graphRevision: 2,
    agentId: "agent",
    attempt: 1,
    state: claimed,
    task: claimed.tasks["T-1"],
    commonInstructions: common,
    evidenceSchema: { required: ["requirement_ids", "files_changed", "checks", "evidence"] },
    targetedCommands: [["bun", "test", "tests/workflow"]],
    leaseToken: claim.token,
    clock,
    authoritativeContext: {
      original_prompt: "request",
      mapped_requirements: [{ id: "R-1" }],
      task_contract: { id: "T-1" },
      baseline_repository_state: { head: "abc" },
      current_repository_state: {
        diff: "actual",
        nested: {
          validator_report: "validator alias leak",
          previous_review: "review alias leak",
          task_reports: [{ summary: "task alias leak" }],
        },
      },
      command_evidence: [{ id: "C-1" }],
      ...inspectionContext(),
      implementer_report: "I am done",
      confidence: "high",
      unknown_sensitive: "must not leak",
    },
  };
};

function authorizeValidator(input: ReturnType<typeof base>): void {
  const token = "validation-token";
  input.agentId = "validator";
  input.leaseToken = token;
  input.task!.status = "validating";
  delete input.task!.lease;
  input.task!.validations = [
    {
      validator_id: "validator",
      domain: "code-quality",
      token_digest: tokenDigest(token),
      attempt: 1,
      started_at: "2026-08-13T12:00:00.000Z",
      deadline_at: "2026-08-13T12:20:00.000Z",
    },
  ];
}

function authorizeCritic(input: ReturnType<typeof base>): string {
  const token = "critic-token";
  input.agentId = "critic";
  const readiness = completionReadinessSnapshot(input.state, 1, "critic");
  input.state.completion_critic = {
    critic_id: "critic",
    token_digest: tokenDigest(token),
    attempt: 1,
    status: "assigned",
    started_at: "2026-08-13T12:00:00.000Z",
    deadline_at: "2026-08-13T12:20:00.000Z",
    readiness_sha256: readiness.sha256,
    repository_binding: structuredClone(repositoryBinding),
  };
  return token;
}

describe("mechanical packet contracts", () => {
  test("includes task scope, evidence schema, and commands without persisting the bearer token", () => {
    const packet = buildPacket({ ...base(), role: "implementer" });
    expect(packet.markdown).toContain('"write_scope": [');
    expect(packet.markdown).toContain('"required": [');
    expect(packet.markdown).toContain('"bun"');
    expect(packet.markdown).not.toContain("Authentication token");
    expect(packet.markdown).not.toContain("hns_");
    expect(packet.markdown).not.toContain(base().leaseToken);
    expect(JSON.stringify(packet.metadata)).not.toContain(base().leaseToken);
  });

  test("preserves the complete frozen task contract", () => {
    const input = base();
    Object.assign(input.task!, {
      type: "task",
      label: "Implement the workflow contract",
      artifact_ids: ["A-1"],
      priority: 9,
      effort: 5,
      acceptance_criteria: ["persists every contract field"],
    });
    const packet = buildPacket({ ...input, role: "implementer" });
    for (const expected of [
      "Implement the workflow contract",
      '"artifact_ids"',
      '"priority": 9',
      '"effort": 5',
      "persists every contract field",
    ]) {
      expect(packet.markdown).toContain(expected);
    }
  });

  test("validator context uses an authoritative allowlist", () => {
    expect(() => buildPacket({ ...base(), role: "validator", leaseToken: undefined })).toThrow();
    const input = base();
    authorizeValidator(input);
    input.task!.contract_context = { previous_review: "task contract alias leak" };
    const packet = buildPacket({ ...input, role: "validator" });
    expect(packet.markdown).not.toContain("validation-token");
    expect(packet.markdown).toContain('"original_prompt"');
    expect(packet.markdown).toContain('"current_repository_state"');
    for (const forbidden of [
      "I am done",
      "high",
      "must not leak",
      "validator alias leak",
      "review alias leak",
      "task alias leak",
      "task contract alias leak",
      "requirement alias leak",
    ]) {
      expect(packet.markdown).not.toContain(forbidden);
    }
  });

  test("completeness critic sees prompt and graph but no unit narratives", () => {
    const input = base();
    input.state.commands["C-REPO"] = commandRecord("C-REPO", { task_id: null });
    const criticToken = authorizeCritic(input);
    const packet = buildPacket({
      ...input,
      role: "completeness-critic",
      task: undefined,
      leaseToken: criticToken,
      authoritativeContext: {
        original_prompt: "request",
        graph: { revision: 2 },
        plan_history: [{ revision: 2 }],
        integrity_evidence: [{ status: "passed", event_head: "abc" }],
        repository_evidence: { command_ids: ["C-REPO"] },
        ...inspectionContext(),
        implementer_report: "I am done",
        validator_report: "looks good",
        task_reports: [{ summary: "done" }],
        unknown: "hidden",
      },
    });
    expect(packet.markdown).toContain('"original_prompt"');
    expect(packet.markdown).toContain('"graph"');
    for (const forbidden of ["I am done", "looks good", '"task_reports"', '"unknown"']) {
      expect(packet.markdown).not.toContain(forbidden);
    }
  });

  test("verifies and appends canonical common bytes without trimming", () => {
    const packet = buildPacket({ ...base(), role: "implementer" });
    expect(packet.markdown.endsWith(new TextDecoder().decode(commonBytes))).toBeTrue();
    expect(packet.metadata.common_instructions_sha256).toBe(common.sha256);
    expect(() =>
      buildPacket({
        ...base(),
        role: "implementer",
        commonInstructions: { ...common, sha256: "0".repeat(64) },
      }),
    ).toThrow();
    expect(() =>
      buildPacket({
        ...base(),
        role: "implementer",
        commonInstructions: {
          bytes: new Uint8Array(),
          sha256: createHash("sha256").update("").digest("hex"),
        },
      }),
    ).toThrow();
  });
});
