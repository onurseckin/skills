import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { buildPacket } from "../../src/packets/render-packet.ts";
import { claimTask } from "../../src/workflow/lease/claim.ts";
import { tokenDigest } from "../../src/workflow/lease/token.ts";
import { completionReadinessSnapshot } from "../../src/workflow/completion/readiness-snapshot.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TestPort,
  workflowState,
} from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

const bytes = new TextEncoder().encode("Canonical common instructions.\n");
const common = { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
const clock = at("2026-08-13T12:00:00.000Z");

function taskPacket() {
  const port = new TestPort(workflowState());
  const claim = claimTask(port, "T-1", "worker", "implementer", { clock });
  const state = claim.state;
  return {
    runId: "run-1",
    graphRevision: 1,
    role: "implementer" as const,
    agentId: "worker",
    task: state.tasks["T-1"],
    state,
    commonInstructions: common,
    roleInstructions: "Implement only the frozen contract.",
    authoritativeContext: {
      ...inspectionContext(),
      original_prompt: "Implement R-1",
      graph: { revision: 1 },
      plan_history: [{ revision: 1 }],
      integrity_evidence: [{ status: "passed", event_head: "abc" }],
      repository_evidence: { command_ids: ["C-REPO"] },
    },
    evidenceSchema: { required: ["checks"] },
    targetedCommands: [["bun", "test"]],
    leaseToken: claim.token,
    attempt: 1,
    clock,
  };
}

function authorizeCritic(input: ReturnType<typeof taskPacket>): string {
  const token = "critic-token";
  const readiness = completionReadinessSnapshot(input.state, 1, "critic");
  input.state.completion_critic = {
    critic_id: "critic",
    token_digest: tokenDigest(token),
    attempt: 1,
    status: "assigned",
    started_at: clock.now().toISOString(),
    deadline_at: "2026-08-13T12:20:00.000Z",
    readiness_sha256: readiness.sha256,
    repository_binding: structuredClone(repositoryBinding),
  };
  return token;
}

describe("packet authority and critic state", () => {
  test("authenticates task identity, role, token, attempt, and authoritative task", () => {
    const input = taskPacket();
    expect(buildPacket(input).metadata.task_id).toBe("T-1");
    for (const override of [
      { agentId: "intruder" },
      { role: "repairer" as const },
      { leaseToken: "wrong" },
      { attempt: 2 },
      { task: { ...input.task!, status: "done" as const } },
    ]) {
      expect(() => buildPacket({ ...input, ...override })).toThrow();
    }
  });

  test("rejects build after lease or validation deadline", () => {
    const lease = taskPacket();
    expect(() => buildPacket({ ...lease, clock: at("2026-08-13T12:21:00.000Z") })).toThrow();
    const validation = taskPacket();
    validation.task!.status = "validating";
    delete validation.task!.lease;
    validation.agentId = "validator";
    validation.role = "validator";
    validation.leaseToken = "validator-token";
    validation.task!.validation = {
      validator_id: "validator",
      token_digest: tokenDigest("validator-token"),
      attempt: 1,
      started_at: clock.now().toISOString(),
      deadline_at: "2026-08-13T12:20:00.000Z",
    };
    expect(() => buildPacket({ ...validation, clock: at("2026-08-13T12:21:00.000Z") })).toThrow();
  });

  test("critic context is live, complete, and backed by repository command evidence", () => {
    const input = taskPacket();
    input.state.commands["C-REPO"] = commandRecord("C-REPO", {
      task_id: null,
      actor: "coordinator",
    });
    input.state.tasks["T-1"]!.findings = [
      {
        id: "F-1",
        requirement_id: "R-1",
        severity: "important",
        observation: "missing test",
        evidence: [{ path: "src/owned/a.ts" }],
        remediation: "add it",
        revalidation: "run it",
        status: "open",
      },
    ];
    input.state.orphan_evidence.push({ task_id: "T-1", report_sha256: "orphan" });
    const criticToken = authorizeCritic(input);
    const packet = buildPacket({
      ...input,
      role: "completeness-critic",
      agentId: "critic",
      task: undefined,
      leaseToken: criticToken,
      attempt: 1,
    });
    for (const required of [
      '"tasks"',
      '"lease"',
      '"findings"',
      '"gates"',
      '"commands"',
      '"orphan_evidence"',
      '"plan_history"',
      '"integrity_evidence"',
      '"repository_evidence"',
      '"C-REPO"',
      '"completion_readiness"',
      readinessSha(input),
    ]) {
      expect(packet.markdown).toContain(required);
    }
  });

  test("critic packet binds readiness and rejects an expired authorization", () => {
    const input = taskPacket();
    input.state.commands["C-REPO"] = commandRecord("C-REPO", { task_id: null });
    const token = authorizeCritic(input);
    const packet = buildPacket({
      ...input,
      role: "completeness-critic",
      agentId: "critic",
      task: undefined,
      leaseToken: token,
    });
    expect(packet.metadata.readiness_sha256).toBe(input.state.completion_critic!.readiness_sha256);
    expect(packet.markdown).not.toContain(token);
    expect(() =>
      buildPacket({
        ...input,
        role: "completeness-critic",
        agentId: "critic",
        task: undefined,
        leaseToken: token,
        clock: at("2026-08-13T12:20:00.000Z"),
      }),
    ).toThrow("expired");
    input.state.completion_critic!.deadline_at = "not-an-instant";
    expect(() =>
      buildPacket({
        ...input,
        role: "completeness-critic",
        agentId: "critic",
        task: undefined,
        leaseToken: token,
      }),
    ).toThrow("deadline");
  });

  test("critic packet refuses missing live integrity or repository proof", () => {
    const input = taskPacket();
    const criticToken = authorizeCritic(input);
    for (const authoritativeContext of [
      { ...input.authoritativeContext, integrity_evidence: [] },
      { ...input.authoritativeContext, plan_history: [] },
      { ...input.authoritativeContext, repository_evidence: {} },
      { ...input.authoritativeContext, repository_evidence: { command_ids: ["missing"] } },
    ]) {
      expect(() =>
        buildPacket({
          ...input,
          role: "completeness-critic",
          agentId: "critic",
          task: undefined,
          leaseToken: criticToken,
          authoritativeContext,
        }),
      ).toThrow();
    }
    input.state.commands["C-REPO"] = commandRecord("C-REPO", {
      task_id: null,
      evidence_error: "command artifact is missing",
    });
    expect(() =>
      buildPacket({
        ...input,
        role: "completeness-critic",
        agentId: "critic",
        task: undefined,
        leaseToken: criticToken,
      }),
    ).toThrow();
  });

  test("critic packet requires its one-time durable authorization", () => {
    const input = taskPacket();
    input.state.commands["C-REPO"] = commandRecord("C-REPO", { task_id: null });
    expect(() =>
      buildPacket({
        ...input,
        role: "completeness-critic",
        agentId: "critic",
        task: undefined,
        leaseToken: undefined,
      }),
    ).toThrow();
  });
});

function readinessSha(input: ReturnType<typeof taskPacket>): string {
  return input.state.completion_critic?.readiness_sha256 ?? "missing-readiness";
}
