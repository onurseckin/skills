import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatMindAuditReportBrief,
  mindAuditReportCommand,
} from "../../../../../olt/scripts/src/cli/commands/mind-audit-report.ts";
import type { AgentRole } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

const PASS_ANSWERS = [
  "Q1:cmd-1:pass",
  "Q2:cmd-2:pass",
  "Q3:cmd-3:pass",
  "Q4:cmd-4:pass",
  "Q5:cmd-5:pass",
  "Q6:cmd-6:pass",
  "Q7:cmd-7:pass",
  "Q8:cmd-8:pass",
];

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function grantRole(run: string, agentId: string, role: AgentRole): void {
  transact(run, "coordinator", `grant-${agentId}`, {}, (draft) => {
    const agents = Array.isArray(draft.agents) ? [...draft.agents] : [];
    agents.push({
      id: agentId,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: new Date().toISOString(),
      status: "active",
    });
    draft.agents = agents;
  });
}

describe("mind-audit-report", () => {
  test("formatMindAuditReportBrief formats passed and finding questions", () => {
    const brief = formatMindAuditReportBrief({
      auditId: "audit-1",
      runRoot: "/virtual/run",
      actor: "mind-auditor",
      verdict: "changes_requested",
      summary: "Findings found",
      reportedAt: "2026-09-01T12:00:00.000Z",
      openFindings: ["Finding 1"],
      answers: [
        { question_id: "Q1", command_id: "cmd-1", verdict: "pass" },
        { question_id: "Q2", command_id: "cmd-2", verdict: "fail" },
      ],
    });
    expect(brief).toContain("Mind Audit Reported: `audit-1`");
    expect(brief).toContain("PASSED");
    expect(brief).toContain("FINDING");
  });

  test("validates timestamps, verdicts, role grants, and missing answer flags", async () => {
    const { run } = await setupCompiledRun("mind-audit-report-validations", roots);

    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "pass",
        now: "not-a-valid-date",
      }),
    ).toThrow("invalid --now timestamp");

    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "unknown-verdict",
      }),
    ).toThrow("invalid verdict 'unknown-verdict'");

    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "unregistered-auditor",
        verdict: "approved",
        answer: PASS_ANSWERS,
      }),
    ).toThrow("holds no grant");

    grantRole(run, "impl-agent", "implementer");
    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "impl-agent",
        verdict: "approved",
        answer: PASS_ANSWERS,
      }),
    ).toThrow("role 'mind-auditor' or 'mind' is required");

    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "approved",
      }),
    ).toThrow("either --answers-file or --answer must be provided");
  });

  test("validates answers file reading, json syntax errors, and missing questions", async () => {
    const { run } = await setupCompiledRun("mind-audit-report-file", roots);

    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "pass",
        "answers-file": "missing-file.json",
      }),
    ).toThrow("answers file not found");

    const badJsonPath = join(run, "bad.json");
    await writeFile(badJsonPath, "{ malformed json");
    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "passed",
        "answers-file": "bad.json",
      }),
    ).toThrow("failed to parse answers JSON file");

    const incompletePath = join(run, "incomplete.json");
    await writeFile(
      incompletePath,
      JSON.stringify([{ question_id: "Q1", command_id: "cmd-1", verdict: "pass" }]),
    );
    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "approved",
        "answers-file": "incomplete.json",
      }),
    ).toThrow("missing answers for audit questionnaire");
  });

  test("rejects approval when Q1 fails or findings exist, and collects open findings variations", async () => {
    const { run } = await setupCompiledRun("mind-audit-report-findings", roots);

    const q1FailAnswers = [
      "Q1:cmd-1:fail:Pulse gap detected",
      "Q2:cmd-2:pass",
      "Q3:cmd-3:pass",
      "Q4:cmd-4:pass",
      "Q5:cmd-5:pass",
      "Q6:cmd-6:pass",
      "Q7:cmd-7:pass",
      "Q8:cmd-8:pass",
    ];
    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "approved",
        answer: q1FailAnswers,
      }),
    ).toThrow("cannot approve audit when pulse gaps exist");

    const objectFailAnswers = [
      { question_id: "Q1", command_id: "c1", verdict: "pass" },
      {
        question_id: "Q2",
        command_id: "c2",
        verdict: "fail",
        findings: ["Finding A", "Finding B"],
      },
      { question_id: "Q3", command_id: "c3", verdict: "fail", statement: "Failed requirement" },
      { question_id: "Q4", command_id: "c4", verdict: "fail" },
      { question_id: "Q5", command_id: "c5", verdict: "pass" },
      { question_id: "Q6", command_id: "c6", verdict: "pass" },
      { question_id: "Q7", command_id: "c7", verdict: "pass" },
      { question_id: "Q8", command_id: "c8", verdict: "pass" },
    ];
    const answersPath = join(run, "answers-findings.json");
    await writeFile(answersPath, JSON.stringify(objectFailAnswers));

    expect(() =>
      mindAuditReportCommand({
        run,
        actor: "mind-auditor",
        verdict: "approved",
        "answers-file": "answers-findings.json",
      }),
    ).toThrow("cannot approve audit when findings are open");

    const changesRes = mindAuditReportCommand({
      run,
      actor: "mind-auditor",
      verdict: "changes_requested",
      "answers-file": "answers-findings.json",
      "audit-id": "audit-custom-9",
    });
    expect(changesRes.verdict).toBe("changes_requested");
    expect(changesRes.open_findings.length).toBe(4);
    expect(changesRes.open_findings).toContain("Finding A");
    expect(changesRes.open_findings).toContain("Q3: Failed requirement");
    expect(changesRes.open_findings).toContain("Finding in Q4 (c4)");
  });

  test("processes halt verdict and sets mind halt state, and reports approved audit with summary defaults", async () => {
    const { run } = await setupCompiledRun("mind-audit-report-success", roots);

    const haltAnswers = [
      "Q1:cmd-1:pass",
      "Q2:cmd-2:fail:Critical integrity breach",
      "Q3:cmd-3:pass",
      "Q4:cmd-4:pass",
      "Q5:cmd-5:pass",
      "Q6:cmd-6:pass",
      "Q7:cmd-7:pass",
      "Q8:cmd-8:pass",
    ];

    const haltRes = mindAuditReportCommand({
      run,
      actor: "system",
      verdict: "halt",
      answer: haltAnswers,
    });
    expect(haltRes.verdict).toBe("halt");
    expect(haltRes.audit_id).toBe("audit-1");
    expect(haltRes.open_findings.length).toBe(1);

    const approvedRes = mindAuditReportCommand({
      run,
      actor: "coordinator",
      verdict: "approved",
      answer: PASS_ANSWERS,
      "audit-id": "audit-final",
      summary: "Clean verified audit",
      now: "2026-09-01T14:00:00.000Z",
    });

    expect(approvedRes.verdict).toBe("approved");
    expect(approvedRes.summary).toBe("Clean verified audit");
    expect(approvedRes.open_findings).toEqual([]);
    expect(approvedRes.reported_at).toBe("2026-09-01T14:00:00.000Z");
    expect(approvedRes.markdown).toContain("Mind Audit Reported: `audit-final`");
    expect(approvedRes.markdown).toContain("Verdict**: **APPROVED**");
  });
});
