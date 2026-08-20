import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { beginCompletenessCritic } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { recordCompletionRemediation } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/record-completion-remediation.ts";
import { recordCompletionReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/record-completion-review.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import { beginValidation } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/record-review.ts";
import { submitTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import {
  at,
  commandRecord,
  registerCommand,
  registerTaskPacket,
  repositoryBinding,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";
import { criticIntegrityDigest } from "../../../orchestrating-long-tasks/scripts/src/packets/critic-integrity-digest.ts";

const clock = at("2026-08-14T12:00:00.000Z");
const integrity = [{ status: "passed", event_head: "head" }];
const integritySha = criticIntegrityDigest(integrity);
const verifyRepository = () => structuredClone(repositoryBinding);

const report = {
  summary: "work completed",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

const finding = {
  id: "F-1",
  requirement_id: "R-1",
  severity: "important",
  observation: "edge case bug",
  evidence: [{ path: "a.ts" }],
  remediation: "handle edge case",
  revalidation: "bun test",
  status: "open",
};

function submitted(): TestPort {
  const port = new TestPort(workflowState());
  const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", token, report, clock);
  return port;
}

function validationToken(port: TestPort, validator: string): string {
  registerCommand(port, `C-${validator}`, validator);
  const started = beginValidation(port, "T-1", validator, clock);
  registerTaskPacket(
    port,
    "validator",
    validator,
    started.tasks["T-1"]!.validations!.at(-1)!.attempt,
  );
  return started.tasks["T-1"]!.validation_token!;
}

function rejectPayload(token: string, validator: string, round: number) {
  return {
    verdict: "reject",
    validation_token: token,
    requirement_ids: ["R-1"],
    checks: [{ command_id: `C-${validator}`, result: "failed" }],
    findings: [{ ...finding, id: `F-${round}` }],
  };
}

function readyCriticPort(): TestPort {
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
        deadline_at: "2026-08-14T13:00:00.000Z",
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
  state.commands["C-REPO"] = commandRecord("C-REPO", { task_id: null, actor: "coordinator" });
  state.commands["C-FIX"] = commandRecord("C-FIX", { task_id: null, actor: "coordinator" });
  return new TestPort(state);
}

function publishCritic(port: TestPort, critic: string, attempt: number, token: string): void {
  const id = `critic-${attempt}`;
  const sha = String(attempt).repeat(64);
  port.transact(critic, "packet-published", {}, (draft) => {
    draft.commands[`C-CHECK-${attempt}`] = commandRecord(`C-CHECK-${attempt}`, {
      task_id: null,
      actor: critic,
    });
    draft.packets ??= {};
    const authority = draft.completion_critic!;
    draft.packets[id] = {
      id,
      status: "published",
      role: "completeness-critic",
      agent_id: critic,
      task_id: null,
      attempt,
      graph_revision: 1,
      markdown_path: `packets/${id}/packet.md`,
      metadata_path: `packets/${id}/metadata.json`,
      packet_sha256: sha,
      readiness_sha256: authority.readiness_sha256,
      repository_binding: structuredClone(repositoryBinding),
      repository_command_ids: ["C-REPO"],
      integrity_evidence_sha256: integritySha,
      published_at: clock.now().toISOString(),
    };
    authority.status = "packet_published";
    authority.packet_id = id;
    Object.assign(draft.completion_critic_history![attempt - 1]!, authority);
  });
}

function recordFindings(port: TestPort, critic: string, attempt: number, token: string): void {
  publishCritic(port, critic, attempt, token);
  recordCompletionReview(
    port,
    critic,
    {
      packet_id: `critic-${attempt}`,
      critic_token: token,
      packet_sha256: String(attempt).repeat(64),
      graph_revision: 1,
      readiness_sha256: port.read().completion_critic!.readiness_sha256,
      repository_binding: structuredClone(repositoryBinding),
      summary: `attempt ${attempt} still leaves a finding open`,
      status: "findings",
      unresolved_finding_ids: [`CF-${attempt}`],
      findings: [
        {
          id: `CF-${attempt}`,
          requirement_id: "R-1",
          severity: "important",
          observation: "missing proof",
          evidence: [{ attempt }],
          remediation: "repair and verify",
          revalidation: "rerun command",
        },
      ],
      requirement_proofs: [
        {
          requirement_id: "R-1",
          status: "satisfied",
          evidence: [{ kind: "command", reference: `C-CHECK-${attempt}`, observation: "checked" }],
        },
      ],
      residual_risks: [],
      integrity_evidence: integrity,
      repository_command_ids: ["C-REPO"],
      checks: [{ command_id: `C-CHECK-${attempt}` }],
    },
    verifyRepository,
    clock,
  );
}

function recordRemediation(port: TestPort): void {
  const review = port.read().completion_review!;
  recordCompletionRemediation(
    port,
    "coordinator",
    {
      review_sha256: review.review_sha256,
      resolutions: review.unresolved_finding_ids.map((finding_id) => ({
        finding_id,
        method: "focused repair and verification",
        command_ids: ["C-FIX"],
      })),
    },
    clock,
  );
}

describe("configurable repair rounds", () => {
  test("recordReview escalates after custom maxRepairRounds = 2", () => {
    const port = submitted();
    const token1 = validationToken(port, "validator-1");
    recordReview(port, "T-1", "validator-1", rejectPayload(token1, "validator-1", 1), clock, 2);
    expect(port.read().tasks["T-1"]!.status).toBe("changes_requested");

    const claim = claimTask(port, "T-1", "implementer", "repairer", { clock });
    registerTaskPacket(port, "repairer", "implementer", 2);
    submitTask(port, "T-1", "implementer", claim.token, report, clock);

    const token2 = validationToken(port, "validator-2");
    recordReview(port, "T-1", "validator-2", rejectPayload(token2, "validator-2", 2), clock, 2);
    expect(port.read().tasks["T-1"]!.status).toBe("escalated");
  });

  test("beginCompletenessCritic bounds critic rounds using custom maxRepairRounds", () => {
    const port = readyCriticPort();
    for (let round = 1; round <= 2; round += 1) {
      const critic = `critic-${round}`;
      const { token } = beginCompletenessCritic(port, critic, { clock, maxRepairRounds: 2 });
      recordFindings(port, critic, round, token);
      recordRemediation(port);
    }
    expect(port.read().completion_remediations).toHaveLength(2);
    expect(() => beginCompletenessCritic(port, "critic-3", { clock, maxRepairRounds: 2 })).toThrow(
      "rounds are exhausted",
    );
  });
});
