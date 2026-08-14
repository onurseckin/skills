import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/contracts/json.ts";
import { nextArgv } from "../../src/reporting/next-actions.ts";
import { orphanEvidenceSha256 } from "../../src/workflow/orphan-evidence/digest.ts";

function view(status: string): JsonObject {
  return {
    tasks: [
      {
        id: "T-1",
        status,
        owner: status === "leased" ? "worker" : null,
        role: status === "leased" ? "implementer" : null,
        attempt: 1,
        repair_assignee: status === "changes_requested" ? "worker" : null,
        original_implementer: "worker",
        requirement_ids: ["R-1"],
        gate_results: [],
        validation: status === "validating" ? { validator_id: "validator", attempt: 1 } : null,
      },
    ],
    gates: [
      {
        id: "G-task",
        scope: "task",
        cwd: ".",
        command: ["bun", "test", "focused"],
        requirement_ids: ["R-1"],
        mandatory: true,
      },
      {
        id: "G-run",
        scope: "run",
        cwd: ".",
        command: ["bun", "test", "all"],
        requirement_ids: [],
        mandatory: true,
      },
    ],
    packets: [],
    commands: [],
    completion_critic: null,
    completion_review: null,
    completion_remediations: [],
    completion_result: null,
    requirements: [],
    orphan_evidence: [],
    orphan_evidence_dispositions: [],
  };
}

const rendered = (status: string) =>
  nextArgv("/repo/.harness/run", "/repo/.harness/run/runtime/harness.ts", view(status))
    .map((argv) => argv.join(" "))
    .join("\n");

describe("state-specific resumable argv", () => {
  test("covers every active task transition without exposing a secret", () => {
    expect(rendered("leased")).toContain(" packet ");
    expect(rendered("leased")).toContain(" heartbeat ");
    expect(rendered("leased")).toContain(" submit ");
    expect(rendered("leased")).toContain("<host-only-bearer-secret-not-stored-in-packet>");
    expect(rendered("leased")).not.toContain("secret-from");
    expect(rendered("leased")).not.toContain("packet.md");
    expect(rendered("submitted")).toContain(" begin-validation ");
    expect(rendered("validating")).toContain(" review ");
    expect(rendered("changes_requested")).toContain("--role repairer");
    expect(rendered("validated")).toContain("--gate G-task");
    expect(rendered("validated")).toContain(" gate ");
    expect(rendered("gating")).toContain(" finish ");
    expect(rendered("leased")).not.toContain("token_digest");
  });

  test("handoff emits only applicable mandatory task gates", () => {
    const state = view("validated");
    (state.gates as JsonObject[]).push(
      {
        id: "G-unrelated",
        scope: "task",
        cwd: ".",
        command: ["bun", "test", "unrelated"],
        requirement_ids: ["R-2"],
        mandatory: true,
      },
      {
        id: "G-optional",
        scope: "task",
        cwd: ".",
        command: ["bun", "test", "optional"],
        requirement_ids: ["R-1"],
        mandatory: false,
      },
    );
    const actions = nextArgv("/repo/.harness/run", "/repo/.harness/run/runtime/harness.ts", state)
      .map((argv) => argv.join(" "))
      .join("\n");
    expect(actions).toContain("--gate G-task");
    expect(actions).not.toContain("--gate G-unrelated");
    expect(actions).not.toContain("--gate G-optional");
    expect(actions).not.toContain("--gate G-run");
  });

  test("prioritizes recovery over actions authenticated by expired authority", () => {
    const state = view("leased");
    state.stale_evidence = ["task T-1 lease expired at 2026-08-13T12:00:00.000Z"];
    const actions = nextArgv("/repo/.harness/run", "/repo/.harness/run/runtime/harness.ts", state)
      .map((argv) => argv.join(" "))
      .join("\n");

    expect(actions).toContain(" recover ");
    expect(actions).toContain("--grace-seconds 0");
    expect(actions).not.toContain(" heartbeat ");
    expect(actions).not.toContain(" submit ");
  });

  test("pauses task dispatch and emits an exact authority decision action", () => {
    const state = view("ready");
    state.requirements = [
      {
        id: "R-1",
        disposition: "needs_authority",
        authority_status: null,
      },
    ];
    const actions = nextArgv("/repo/.harness/run", "/repo/.harness/run/runtime/harness.ts", state)
      .map((argv) => argv.join(" "))
      .join("\n");

    expect(actions).toContain(" decide-authority ");
    expect(actions).toContain("--requirement R-1");
    expect(actions).not.toContain(" claim ");
    expect(actions).not.toContain(" schedule ");
  });

  test("covers run gates and critic assignment after every task is done", () => {
    const actions = rendered("done");
    expect(actions).toContain("--gate G-run");
    expect(actions).not.toContain(" begin-critic ");
  });

  test("dispositions orphan evidence before critic assignment", () => {
    const state = view("done");
    state.commands = [{ id: "C-RUN", status: "succeeded", task_id: null, gate_id: "G-run" }];
    const evidence = { task_id: "T-1", report_sha256: "late" };
    state.orphan_evidence = [{ orphan_sha256: orphanEvidenceSha256(evidence), evidence }];
    const actions = nextArgv("/repo/.harness/run", "/repo/.harness/run/runtime/harness.ts", state)
      .map((argv) => argv.join(" "))
      .join("\n");
    expect(actions).toContain(" disposition-orphan ");
    expect(actions).toContain(orphanEvidenceSha256(evidence));
    expect(actions).not.toContain(" begin-critic ");
  });

  test("covers critic packet, review, remediation, fresh review, and completion transitions", () => {
    const state = view("done");
    state.commands = [{ id: "C-RUN", status: "succeeded", task_id: null, gate_id: "G-run" }];
    const actions = () =>
      nextArgv("/repo/.harness/run", "/repo/.harness/run/runtime/harness.ts", state)
        .map((argv) => argv.join(" "))
        .join("\n");
    expect(actions()).toContain(" begin-critic ");
    state.completion_critic = {
      critic_id: "critic-1",
      attempt: 1,
      status: "assigned",
      packet_id: null,
    };
    expect(actions()).toContain(" packet ");
    expect(actions()).toContain("--repository-command-ids C-RUN");
    state.completion_critic = {
      critic_id: "critic-1",
      attempt: 1,
      status: "packet_published",
      packet_id: "critic-1",
    };
    state.packets = [
      {
        id: "critic-1",
        role: "completeness-critic",
        agent_id: "critic-1",
        task_id: null,
        attempt: 1,
        markdown_path: "packets/critic-1/packet.md",
      },
    ];
    expect(actions()).toContain(" review-completion ");
    state.completion_critic = {
      critic_id: "critic-1",
      attempt: 1,
      status: "reviewed",
      packet_id: "critic-1",
    };
    state.completion_review = { status: "findings", review_sha256: "review-1" };
    expect(actions()).toContain(" remediate-completion ");
    state.completion_remediations = [{ review_sha256: "review-1" }];
    expect(actions()).toContain(" begin-critic ");
    state.completion_review = { status: "clean", review_sha256: "review-2" };
    expect(actions()).toContain(" complete ");
    state.completion_critic = {
      critic_id: "expired-critic",
      attempt: 2,
      status: "expired",
      packet_id: null,
    };
    expect(actions()).toContain(" begin-critic ");
  });
});
