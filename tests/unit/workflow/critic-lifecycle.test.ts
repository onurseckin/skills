import { describe, expect, test } from "bun:test";
import { beginCompletenessCritic } from "../../../olt/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { completionIssues } from "../../../olt/scripts/src/workflow/completion/completion-state.ts";
import { recordCompletionRemediation } from "../../../olt/scripts/src/workflow/completion/record-completion-remediation.ts";
import { recordCompletionReview } from "../../../olt/scripts/src/workflow/completion/record-completion-review.ts";
import { tokenDigest } from "../../../olt/scripts/src/workflow/lease/token.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";
import { criticIntegrityDigest } from "../../../olt/scripts/src/packets/critic-integrity-digest.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const integrity = [{ status: "passed", event_head: "head" }];
const integritySha = criticIntegrityDigest(integrity);
const verifyRepository = () => structuredClone(repositoryBinding);

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
        deadline_at: "2026-08-13T13:00:00.000Z",
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
  const sha = (attempt % 16).toString(16).repeat(64);
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
    expect(authority.token_digest).toBe(tokenDigest(token));
    authority.status = "packet_published";
    authority.packet_id = id;
    Object.assign(draft.completion_critic_history![attempt - 1]!, authority);
  });
}

function findings(port: TestPort, critic: string, attempt: number, token: string): void {
  publishCritic(port, critic, attempt, token);
  recordCompletionReview(
    port,
    critic,
    {
      packet_id: `critic-${attempt}`,
      critic_token: token,
      packet_sha256: (attempt % 16).toString(16).repeat(64),
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
          observation: "missing final proof",
          evidence: [{ attempt }],
          remediation: "repair and verify",
          revalidation: "rerun focused command",
        },
      ],
      requirement_proofs: [
        {
          requirement_id: "R-1",
          status: "satisfied",
          evidence: [
            {
              kind: "command",
              reference: `C-CHECK-${attempt}`,
              observation: "checked",
            },
          ],
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

function remediate(port: TestPort): void {
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

describe("completion critic lifecycle", () => {
  test("critic authorization is one-time and includes validation history identity", () => {
    const port = readyPort();
    const first = beginCompletenessCritic(port, "critic", { clock });
    expect(() => beginCompletenessCritic(port, "critic", { clock })).toThrow();
    expect(first.state.completion_critic_history).toHaveLength(1);

    const prior = readyPort();
    prior.transact("test", "history", {}, (draft) => {
      draft.tasks["T-1"]!.validation_history = [
        {
          validator_id: "prior-validator",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: clock.now().toISOString(),
          deadline_at: clock.now().toISOString(),
        },
      ];
    });
    expect(() => beginCompletenessCritic(prior, "prior-validator", { clock })).toThrow();
  });

  test("requires remediation and a fresh critic, preserves history, and bounds rounds", () => {
    const port = readyPort();
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const critic = `critic-${attempt}`;
      const authorization = beginCompletenessCritic(port, critic, { clock });
      findings(port, critic, attempt, authorization.token);
      expect(port.read().completion_reviews).toHaveLength(attempt);
      expect(() => beginCompletenessCritic(port, `early-${attempt}`, { clock })).toThrow();
      remediate(port);
      expect(() => beginCompletenessCritic(port, critic, { clock })).toThrow();
    }
    expect(port.read().completion_remediations).toHaveLength(20);
    expect(() => beginCompletenessCritic(port, "critic-21", { clock })).toThrow();
  });

  test("completion rechecks immutable critic and remediation history", () => {
    const port = readyPort();
    const authorization = beginCompletenessCritic(port, "critic-1", { clock });
    findings(port, "critic-1", 1, authorization.token);
    remediate(port);
    const state = port.read();
    state.completion_remediations![0]!.remediation_sha256 = "tampered";
    expect(completionIssues(new TestPort(state).read())).toContain(
      "completion remediation 1 has an invalid digest",
    );
  });
});
