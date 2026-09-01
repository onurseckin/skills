import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  criticRejectCommand,
  criticRemediateCommand,
  criticReviewCommand,
  criticStartCommand,
} from "../../../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { registerInspectionCommand, setupReadyRun } from "../../fixtures/critic-ready-fixture.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { transact, loadRun } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";
import { reviewedFindingsRun } from "./critic-remediate-core.test.ts";

const roots: string[] = [];

beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});

afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

describe("critic-ops comprehensive test suite", () => {
  test("criticStartCommand initializes session with string and array gates", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-CRITIC-START-INSPECT";
    registerInspectionCommand(run, repo, cmdId, criticId);

    transact(run, "test-setup", "add-array-gate", {}, (state) => {
      state.gates = [
        { id: "gate-arr", scope: "run", mandatory: true, command: ["bun", "test", "arr"] },
        { id: "gate-str", scope: "run", mandatory: true, command: "bun test str" },
      ];
    });

    const startWithIds = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    expect(typeof startWithIds.token).toBe("string");
    expect(startWithIds.critic).toBeDefined();
    expect(startWithIds.packet_id).toBeDefined();
    expect(String(startWithIds.markdown)).toContain("Completeness Critic Session Initialized");

    const { run: run2 } = await setupReadyRun("critic-changes-run", roots);
    const startWithoutIds = await criticStartCommand({ run: run2, critic: "critic-beta" });
    expect(typeof startWithoutIds.token).toBe("string");
    expect(startWithoutIds.run_root).toBe(run2);
  });

  test("criticReviewCommand validates decisions and catches superficial rubber-stamps", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-INSPECT-VAL";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    const token = start.token as string;

    await expect(
      criticReviewCommand({
        run,
        critic: criticId,
        token,
        decision: "invalid_decision",
        summary: "Detailed review summary exceeding 15 chars",
      }),
    ).rejects.toThrow("--decision must be approve or request_changes");

    const genericStamps = ["lgtm", "looks good", "approved", "pass", "verified", "done"];
    for (const stamp of genericStamps) {
      await expect(
        criticReviewCommand({ run, critic: criticId, token, decision: "approve", summary: stamp }),
      ).rejects.toThrow("critic summary cannot be a superficial rubber-stamp");
    }

    await expect(
      criticReviewCommand({
        run,
        critic: criticId,
        token,
        decision: "approve",
        summary: "Too short",
      }),
    ).rejects.toThrow("critic summary cannot be a superficial rubber-stamp");
  });

  test("criticReviewCommand handles approve and synthesizes proofs with critic and gate checks fallback", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-INSPECT-FULL";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    const token = start.token as string;

    const review = await criticReviewCommand({
      run,
      critic: criticId,
      token,
      decision: "approve",
      summary: "Comprehensive sign-off covering all functional requirements and gates.",
    });

    expect(review.decision).toBe("approve");
    expect(review.report_path).toBeDefined();
    expect(String(review.markdown)).toContain("APPROVED");

    // Fallback to runGateChecks when critic has no direct inspection commands
    const { run: runGate } = await setupReadyRun("critic-no-findings", roots);
    const criticGate = "critic-delta";
    const startGate = await criticStartCommand({ run: runGate, critic: criticGate });

    const reviewGate = await criticReviewCommand({
      run: runGate,
      critic: criticGate,
      token: startGate.token as string,
      decision: "approve",
      summary: "Comprehensive sign-off verified purely against run gate suite.",
    });
    expect(reviewGate.decision).toBe("approve");
  });

  test("criticReviewCommand reads review payload from file", async () => {
    const { repo, run } = await setupReadyRun("critic-review-file", roots);
    const criticId = "critic-file";
    const cmdId = "C-INSPECT-FILE";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    const token = start.token as string;
    const assignment = start.critic as { readiness_sha256: string; repository_binding: unknown };
    const packet = loadRun(run).state.packets?.[start.packet_id as string];
    const repoCmds = packet?.repository_command_ids ?? [cmdId];

    const reviewDir = await mkdtemp(join(tmpdir(), "review-test-"));
    roots.push(reviewDir);
    const reviewPath = join(reviewDir, "review.json");
    await writeFile(
      reviewPath,
      JSON.stringify({
        graph_revision: 1,
        status: "clean",
        readiness_sha256: assignment.readiness_sha256,
        repository_binding: assignment.repository_binding,
        repository_command_ids: repoCmds,
        checks: [{ command_id: cmdId }],
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: [
          {
            requirement_id: "req-1",
            status: "satisfied",
            evidence: [{ kind: "command", reference: cmdId, observation: "Passed" }],
          },
        ],
        residual_risks: [],
      }),
    );

    const result = await criticReviewCommand({
      run,
      critic: criticId,
      token,
      decision: "approve",
      review: reviewPath,
      summary: "Comprehensive sign-off verified via external review document.",
    });

    expect(result.decision).toBe("approve");
    expect(result.summary).toBe("Comprehensive sign-off verified via external review document.");
  });

  test("criticRejectCommand records structured findings and formats reject brief", async () => {
    const { repo, run } = await setupReadyRun("critic-reject-flow", roots);
    const criticId = "critic-gamma";
    const cmdId = "C-INSPECT-REJECT";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    const token = start.token as string;

    const findings = [
      {
        id: "F-UNIT-01",
        requirement_id: "req-1",
        severity: "critical",
        observation: "Missing validation logic in controller",
        remediation: "Add input validation boundary checks",
        revalidation: "bun test tests/controller.test.ts",
      },
    ];

    const reject = await criticRejectCommand({
      run,
      critic: criticId,
      token,
      findings: JSON.stringify(findings),
      summary: "Identified critical boundary validation defect.",
    });

    expect(reject.decision).toBe("request_changes");
    expect(reject.findings_count).toBe(1);
    expect(String(reject.markdown)).toContain("CHANGES REQUESTED");
  });

  test("criticRemediateCommand validates finding-command pairs and errors", async () => {
    const { run, findingId } = await reviewedFindingsRun("comp-remediate", roots);

    expect(() =>
      criticRemediateCommand({
        run,
        actor: "coordinator",
        resolve: ["invalid-pair-no-equals"],
        "resolution-method": [`${findingId}=repaired`],
      }),
    ).toThrow("--resolve must be given as <finding-id>=<value>");

    expect(() =>
      criticRemediateCommand({
        run,
        actor: "coordinator",
        resolve: [`${findingId}=C-FIX`],
        "resolution-method": [`${findingId}=m1`, `${findingId}=m2`],
      }),
    ).toThrow(`finding ${findingId} has two --resolution-method`);

    expect(() =>
      criticRemediateCommand({
        run,
        actor: "coordinator",
        resolve: [`${findingId}=`],
        "resolution-method": [`${findingId}=repaired`],
      }),
    ).toThrow(`--resolve must be given as <finding-id>=<value>`);

    expect(() =>
      criticRemediateCommand({ run, actor: "coordinator", resolve: [`${findingId}=C-FIX`] }),
    ).toThrow(`finding ${findingId} has no --resolution-method; state how it was remediated`);

    const result = criticRemediateCommand({
      run,
      actor: "coordinator",
      resolve: [`${findingId}=C-FIX`],
      "resolution-method": [`${findingId}=repaired logic and validated test`],
    });

    expect(result.run_root).toBe(run);
    expect(result.remediation).toBeDefined();
    expect(String(result.markdown)).toContain("Completion Findings Remediated");
  });

  test("criticRemediateCommand rejects when no review is recorded", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    registerInspectionCommand(run, repo, "C-NONE", "critic-alpha");
    transact(run, "test-setup", "clear-review", {}, (state) => {
      delete state.completion_review;
    });

    expect(() =>
      criticRemediateCommand({
        run,
        actor: "coordinator",
        resolve: ["F-1=C-NONE"],
        "resolution-method": ["F-1=fixed"],
      }),
    ).toThrow("no completion review is recorded for this run");
  });
});
