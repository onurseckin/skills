import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completionIssues } from "../../../../olt/scripts/src/workflow/completion/completion-state.ts";
import { attachGateResult } from "../../../../olt/scripts/src/workflow/gates/attach-result.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import {
  at,
  commandRecord,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "../../shared/test-port.ts";
import { captureGatePathBindings } from "../../../../olt/scripts/src/engine/runner/index.ts";
import { commandFingerprint } from "../../../../olt/scripts/src/workflow/gates/gate-policy.ts";

const clock = at("2026-08-13T12:00:00.000Z");
describe("submission, gate, and completion evidence", () => {
  test("submission covers exactly every mapped requirement", () => {
    const state = workflowState();
    state.tasks["T-1"]!.requirement_ids = ["R-1", "R-2"];
    state.requirements.push({
      id: "R-2",
      status: "planned",
      evidence: [],
      disposition: "actionable",
      dependencies: [],
    });
    const port = new TestPort(state);
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock });
    expect(() =>
      submitTask(
        port,
        "T-1",
        "agent",
        token,
        {
          summary: "partial",
          requirement_ids: ["R-1"],
          files_changed: [],
          checks: [],
          evidence: [],
        },
        clock,
      ),
    ).toThrow();
  });

  test("gate command must be associated with the same task and gate", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      status: "validated",
      report: { summary: "done" },
      validations: [
        {
          validator_id: "v",
          domain: "code-quality",
          started_at: clock.now().toISOString(),
          deadline_at: clock.now().toISOString(),
          verdict: "pass",
          reviewed_requirement_ids: ["R-1"],
        },
      ],
    });
    state.commands["C-1"] = commandRecord("C-1", {
      task_id: "T-other",
      gate_id: "G-other",
    });
    expect(() =>
      attachGateResult(new TestPort(state), "T-1", "G-1", "C-1", "coordinator", clock),
    ).toThrow();
  });

  test("gate attachment rechecks control-input overlap against current task scopes", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "gate-attachment-scope-"));
    try {
      await mkdir(join(repositoryRoot, "tools"));
      await writeFile(join(repositoryRoot, "tools", "verify"), "#!/bin/sh\nexit 0\n", {
        mode: 0o700,
      });
      const argv = ["./tools/verify"];
      const state = workflowState();
      Object.assign(state.tasks["T-1"]!, {
        status: "validated",
        write_scope: ["tools/verify"],
        report: { summary: "done" },
        validations: [
          {
            validator_id: "v",
            domain: "code-quality",
            started_at: clock.now().toISOString(),
            deadline_at: clock.now().toISOString(),
            verdict: "pass",
            reviewed_requirement_ids: ["R-1"],
          },
        ],
      });
      state.gates[0]!.command = argv;
      state.commands["C-1"] = commandRecord("C-1", {
        argv,
        cwd: repositoryRoot,
        cwd_relative: ".",
        repository_root: repositoryRoot,
        task_id: "T-1",
        gate_id: "G-1",
        fingerprint: commandFingerprint(repositoryRoot, argv),
        path_bindings: captureGatePathBindings(repositoryRoot, repositoryRoot, argv),
      });
      expect(() =>
        attachGateResult(new TestPort(state), "T-1", "G-1", "C-1", "coordinator", clock),
      ).toThrow(/prove the gate contract/i);
    } finally {
      await rm(repositoryRoot, { force: true, recursive: true });
    }
  });

  test("completion derives authoritative run gates and blocks missing critic provenance", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "done";
    state.tasks["T-1"]!.report = { summary: "done" };
    state.tasks["T-1"]!.validations = [
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
    ];
    state.requirements[0] = {
      id: "R-1",
      status: "satisfied",
      evidence: ["task:T-1"],
      disposition: "actionable",
      dependencies: [],
    };
    state.tasks["T-1"]!.gate_results = [{ gate_id: "G-1", command_id: "C-1", status: "passed" }];
    state.commands["C-1"] = commandRecord("C-1", {
      task_id: "T-1",
      gate_id: "G-1",
    });
    state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE");
    state.gates.push({
      id: "G-RUN",
      command: TEST_GATE_ARGV,
      cwd: ".",
      scope: "run",
      requirement_ids: [],
      mandatory: true,
    });
    state.commands["C-RUN"] = commandRecord("C-RUN", {
      argv: TEST_GATE_ARGV,
      task_id: null,
      gate_id: "G-RUN",
      actor: "coordinator",
      fingerprint: "set below",
    });
    state.commands["C-RUN"]!.fingerprint = commandRecord("C-RUN", {
      argv: TEST_GATE_ARGV,
    }).fingerprint;
    expect(completionIssues(new TestPort(state).read())).toEqual([
      "authoritative completion review is missing",
      "completion review history is missing or stale",
      "completion artifact verification is missing",
    ]);
    state.commands["C-RUN"]!.task_id = "T-1";
    expect(completionIssues(new TestPort(state).read())).toContain(
      "run gate G-RUN lacks an authoritative passing command",
    );
    state.commands["C-RUN"]!.task_id = null;
    state.commands["C-RUN"]!.fingerprint = "caller-selected-command";
    expect(completionIssues(new TestPort(state).read())).toContain(
      "run gate G-RUN lacks an authoritative passing command",
    );
    state.commands["C-RUN"]!.fingerprint = commandRecord("C-RUN", {
      argv: TEST_GATE_ARGV,
    }).fingerprint;
    state.orphan_evidence.push({ task_id: "T-1", report_sha256: "digest" });
    expect(
      completionIssues(new TestPort(state).read()).some((issue) =>
        issue.startsWith("orphan evidence is open:"),
      ),
    ).toBeTrue();
  });

  test("completion rechecks report, independent approval, and task gate evidence", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "done";
    state.requirements[0] = {
      id: "R-1",
      status: "satisfied",
      evidence: ["task:T-1"],
      disposition: "actionable",
      dependencies: [],
    };
    state.tasks["T-1"]!.gate_results = [
      { gate_id: "G-1", command_id: "missing", status: "passed" },
    ];
    const issues = completionIssues(new TestPort(state).read());
    expect(issues).toContain("task T-1 lacks a submission report");
    expect(issues).toContain("task T-1 lacks independent code-quality validator approval");
    expect(issues).toContain("task T-1 lacks authoritative gate G-1");
  });
});
