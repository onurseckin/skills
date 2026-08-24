import { describe, expect, test } from "bun:test";
import { attachGateResult } from "../../../olt/scripts/src/workflow/gates/attach-result.ts";
import { finalizePassingTask } from "../../../olt/scripts/src/cli/commands/task-review-support.ts";
import { at, commandRecord, TestPort, workflowState } from "../workflow/test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");

function validatedPort(): TestPort {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "validated",
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
  });
  state.commands["C-1"] = commandRecord("C-1", { task_id: "T-1", gate_id: "G-1" });
  state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE");
  return new TestPort(state);
}

describe("finalizePassingTask", () => {
  test("attaches every applicable gate and finishes the task", () => {
    const port = validatedPort();
    const state = finalizePassingTask(
      "unused-run-root",
      "T-1",
      "coordinator",
      ["C-1"],
      port.read(),
      port,
    );
    expect(state.tasks["T-1"]!.status).toBe("done");
    expect(state.tasks["T-1"]!.gate_results).toEqual([
      { gate_id: "G-1", command_id: "C-1", status: "passed" },
    ]);
  });

  test("returns the state unchanged when the task is not in it", () => {
    const port = validatedPort();
    const before = port.read();
    const state = finalizePassingTask(
      "unused-run-root",
      "no-such-task",
      "coordinator",
      ["C-1"],
      before,
      port,
    );
    expect(state).toBe(before);
  });

  test("swallows the expected race of a gate already attached by a concurrent pass, and still finishes", () => {
    const port = validatedPort();
    attachGateResult(port, "T-1", "G-1", "C-1", "other-validator", clock);
    expect(port.read().tasks["T-1"]!.status).toBe("gating");

    port.transact("test", "second-command-recorded", {}, (draft) => {
      draft.commands["C-2"] = commandRecord("C-2", { task_id: "T-1", gate_id: "G-1" });
    });

    const state = finalizePassingTask(
      "unused-run-root",
      "T-1",
      "coordinator",
      ["C-2"],
      port.read(),
      port,
    );

    expect(state.tasks["T-1"]!.status).toBe("done");
    expect(state.tasks["T-1"]!.gate_results).toEqual([
      { gate_id: "G-1", command_id: "C-1", status: "passed" },
    ]);
  });

  test("propagates a raw exception out of the gate-attach transaction instead of swallowing it", () => {
    const port = validatedPort();
    port.failNext("gate-attached");
    expect(() =>
      finalizePassingTask("unused-run-root", "T-1", "coordinator", ["C-1"], port.read(), port),
    ).toThrow("injected gate-attached failure");
  });

  test("propagates a raw exception out of the finish transaction instead of swallowing it", () => {
    const port = validatedPort();
    const stateWithNoGates = { ...port.read(), gates: [] };
    port.failNext("task-finished");
    expect(() =>
      finalizePassingTask("unused-run-root", "T-1", "coordinator", ["C-1"], stateWithNoGates, port),
    ).toThrow("injected task-finished failure");
  });

  test("propagates a HarnessError whose code is not the expected concurrent-race code", () => {
    const port = validatedPort();
    port.transact("test", "gate-removed", {}, (draft) => {
      draft.gates = [];
    });
    const staleStateStillClaimingTheGate = { ...port.read(), gates: workflowState().gates };

    expect(() =>
      finalizePassingTask(
        "unused-run-root",
        "T-1",
        "coordinator",
        ["C-1"],
        staleStateStillClaimingTheGate,
        port,
      ),
    ).toThrow("gate is not mandatory and applicable");
  });
});

describe("task-review-support additional helpers", () => {
  test("resolveCheckIds handles explicit evidence, commands object, and edge cases", async () => {
    const { resolveCheckIds } =
      await import("../../../olt/scripts/src/cli/commands/task-review-support.ts");

    // 1. Explicit evidence list
    expect(resolveCheckIds("C-1, C-2 , C-3", null, "T-1", "val-1", true)).toEqual([
      "C-1",
      "C-2",
      "C-3",
    ]);

    // 2. Empty or invalid commands
    expect(resolveCheckIds(undefined, null, "T-1", "val-1", true)).toEqual([]);
    expect(resolveCheckIds(undefined, "not-an-object", "T-1", "val-1", true)).toEqual([]);

    // 3. Command filtering with requireSuccess = true
    const commands = {
      "C-1": { id: "C-1", task_id: "T-1", actor: "val-1", exit_code: 0 },
      "C-2": { id: "C-2", task_id: "T-1", actor: "val-1", exit_code: 1 },
      "C-3": { id: "C-3", task_id: "T-2", actor: "val-1", exit_code: 0 },
      "C-4": { id: "C-4", task_id: "T-1", actor: "other-val", exit_code: 0 },
    };

    expect(resolveCheckIds(undefined, commands, "T-1", "val-1", true)).toEqual(["C-1"]);
    // with requireSuccess = false, C-2 is also included
    expect(resolveCheckIds(undefined, commands, "T-1", "val-1", false)).toEqual(["C-1", "C-2"]);
  });

  test("gateProofCommand matches gate command from checkIds", async () => {
    const { gateProofCommand } =
      await import("../../../olt/scripts/src/cli/commands/task-review-support.ts");

    const commands = {
      "C-1": { gate_id: "G-1" },
      "C-2": { gate_id: "G-2" },
      "C-3": { gate_id: null },
    };

    expect(gateProofCommand(commands, "G-1", ["C-1", "C-2"])).toBe("C-1");
    expect(gateProofCommand(commands, "G-2", ["C-1", "C-2"])).toBe("C-2");
    expect(gateProofCommand(commands, "G-3", ["C-1", "C-2"])).toBeUndefined();
  });

  test("dualChannelRefusalMessage formats error findings and fallback summary", async () => {
    const { dualChannelRefusalMessage } =
      await import("../../../olt/scripts/src/cli/commands/task-review-support.ts");

    const auditWithErrors = {
      isUiTask: true,
      passed: false,
      mode: "visual_only" as const,
      findings: [
        {
          id: "F-1",
          category: "contrast" as const,
          severity: "error" as const,
          message: "Contrast ratio too low",
        },
      ],
      proofs: [],
      summary: "Audit failed",
    };

    const msg = dualChannelRefusalMessage("task-ui", auditWithErrors);
    expect(msg).toContain("cannot pass task-ui");
    expect(msg).toContain("F-1 [contrast] Contrast ratio too low");

    const auditWithoutErrors = {
      isUiTask: true,
      passed: false,
      mode: "visual_only" as const,
      findings: [],
      proofs: [],
      summary: "Fallback audit summary failure",
    };

    const msg2 = dualChannelRefusalMessage("task-ui", auditWithoutErrors);
    expect(msg2).toContain("Fallback audit summary failure");
  });

  test("persistProbeReport and persistReviewReport write JSON files to reports directory", async () => {
    const { persistProbeReport, persistReviewReport } =
      await import("../../../olt/scripts/src/cli/commands/task-review-support.ts");
    const { scratchRoot } = await import("../../support/scratch-root.ts");
    const runDir = scratchRoot(import.meta.path, "reports-test");

    const probePath = persistProbeReport(runDir, "T-1", 1, { demand: "proof 1" });
    expect(await Bun.file(probePath).exists()).toBeTrue();
    const probeData = await Bun.file(probePath).json();
    expect(probeData.demand).toBe("proof 1");

    const reviewPath = persistReviewReport(
      runDir,
      "T-1",
      { status: "pass", verdict: "pass" },
      false,
    );
    expect(await Bun.file(reviewPath).exists()).toBeTrue();
    const reviewData = await Bun.file(reviewPath).json();
    expect(reviewData.status).toBe("pass");
  });

  test("collectCompanionManifests, collectTaskScreenshots, and runDualChannelAudit", async () => {
    const {
      collectCompanionManifests,
      collectTaskScreenshots,
      runDualChannelAudit,
      repoRootOf,
      reviewPolicyFor,
    } = await import("../../../olt/scripts/src/cli/commands/task-review-support.ts");
    const { scratchRoot } = await import("../../support/scratch-root.ts");
    const runDir = scratchRoot(import.meta.path, "manifests-test");

    // Create captures directory and companion manifest
    const capturesDir = `${runDir}/captures`;
    const manifestPath = `${capturesDir}/button.manifest.json`;
    await Bun.write(
      manifestPath,
      JSON.stringify({
        id: "btn-manifest",
        component: "Button",
        criteria: [],
      }),
    );

    // Also write a non-json and non-manifest file to test filter
    await Bun.write(`${capturesDir}/other.txt`, "hello");

    const manifests = collectCompanionManifests(runDir, "T-UI");
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests.some((m) => m.id === "btn-manifest")).toBeTrue();

    const screenshots = collectTaskScreenshots(runDir, "T-UI", "val-1", []);
    expect(Array.isArray(screenshots)).toBeTrue();

    const taskRecord: TaskRecord = {
      id: "T-UI",
      status: "validating",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      write_scope: ["src/ui/Button.tsx"],
    };

    const audit = runDualChannelAudit(runDir, taskRecord, screenshots, manifests, {
      requireSemanticDepth: true,
    });
    expect(audit).toBeDefined();

    expect(typeof repoRootOf(runDir)).toBe("string");
    const policy = reviewPolicyFor(runDir, "val-1");
    expect(policy.minProbes).toBeDefined();
  });
});
