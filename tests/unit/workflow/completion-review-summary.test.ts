import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import { recordCompletionReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/record-completion-review.ts";
import type { RepositoryBindingVerifier } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/repository-binding.ts";
import type { TransactionPort } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { collectActionSteps } from "../../../orchestrating-long-tasks/scripts/src/summary/timeline-collector.ts";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { requirementIds, setupReadyRun } from "../cli/critic-run-fixture.ts";
import { cleanupRoots } from "../cli/full-lifecycle-fixture.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";
import { beginCompletenessCritic } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { criticIntegrityDigest } from "../../../orchestrating-long-tasks/scripts/src/packets/critic-integrity-digest.ts";

// B21: recording the completion review is the run's final lifecycle closure. Before this, the
// CLI's --summary flag was already required but its value only ever reached a side report file and
// the markdown brief — never the durable, hash-chained CompletionReview the run actually completes
// against. `recordCompletionReview` never validated or stored it at all. A completion review is now
// refused outright when it carries no summary, and the CLI can no longer drop the flag's own value.

const roots: string[] = [];

/** A port that must never be touched: proves the summary check runs before any store access. */
function untouchedPort(): TransactionPort {
  return {
    read: () => {
      throw new Error("must not read the store before the summary is validated");
    },
    transact: () => {
      throw new Error("must not transact against the store before the summary is validated");
    },
  };
}

const neverCalledVerifier: RepositoryBindingVerifier = () => {
  throw new Error("must not verify the repository before the summary is validated");
};

describe("B21: completion review refuses without a summary, before touching the store", () => {
  test("domain: a missing summary is refused", () => {
    expect(() =>
      recordCompletionReview(untouchedPort(), "critic-1", { status: "clean" }, neverCalledVerifier),
    ).toThrow("summary must be non-blank text");
  });

  test("domain: a blank summary is refused, not accepted as empty text", () => {
    expect(() =>
      recordCompletionReview(
        untouchedPort(),
        "critic-1",
        { status: "clean", summary: "   " },
        neverCalledVerifier,
      ),
    ).toThrow("summary must be non-blank text");
  });

  test("CLI: --summary is required", async () => {
    const { run } = await setupReadyRun("b21-review-cli-missing-summary", roots);
    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "critic-1",
        "--token",
        "irrelevant",
        "--decision",
        "approve",
      ]),
    ).rejects.toThrow("--summary is required");
  });
});

describe("B21.3: the critic's summary is durably recorded, not only reported to a side file", () => {
  test("critic:review persists the summary onto completion_review.summary", async () => {
    const { repo, run } = await setupReadyRun("b21-review-persists-summary", roots);

    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-t1.ts",
    ]);
    const cmdId = execInspect.command_id as string;

    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-1",
      "--repository-command-ids",
      cmdId,
    ]);

    const evidence = [{ kind: "command", reference: cmdId, observation: "gate covers it" }];
    const proofs = JSON.stringify(
      requirementIds(run).map((id) => ({ requirement_id: id, status: "satisfied", evidence })),
    );
    const spokenSummary = "Whole diff verified: parser, gate and requirement R-1 all check out";

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-1",
      "--token",
      start.token as string,
      "--decision",
      "approve",
      "--proofs",
      proofs,
      "--summary",
      spokenSummary,
    ]);

    // Before this fix, `reviewPayload` never carried `summary` at all — the value stopped at the
    // CLI's local variable and the side `reports/critic-review.json` file. This is the actual
    // regression the fix closes: the durable, hashed record itself now carries the account.
    const recorded = review.completion_review as { summary?: string };
    expect(recorded.summary).toBe(spokenSummary);

    const persisted = loadRun(run).state.completion_review;
    expect(persisted?.summary).toBe(spokenSummary);
  });

  test("the completion-reviewed step narrates the critic's own summary, not just the packet id", () => {
    const event: HarnessEvent = {
      schema: "harness.event",
      version: 1,
      run_id: "test-run",
      capsule_id: "test-capsule",
      sequence: 1,
      revision: 1,
      timestamp: "2026-08-20T00:00:00.000Z",
      actor: "critic-1",
      kind: "completion-reviewed",
      payload: {
        packet_id: "critic-pkt-1",
        summary: "Whole diff verified against the run gate",
        status: "clean",
      },
      previous_hash: null,
      projection: {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: null,
      },
      hash: "hash",
    };
    const [step] = collectActionSteps([event]);
    expect(step?.summary).toContain("Whole diff verified against the run gate");
    expect(step?.summary).toContain("critic-pkt-1");
    expect(step?.summary).not.toBe("Event completion-reviewed recorded by critic-1");
  });
});

describe("B21.2: enforcement path — a run cannot close its completeness review without one", () => {
  const clock = at("2026-08-13T12:00:00.000Z");
  const integrity = [{ status: "passed", event_head: "head" }];
  const integritySha = criticIntegrityDigest(integrity);
  const verifyRepository = () => structuredClone(repositoryBinding);

  function reviewPort() {
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

  function input(port: TestPort, token: string, overrides: Record<string, unknown> = {}) {
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
      ...overrides,
    };
  }

  test("an otherwise-valid clean review is still refused with no summary field at all", () => {
    const { port, token } = reviewPort();
    const { summary: _drop, ...withoutSummary } = input(port, token);
    void _drop;
    expect(() =>
      recordCompletionReview(port, "critic", withoutSummary, verifyRepository, clock),
    ).toThrow("summary must be non-blank text");
    // Refused before any mutation landed: no half-recorded review sits on the state.
    expect(port.read().completion_review).toBeUndefined();
  });

  test("the same review succeeds, and closes the run's review, once a summary is given", () => {
    const { port, token } = reviewPort();
    const state = recordCompletionReview(
      port,
      "critic",
      input(port, token, { summary: "Whole diff verified against the run gate" }),
      verifyRepository,
      clock,
    );
    expect(state.completion_review?.summary).toBe("Whole diff verified against the run gate");
  });
});
