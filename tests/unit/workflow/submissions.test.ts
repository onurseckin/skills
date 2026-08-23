import { describe, expect, test } from "bun:test";
import type { RepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../olt/scripts/src/workflow/submission/submit.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { inspection } from "../packets/inspection-fixture.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "implemented",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed", evidence: "command:C-1" }],
  evidence: [{ kind: "diff", path: "src/owned/a.ts" }],
};

function stateWithBaseline(): WorkflowState {
  const state = workflowState();
  const baseline = inspection("baseline");
  state.baseline_repository_inspection_sha256 = baseline.inspection_sha256;
  state.repository_inspections = { [baseline.inspection_sha256]: baseline };
  return state;
}

const gitReturning =
  (...lines: string[]): RepositoryGitCommand =>
  () => ({ status: 0, bytes: Buffer.from(lines.join("\n"), "utf8") });

describe("workflow submissions", () => {
  test("accepts scoped evidence under a current lease", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    const result = submitTask(port, "T-1", "agent", token, report, at("2026-08-13T12:01:00.000Z"));
    expect(result.orphaned).toBeFalse();
    expect(result.state.tasks["T-1"]!.status).toBe("submitted");
    expect(result.state.tasks["T-1"]!.lease).toBeUndefined();
  });

  test("rejects out-of-scope and malformed reports without mutation", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    const before = port.read();
    expect(() =>
      submitTask(
        port,
        "T-1",
        "agent",
        token,
        { ...report, files_changed: ["src/other/a.ts"] },
        start,
      ),
    ).toThrow();
    expect(port.read()).toEqual(before);
    expect(() => submitTask(port, "T-1", "agent", token, [], start)).toThrow();
  });

  // B21.2: the harness refuses the transition when the summary is missing, rather than trusting a
  // caller to have supplied one. `report.summary` has enforced this since the initial commit via
  // `requireText` in `validate-report.ts`; nothing previously proved it at the `submitTask` seam
  // task:submit actually calls, so a regression here (a validator loosened, a field renamed) would
  // have gone unnoticed until a run's own summaries silently went missing.
  test("B21.2: refuses submission with no summary, an empty summary, or a whitespace-only one", () => {
    for (const invalid of [
      (() => {
        const { summary: _omit, ...rest } = report;
        return rest;
      })(),
      { ...report, summary: "" },
      { ...report, summary: "   " },
    ]) {
      const port = new TestPort(workflowState());
      const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
      registerTaskPacket(port, "implementer", "agent", 1);
      const before = port.read();
      expect(() => submitTask(port, "T-1", "agent", token, invalid, start)).toThrow();
      expect(port.read()).toEqual(before);
    }
  });

  test("requires nonempty substantive checks and evidence", () => {
    for (const invalid of [
      { ...report, checks: [] },
      { ...report, checks: [{}] },
      { ...report, evidence: [] },
      { ...report, evidence: [{}] },
    ]) {
      const port = new TestPort(workflowState());
      const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
      registerTaskPacket(port, "implementer", "agent", 1);
      expect(() => submitTask(port, "T-1", "agent", token, invalid, start)).toThrow();
    }
  });

  test("preserves expired correct-token reports only as orphan evidence", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      leaseSeconds: 5,
      clock: start,
    });
    registerTaskPacket(port, "implementer", "agent", 1);
    const result = submitTask(port, "T-1", "agent", token, report, at("2026-08-13T12:00:06.000Z"));
    expect(result.orphaned).toBeTrue();
    expect(result.state.tasks["T-1"]!.status).toBe("leased");
    expect(result.state.orphan_evidence).toHaveLength(1);
    expect(JSON.stringify(result.state.orphan_evidence)).not.toContain(token);
  });

  test("refuses a submission once the task has drifted away from leased or running", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    port.transact("test", "status-drift", {}, (draft) => {
      draft.tasks["T-1"]!.status = "validating";
    });
    expect(() =>
      submitTask(port, "T-1", "agent", token, report, at("2026-08-13T12:01:00.000Z")),
    ).toThrow(/task is not accepting a submission/);
  });

  test("wrong tokens create no orphan evidence", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent", "implementer", { leaseSeconds: 5, clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    expect(() =>
      submitTask(port, "T-1", "agent", "wrong", report, at("2026-08-13T12:00:06.000Z")),
    ).toThrow();
    expect(port.read().orphan_evidence).toEqual([]);
  });

  // C10: write_scope is declared, never enforced elsewhere in the submission path — this is the
  // backstop that subtracts the union of every task's write_scope from the repository's baseline
  // diff and surfaces whatever remains as a capsule finding, which readiness-issues.ts already
  // treats as an open-finding completion blocker.
  test("C10: surfaces an open finding when the repository drifted outside every declared write_scope", () => {
    const port = new TestPort(stateWithBaseline());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    const git = gitReturning("src/owned/a.ts", "unrelated/rogue.json");
    const result = submitTask(
      port,
      "T-1",
      "agent",
      token,
      report,
      at("2026-08-13T12:01:00.000Z"),
      {},
      git,
    );
    expect(result.state.tasks["T-1"]!.status).toBe("submitted");
    const findings = result.state.tasks["T-1"]!.findings ?? [];
    expect(findings).toHaveLength(1);
    expect(findings[0]!.status).toBe("open");
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[0]!.observation).toContain("unrelated/rogue.json");
    expect(findings[0]!.observation).not.toContain("src/owned/a.ts");
  });

  test("C10: an out-of-band finding is appended alongside a pre-existing finding, not in place of it", () => {
    const state = stateWithBaseline();
    state.tasks["T-1"]!.findings = [
      {
        id: "F-existing",
        requirement_id: "R-1",
        severity: "important",
        observation: "unrelated review finding",
        evidence: [{ path: "a" }],
        remediation: "fix",
        revalidation: "test",
        status: "open",
      },
    ];
    const port = new TestPort(state);
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    const git = gitReturning("src/owned/a.ts", "unrelated/rogue.json");
    const result = submitTask(
      port,
      "T-1",
      "agent",
      token,
      report,
      at("2026-08-13T12:01:00.000Z"),
      {},
      git,
    );
    const findings = result.state.tasks["T-1"]!.findings ?? [];
    expect(findings).toHaveLength(2);
    expect(findings[0]!.id).toBe("F-existing");
    expect(
      findings.some((finding) => finding.observation.includes("unrelated/rogue.json")),
    ).toBeTrue();
  });

  test("C10: no finding is raised when every changed path is covered by a declared write_scope", () => {
    const port = new TestPort(stateWithBaseline());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    const git = gitReturning("src/owned/a.ts", "src/owned/nested/b.ts");
    const result = submitTask(
      port,
      "T-1",
      "agent",
      token,
      report,
      at("2026-08-13T12:01:00.000Z"),
      {},
      git,
    );
    expect(result.state.tasks["T-1"]!.findings ?? []).toEqual([]);
  });
});
