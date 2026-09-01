import { describe, expect, test, afterEach } from "bun:test";
import { rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { finalizePassingTask } from "../../../../../olt/scripts/src/cli/commands/task-review-support.ts";
import type { TaskRecord, WorkflowState } from "../../../../../olt/scripts/src/workflow/types.ts";
import {
  at,
  commandRecord,
  TestPort,
  workflowState,
} from "../../../../workflow/shared/test-port.ts";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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
  state.gates["G-1"] = {
    id: "G-1",
    command: ["bun", "test"],
    cwd: ".",
    scope: "task",
    mandatory: true,
    requirement_ids: ["R-1"],
  };
  return new TestPort(state, clock);
}

describe("finalizePassingTask - Preconditions & Helpers", () => {
  test("keeps finish precondition failures visible instead of leaving the task silently unfinished", () => {
    const cases: Array<{ name: string; prepare: (state: WorkflowState) => void }> = [
      { name: "missing report", prepare: (state) => delete state.tasks["T-1"]!.report },
      {
        name: "missing passing review",
        prepare: (state) => {
          state.tasks["T-1"]!.validations![0]!.verdict = "reject";
        },
      },
      {
        name: "open finding",
        prepare: (state) => {
          state.tasks["T-1"]!.findings = [
            {
              id: "F-1",
              requirement_id: "R-1",
              task_id: "T-1",
              status: "open",
              severity: "P1",
              description: "unresolved",
              created_at: clock.now().toISOString(),
              created_by: "validator",
              round: 1,
            },
          ];
        },
      },
      {
        name: "open attempt",
        prepare: (state) => {
          state.tasks["T-1"]!.attempts = [{ status: "running" }];
        },
      },
    ];

    for (const { name: _name, prepare } of cases) {
      const state = validatedPort().read();
      prepare(state);
      const port = new TestPort(state);
      expect(() =>
        finalizePassingTask("unused-run-root", "T-1", "coordinator", ["C-1"], state, port),
      ).toThrow(HarnessError);
      expect(port.read().tasks["T-1"]!.status).not.toBe("done");
    }
  });

  test("resolveCheckIds handles explicit evidence, commands object, and edge cases", async () => {
    const { resolveCheckIds } =
      await import("../../../../../olt/scripts/src/cli/commands/task-review-support.ts");

    expect(resolveCheckIds("C-1, C-2 , C-3", null, "T-1", "val-1", true)).toEqual([
      "C-1",
      "C-2",
      "C-3",
    ]);

    expect(resolveCheckIds(undefined, null, "T-1", "val-1", true)).toEqual([]);
    expect(resolveCheckIds(undefined, "not-an-object", "T-1", "val-1", true)).toEqual([]);

    const commands = {
      "C-1": { id: "C-1", task_id: "T-1", actor: "val-1", exit_code: 0 },
      "C-2": { id: "C-2", task_id: "T-1", actor: "val-1", exit_code: 1 },
      "C-3": { id: "C-3", task_id: "T-2", actor: "val-1", exit_code: 0 },
      "C-4": { id: "C-4", task_id: "T-1", actor: "other-val", exit_code: 0 },
    };

    expect(resolveCheckIds(undefined, commands, "T-1", "val-1", true)).toEqual(["C-1"]);
    expect(resolveCheckIds(undefined, commands, "T-1", "val-1", false)).toEqual(["C-1", "C-2"]);
  });

  test("gateProofCommand matches gate command from checkIds", async () => {
    const { gateProofCommand } =
      await import("../../../../../olt/scripts/src/cli/commands/task-review-support.ts");

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
      await import("../../../../../olt/scripts/src/cli/commands/task-review-support.ts");

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
      await import("../../../../../olt/scripts/src/cli/commands/task-review-support.ts");
    const runDir = mkdtempSync(join(tmpdir(), "review-supp-reports-"));
    roots.push(runDir);

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
    } = await import("../../../../../olt/scripts/src/cli/commands/task-review-support.ts");
    const runDir = mkdtempSync(join(tmpdir(), "review-supp-manifests-"));
    roots.push(runDir);
    mkdirSync(join(runDir, ".capsules"), { recursive: true });
    mkdirSync(join(runDir, ".olt"), { recursive: true });
    mkdirSync(join(runDir, "captures"), { recursive: true });

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
