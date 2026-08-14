import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { beginCompletenessCritic } from "../../orchestrating-long-tasks/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { recordCompletionReview } from "../../orchestrating-long-tasks/scripts/src/workflow/completion/record-completion-review.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const integrity = [{ status: "passed", event_head: "head" }];
const integritySha = createHash("sha256").update(canonicalJsonBytes(integrity)).digest("hex");
const verifyRepository = () => structuredClone(repositoryBinding);

function reviewPort() {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "done",
    report: { summary: "done" },
    validation: {
      validator_id: "validator",
      token_digest: "digest",
      attempt: 1,
      started_at: clock.now().toISOString(),
      deadline_at: "2026-08-13T13:00:00.000Z",
      verdict: "pass",
      reviewed_requirement_ids: ["R-1"],
      checks: [{ command_id: "C-V" }],
    },
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
  const port = new TestPort(state);
  const assigned = beginCompletenessCritic(port, "critic", { clock });
  port.transact("critic", "publish", {}, (draft) => {
    draft.commands["C-CHECK"] = commandRecord("C-CHECK", { task_id: null, actor: "critic" });
    const authority = draft.completion_critic!;
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
        readiness_sha256: authority.readiness_sha256,
        repository_binding: structuredClone(repositoryBinding),
        repository_command_ids: ["C-RUN"],
        integrity_evidence_sha256: integritySha,
        published_at: clock.now().toISOString(),
      },
    };
    authority.status = "packet_published";
    authority.packet_id = "critic-1";
    Object.assign(draft.completion_critic_history![0]!, authority);
  });
  return { port, token: assigned.token };
}

function input(port: TestPort, token: string) {
  const readiness = port.read().completion_critic!.readiness_sha256;
  return {
    packet_id: "critic-1",
    critic_token: token,
    packet_sha256: "a".repeat(64),
    graph_revision: 1,
    readiness_sha256: readiness,
    repository_binding: structuredClone(repositoryBinding),
    status: "clean",
    unresolved_finding_ids: [],
    findings: [],
    integrity_evidence: integrity,
    repository_command_ids: ["C-RUN"],
    checks: [{ command_id: "C-CHECK" }],
    requirement_proofs: [
      {
        requirement_id: "R-1",
        status: "satisfied",
        evidence: [
          { kind: "command", reference: "C-CHECK", observation: "verified independently" },
        ],
      },
    ],
    residual_risks: [],
  };
}

describe("structured completion review", () => {
  test("requires exact requirement proofs and explicit residual risks", () => {
    const { port, token } = reviewPort();
    expect(() =>
      recordCompletionReview(
        port,
        "critic",
        { ...input(port, token), requirement_proofs: [] },
        verifyRepository,
        clock,
      ),
    ).toThrow("requirement");
    expect(() =>
      recordCompletionReview(
        port,
        "critic",
        { ...input(port, token), residual_risks: undefined },
        verifyRepository,
        clock,
      ),
    ).toThrow("residual_risks");
    const state = recordCompletionReview(
      port,
      "critic",
      input(port, token),
      verifyRepository,
      clock,
    );
    expect(state.completion_review!.requirement_proofs).toHaveLength(1);
    expect(state.completion_review!.residual_risks).toEqual([]);
  });

  test("persists complete findings and requires exact unresolved IDs", () => {
    const { port, token } = reviewPort();
    const finding = {
      id: "CF-1",
      requirement_id: "R-1",
      severity: "important",
      observation: "boundary case is untested",
      evidence: [{ path: "src/a.ts", line: 12 }],
      remediation: "add the missing boundary test",
      revalidation: "run C-CHECK again",
    };
    const review = {
      ...input(port, token),
      status: "findings",
      findings: [finding],
      unresolved_finding_ids: ["CF-1"],
    };
    const state = recordCompletionReview(port, "critic", review, verifyRepository, clock);
    expect(state.completion_review!.findings).toEqual([finding]);

    const mismatch = reviewPort();
    expect(() =>
      recordCompletionReview(
        mismatch.port,
        "critic",
        { ...review, critic_token: mismatch.token, unresolved_finding_ids: [] },
        verifyRepository,
        clock,
      ),
    ).toThrow("finding");
  });

  test("rejects readiness drift and finding IDs reused from immutable review history", () => {
    const drift = reviewPort();
    drift.port.transact("coordinator", "drift", {}, (draft) =>
      draft.requirements[0]!.evidence.push("late"),
    );
    expect(() =>
      recordCompletionReview(
        drift.port,
        "critic",
        input(drift.port, drift.token),
        verifyRepository,
        clock,
      ),
    ).toThrow("readiness");

    const reused = reviewPort();
    reused.port.transact("test", "history", {}, (draft) => {
      draft.completion_reviews = [{ id: "legacy", findings: [{ id: "CF-1" }] } as never];
    });
    const finding = {
      id: "CF-1",
      requirement_id: "R-1",
      severity: "minor",
      observation: "x",
      evidence: [{ path: "x" }],
      remediation: "fix",
      revalidation: "test",
    };
    expect(() =>
      recordCompletionReview(
        reused.port,
        "critic",
        {
          ...input(reused.port, reused.token),
          status: "findings",
          findings: [finding],
          unresolved_finding_ids: ["CF-1"],
        },
        verifyRepository,
        clock,
      ),
    ).toThrow("reused");
  });

  test("rejects a review at or after the critic authorization deadline", () => {
    const { port, token } = reviewPort();
    expect(() =>
      recordCompletionReview(
        port,
        "critic",
        input(port, token),
        verifyRepository,
        at("2026-08-13T12:20:00.000Z"),
      ),
    ).toThrow("authentication");
  });
});
