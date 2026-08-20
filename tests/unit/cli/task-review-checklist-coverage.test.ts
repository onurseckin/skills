import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadChecklist } from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { claimSubmitValidate, runGate, setupRun, TASK_ID, VALIDATOR } from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

const DOMAIN = "code-quality";
const checklist = loadChecklist(DOMAIN);
const ids = checklist.items.map((item) => item.id);

function fullCoverage(overrides: Record<string, { disposition: string; reason?: string }> = {}) {
  return ids.map((id) => ({ id, ...(overrides[id] ?? { disposition: "checked" }) }));
}

function writeReport(repo: string, name: string, body: unknown): string {
  const path = join(repo, name);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

async function validating(name: string): Promise<{ repo: string; run: string; token: string }> {
  // Checklist coverage is orthogonal to the adversarial-probe mandate; disabling it here keeps
  // these tests about coverage rather than about satisfying an unrelated precondition.
  const { repo, run } = await setupRun(name, roots, { min_adversarial_probes: 0 });
  const started = await claimSubmitValidate(repo, run);
  return { repo, run, token: started.token as string };
}

function baseArgv(run: string, token: string, evidence: string): string[] {
  return [
    "task:review",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
    "--token",
    token,
    "--evidence",
    evidence,
    "--status",
    "pass",
    "--summary",
    "All unit tests pass",
  ];
}

describe("task:review checklist coverage (B12.5)", () => {
  test("without --checklist-domain the report states plainly that no coverage applies", async () => {
    const { repo, run, token } = await validating("coverage-absent");
    const gateCmd = await runGate(repo, run, "gate-core.ts");

    const review = await execute(baseArgv(run, token, gateCmd));
    expect(review.checklist_coverage).toEqual({
      applicable: false,
      reason: "no --checklist-domain was named for this review; no standing checklist coverage applies",
    });
  });

  test("--checklist-domain and --checklist-report are demanded together", async () => {
    const { repo, run, token } = await validating("coverage-half-flags");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const reportPath = writeReport(repo, "coverage.json", { items: fullCoverage() });

    await expect(
      execute([...baseArgv(run, token, gateCmd), "--checklist-domain", DOMAIN]),
    ).rejects.toThrow(/--checklist-domain and --checklist-report must be given together/);

    await expect(
      execute([...baseArgv(run, token, gateCmd), "--checklist-report", reportPath]),
    ).rejects.toThrow(/--checklist-domain and --checklist-report must be given together/);
  });

  test("rejects an unrecognized --checklist-domain", async () => {
    const { repo, run, token } = await validating("coverage-bad-domain");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const reportPath = writeReport(repo, "coverage.json", { items: [] });

    await expect(
      execute([
        ...baseArgv(run, token, gateCmd),
        "--checklist-domain",
        "not-a-domain",
        "--checklist-report",
        reportPath,
      ]),
    ).rejects.toThrow(/--checklist-domain is not a recognized validator domain: not-a-domain/);
  });

  test("refuses a review whose coverage omits checklist items", async () => {
    const { repo, run, token } = await validating("coverage-incomplete");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const reportPath = writeReport(repo, "coverage.json", { items: fullCoverage().slice(1) });

    await expect(
      execute([
        ...baseArgv(run, token, gateCmd),
        "--checklist-domain",
        DOMAIN,
        "--checklist-report",
        reportPath,
      ]),
    ).rejects.toThrow(/checklist coverage omits 1 item\(s\)/);
  });

  test("records full coverage plus an adjacent finding, and persists it to the review report on disk", async () => {
    const { repo, run, token } = await validating("coverage-full");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const reportPath = writeReport(repo, "coverage.json", {
      items: fullCoverage({
        [ids[0]!]: { disposition: "not_applicable", reason: "no such surface in this diff" },
        [ids[1]!]: { disposition: "could_not_check", reason: "the linter this item needs did not run" },
      }),
      adjacent_findings: [
        {
          id: "adj-1",
          checklist_item_id: ids[2],
          severity: "minor",
          observation: "sidebar label text is larger than every sibling label",
          remediation: "match the sidebar label to the sibling font-size token",
          evidence: [{ kind: "diff", reference: "src/sidebar.tsx" }],
        },
      ],
    });

    const review = await execute([
      ...baseArgv(run, token, gateCmd),
      "--checklist-domain",
      DOMAIN,
      "--checklist-report",
      reportPath,
    ]);

    const coverage = review.checklist_coverage as Record<string, unknown>;
    expect(coverage.applicable).toBe(true);
    expect(coverage.domain).toBe(DOMAIN);
    expect((coverage.items as unknown[]).length).toBe(ids.length);
    expect(coverage.adjacent_findings).toEqual([
      {
        id: "adj-1",
        checklist_item_id: ids[2],
        severity: "minor",
        observation: "sidebar label text is larger than every sibling label",
        remediation: "match the sidebar label to the sibling font-size token",
        evidence: [{ kind: "diff", reference: "src/sidebar.tsx" }],
      },
    ]);

    // The task's own verdict is untouched by coverage: it still passed on its own requirements.
    expect(review.verdict).toBe("pass");

    const persisted = JSON.parse(
      readFileSync(join(run, "reports", `${TASK_ID}-review.json`), "utf-8"),
    ) as Record<string, unknown>;
    expect(persisted.checklist_coverage).toEqual(coverage);
    expect(persisted.task_scope_findings).toEqual([]);
  });

  test("a failing verdict keeps task-scope findings and adjacent findings in separate buckets", async () => {
    const { repo, run, token } = await validating("coverage-fail-separate");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const reportPath = writeReport(repo, "coverage.json", {
      items: fullCoverage(),
      adjacent_findings: [
        {
          id: "adj-1",
          checklist_item_id: ids[2],
          severity: "minor",
          observation: "unrelated naming inconsistency outside this task's write scope",
          remediation: "rename the sibling constant to match",
          evidence: [{ kind: "diff", reference: "src/unrelated.ts" }],
        },
      ],
    });

    const review = await execute([
      "task:review",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      token,
      "--evidence",
      gateCmd,
      "--status",
      "fail",
      "--summary",
      "the empty payload path is unhandled",
      "--severity",
      "critical",
      "--remediation",
      "handle the empty payload before the insert",
      "--checklist-domain",
      DOMAIN,
      "--checklist-report",
      reportPath,
    ]);

    expect(review.verdict).toBe("fail");
    const finding = review.finding as Record<string, unknown>;
    expect(finding.observation).toBe("the empty payload path is unhandled");

    const coverage = review.checklist_coverage as Record<string, unknown>;
    const adjacent = coverage.adjacent_findings as Array<Record<string, unknown>>;
    expect(adjacent).toHaveLength(1);
    expect(adjacent[0]!.id).toBe("adj-1");
    // The blocking, task-scope finding and the adjacent standing-standard finding never share an id
    // space or a bucket: one gates the verdict, the other only informs it.
    expect(adjacent[0]!.id).not.toBe(finding.id);
  });
});
