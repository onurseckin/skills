import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { buildPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/render-packet.ts";
import { beginCompletenessCritic } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { completeRun } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/complete-run.ts";
import { recordCompletionReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/record-completion-review.ts";
import { completionArtifactRequirements } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/artifact-verification.ts";
import { completionReadinessSnapshot } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/readiness-snapshot.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import { inspectionContext } from "../packets/inspection-fixture.ts";
import { repositoryBindingFromInspection } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-inspection.ts";
import { validateRepositoryBinding } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/repository-binding.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";
import { criticIntegrityDigest } from "../../../orchestrating-long-tasks/scripts/src/packets/critic-integrity-digest.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const criticToken = "critic-token";
const integrityEvidence = [{ status: "passed", event_head: "event-sha" }];
const integritySha = criticIntegrityDigest(integrityEvidence);

function readyPort(): TestPort {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "done",
    report: { summary: "done" },
    validations: [
      {
        validator_id: "validator",
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: clock.now().toISOString(),
        deadline_at: clock.now().toISOString(),
        verdict: "pass",
        reviewed_requirement_ids: ["R-1"],
        checks: [{ command_id: "C-V" }],
      },
    ],
    gate_results: [{ gate_id: "G-1", command_id: "C-T", status: "passed" }],
  });
  state.requirements[0] = {
    id: "R-1",
    status: "satisfied",
    disposition: "actionable",
    evidence: ["task:T-1"],
  };
  state.gates.push({
    id: "G-RUN",
    command: TEST_GATE_ARGV,
    cwd: ".",
    scope: "run",
    requirement_ids: [],
    mandatory: true,
  });
  state.commands["C-T"] = commandRecord("C-T", { gate_id: "G-1" });
  state.commands["C-V"] = commandRecord("C-V");
  state.commands["C-RUN"] = commandRecord("C-RUN", {
    argv: TEST_GATE_ARGV,
    task_id: null,
    gate_id: "G-RUN",
    actor: "coordinator",
  });
  state.commands["C-REPO"] = commandRecord("C-REPO", {
    argv: ["git", "status", "--short"],
    task_id: null,
    actor: "coordinator",
  });
  state.commands["C-CRITIC"] = commandRecord("C-CRITIC", { task_id: null, actor: "critic" });
  return new TestPort(state);
}

function publish(port: TestPort): void {
  const state = port.read();
  const authorization = state.completion_critic!;
  port.transact("critic", "packet-published", {}, (draft) => {
    draft.packets = {
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
        readiness_sha256: authorization.readiness_sha256,
        repository_binding: structuredClone(repositoryBinding),
        repository_command_ids: ["C-REPO"],
        integrity_evidence_sha256: integritySha,
        published_at: clock.now().toISOString(),
      },
    };
    draft.completion_critic!.status = "packet_published";
    draft.completion_critic!.packet_id = "critic-1";
    Object.assign(draft.completion_critic_history![0]!, draft.completion_critic);
  });
}

function input(port: TestPort) {
  return {
    packet_id: "critic-1",
    critic_token: criticToken,
    packet_sha256: "a".repeat(64),
    graph_revision: 1,
    readiness_sha256: port.read().completion_critic!.readiness_sha256,
    repository_binding: structuredClone(repositoryBinding),
    summary: "whole diff verified against the run gate",
    status: "clean" as const,
    unresolved_finding_ids: [],
    findings: [],
    requirement_proofs: [
      {
        requirement_id: "R-1",
        status: "satisfied" as const,
        evidence: [{ kind: "command" as const, reference: "C-CRITIC", observation: "verified" }],
      },
    ],
    residual_risks: [],
    integrity_evidence: integrityEvidence,
    repository_command_ids: ["C-REPO"],
    checks: [{ command_id: "C-CRITIC" }],
  };
}

function criticPacket(state: ReturnType<TestPort["read"]>, token: string) {
  const commonBytes = new TextEncoder().encode("Canonical common instructions.\n");
  return buildPacket({
    runId: "run-1",
    graphRevision: 1,
    role: "completeness-critic",
    agentId: "critic",
    state,
    commonInstructions: {
      bytes: commonBytes,
      sha256: createHash("sha256").update(commonBytes).digest("hex"),
    },
    authoritativeContext: {
      ...inspectionContext(),
      original_prompt: "Do work",
      graph: { revision: 1 },
      plan_history: [{ revision: 1 }],
      integrity_evidence: [{ status: "passed" }],
      repository_evidence: { command_ids: ["C-REPO"] },
    },
    evidenceSchema: { required: ["checks"] },
    targetedCommands: [["bun", "test"]],
    leaseToken: token,
    attempt: 1,
    clock,
  });
}

describe("completion repository-byte binding", () => {
  test("requires the versioned repository binding shape", () => {
    expect(() =>
      validateRepositoryBinding({ ...repositoryBinding, schema: undefined }, "binding"),
    ).toThrow("binding is invalid");
    expect(() =>
      validateRepositoryBinding({ ...repositoryBinding, version: 2 }, "binding"),
    ).toThrow("binding is invalid");
    expect(() =>
      validateRepositoryBinding(
        { ...repositoryBinding, git_identity_sha256: undefined },
        "binding",
      ),
    ).toThrow("binding is invalid");
  });

  test("binds repository identity into authorization, readiness, and critic packet metadata", () => {
    const port = readyPort();
    const context = inspectionContext();
    const expected = repositoryBindingFromInspection(context.current_repository_state);
    port.transact("test", "bind-repository", {}, (draft) => {
      draft.current_repository_binding = expected;
    });
    const authorization = beginCompletenessCritic(port, "critic", { clock });
    expect(authorization.state.completion_critic!.repository_binding).toEqual(expected);
    expect(
      completionReadinessSnapshot(authorization.state, 1, "critic").repository_binding,
    ).toEqual(expected);
    const packet = criticPacket(authorization.state, authorization.token);
    expect(packet.metadata.repository_binding).toEqual(expected);
  });

  test("blocks critic packet publication after repository bytes drift", () => {
    const port = readyPort();
    const authorization = beginCompletenessCritic(port, "critic", { clock });
    port.transact("test", "repository-drift", {}, (draft) => {
      draft.current_repository_binding = { ...repositoryBinding, content_sha256: "f".repeat(64) };
    });
    expect(() => criticPacket(port.read(), authorization.token)).toThrow(
      "repository bytes changed before critic packet publication",
    );
  });

  test("blocks review when stable repository identity drifts after packet publication", () => {
    const port = readyPort();
    beginCompletenessCritic(port, "critic", { clock });
    port.transact("test", "set-token", {}, (draft) => {
      draft.completion_critic!.token_digest = tokenDigest(criticToken);
      draft.completion_critic_history![0]!.token_digest = tokenDigest(criticToken);
    });
    publish(port);
    expect(() =>
      recordCompletionReview(
        port,
        "critic",
        input(port),
        () => ({ ...repositoryBinding, git_identity_sha256: "f".repeat(64) }),
        clock,
      ),
    ).toThrow("repository bytes changed");
  });

  test("blocks completion when repository bytes drift after a clean review", () => {
    const port = readyPort();
    beginCompletenessCritic(port, "critic", { clock });
    port.transact("test", "set-token", {}, (draft) => {
      draft.completion_critic!.token_digest = tokenDigest(criticToken);
      draft.completion_critic_history![0]!.token_digest = tokenDigest(criticToken);
    });
    publish(port);
    recordCompletionReview(port, "critic", input(port), () => repositoryBinding, clock);
    expect(() =>
      completeRun(
        port,
        "coordinator",
        (state) => ({
          verified_at: clock.now().toISOString(),
          ...completionArtifactRequirements(state),
          repository_binding: { ...repositoryBinding, content_sha256: "f".repeat(64) },
        }),
        criticToken,
        clock,
      ),
    ).toThrow("repository bytes changed");
  });
});
