import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  criticRejectCommand,
  criticRemediateCommand,
  criticStartCommand,
} from "../../../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { registerInspectionCommand, setupReadyRun } from "../../fixtures/critic-ready-fixture.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
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

describe("critic-ops reject and remediate suite", () => {
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
