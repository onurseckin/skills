import { completionArtifactRequirements } from "../../olt/scripts/src/workflow/completion/artifact-verification.ts";
import { recordCompletionReview } from "../../olt/scripts/src/workflow/completion/record-completion-review.ts";
import { completionReadinessSnapshot } from "../../olt/scripts/src/workflow/completion/readiness-snapshot.ts";
import { tokenDigest } from "../../olt/scripts/src/workflow/lease/token.ts";
import type { TransactionPort } from "../../olt/scripts/src/workflow/types.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";
import { criticIntegrityDigest } from "../../olt/scripts/src/packets/critic-integrity-digest.ts";

export const clock = at("2026-08-13T12:00:00.000Z");
export const packetSha = "a".repeat(64);
const integrityEvidence = [{ status: "passed", event_head: "event-sha" }];
const integritySha = criticIntegrityDigest(integrityEvidence);
export const criticToken = "critic-token";
export const verifyRepository = () => structuredClone(repositoryBinding);

export function completionPort(): TestPort {
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
        checks: [{ command_id: "C-VALIDATE" }],
      },
    ],
    gate_results: [{ gate_id: "G-1", command_id: "C-TASK", status: "passed" }],
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
  state.commands["C-TASK"] = commandRecord("C-TASK", { gate_id: "G-1" });
  state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE");
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
  state.commands["C-CRITIC"] = commandRecord("C-CRITIC", {
    task_id: null,
    actor: "critic",
  });
  const readinessSha = completionReadinessSnapshot(state, 1, "critic").sha256;
  state.completion_critic = {
    critic_id: "critic",
    token_digest: tokenDigest(criticToken),
    attempt: 1,
    status: "packet_published",
    started_at: clock.now().toISOString(),
    deadline_at: "2026-08-13T13:00:00.000Z",
    readiness_sha256: readinessSha,
    repository_binding: structuredClone(repositoryBinding),
    packet_id: "critic-1",
  };
  state.completion_critic_history = [{ ...state.completion_critic }];
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
      packet_sha256: packetSha,
      readiness_sha256: readinessSha,
      repository_binding: structuredClone(repositoryBinding),
      repository_command_ids: ["C-REPO"],
      integrity_evidence_sha256: integritySha,
      published_at: clock.now().toISOString(),
    },
  };
  return new TestPort(state);
}

export function reviewInput(port: TestPort, token = criticToken) {
  return {
    packet_id: "critic-1",
    critic_token: token,
    packet_sha256: packetSha,
    graph_revision: 1,
    readiness_sha256: port.read().completion_critic!.readiness_sha256,
    repository_binding: structuredClone(repositoryBinding),
    summary: "whole diff verified against the run gate",
    status: "clean",
    unresolved_finding_ids: [],
    findings: [],
    requirement_proofs: [
      {
        requirement_id: "R-1",
        status: "satisfied",
        evidence: [
          { kind: "command", reference: "C-CRITIC", observation: "verified independently" },
        ],
      },
    ],
    residual_risks: [],
    integrity_evidence: integrityEvidence,
    repository_command_ids: ["C-REPO"],
    checks: [{ command_id: "C-CRITIC" }],
  };
}

export function review(port: TestPort) {
  return recordCompletionReview(port, "critic", reviewInput(port), verifyRepository, clock);
}

export function artifactVerification(state: Parameters<typeof completionArtifactRequirements>[0]) {
  return { verified_at: clock.now().toISOString(), ...completionArtifactRequirements(state) };
}

export class ObservedPort implements TransactionPort {
  public locked = false;
  public constructor(private readonly delegate: TestPort) {}
  public read() {
    return this.delegate.read();
  }
  public transact(...[actor, kind, payload, mutate]: Parameters<TransactionPort["transact"]>) {
    return this.delegate.transact(actor, kind, payload, (draft) => {
      this.locked = true;
      try {
        mutate(draft);
      } finally {
        this.locked = false;
      }
    });
  }
}
