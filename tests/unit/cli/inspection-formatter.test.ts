import { describe, expect, test } from "bun:test";
import {
  formatEvidenceBrief,
  formatEvidenceListBrief,
  formatFindingBrief,
  formatFindingsListBrief,
  formatReportBrief,
  formatReportsListBrief,
} from "../../../orchestrating-long-tasks/scripts/src/cli/formatters/inspection-formatter.ts";

describe("formatFindingBrief", () => {
  test("renders every field of a fully populated finding", () => {
    const brief = formatFindingBrief({
      finding: {
        id: "F-1",
        requirement_id: "R-1",
        severity: "high",
        observation: "the response leaked a secret",
        remediation: "redact the field",
      },
      path: "findings/F-1.json",
    });

    expect(brief).toContain("### Finding Detail: `F-1`");
    expect(brief).toContain("**Severity**: `high`");
    expect(brief).toContain("**Requirement ID**: `R-1`");
    expect(brief).toContain("the response leaked a secret");
    expect(brief).toContain("redact the field");
    expect(brief).toContain("`findings/F-1.json`");
  });

  test("falls back to message when observation is absent, and admits every other unknown", () => {
    const brief = formatFindingBrief({ finding: { message: "fallback text" }, path: "f.json" });

    expect(brief).toContain("`unknown`"); // id
    expect(brief).toContain("**Requirement ID**: `none`");
    expect(brief).toContain("fallback text");
    expect(brief).toContain("**Remediation**: None");
  });
});

describe("formatFindingsListBrief", () => {
  test("says plainly when there are no findings", () => {
    const brief = formatFindingsListBrief({ findings: [], count: 0 });
    expect(brief).toContain("No findings recorded for this run.");
  });

  test("lists up to ten findings and summarises the remainder", () => {
    const findings = Array.from({ length: 12 }, (_, index) => ({
      id: `F-${index}`,
      severity: "low",
      observation: "x".repeat(80),
    }));

    const brief = formatFindingsListBrief({ findings, count: 12 });

    expect(brief).toContain("`F-0`");
    expect(brief).toContain("`F-9`");
    expect(brief).not.toContain("`F-10`");
    expect(brief).toContain("... and 2 more findings.");
    // Observation text is truncated to 60 characters within the row.
    expect(brief).toContain("x".repeat(60));
  });

  test("falls back to message when a listed finding has no observation", () => {
    const brief = formatFindingsListBrief({ findings: [{ message: "from message" }], count: 1 });
    expect(brief).toContain("from message");
  });
});

describe("formatReportBrief", () => {
  test("prefers status, falling back through verdict and decision", () => {
    expect(formatReportBrief({ report: { status: "passed" }, path: "r.json" })).toContain(
      "**Status / Verdict**: `passed`",
    );
    expect(formatReportBrief({ report: { verdict: "approve" }, path: "r.json" })).toContain(
      "**Status / Verdict**: `approve`",
    );
    expect(formatReportBrief({ report: { decision: "reject" }, path: "r.json" })).toContain(
      "**Status / Verdict**: `reject`",
    );
    expect(formatReportBrief({ report: {}, path: "r.json" })).toContain(
      "**Status / Verdict**: not recorded",
    );
  });

  test("defaults the name to unknown and the summary to a placeholder", () => {
    const brief = formatReportBrief({ report: {}, path: "r.json" });
    expect(brief).toContain("### Report: `unknown`");
    expect(brief).toContain("No summary provided");
  });

  test("uses the given name and lists up to five screenshots when present", () => {
    const brief = formatReportBrief({
      report: { screenshots: ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"] },
      path: "r.json",
      name: "critic-review",
    });

    expect(brief).toContain("### Report: `critic-review`");
    expect(brief).toContain("**Screenshots**: 6 captured");
    expect(brief).toContain("`a.png`");
    expect(brief).toContain("`e.png`");
    expect(brief).not.toContain("`f.png`");
  });

  test("shows the screenshots heading on request even with zero screenshots", () => {
    const brief = formatReportBrief({ report: {}, path: "r.json", showScreenshots: true });
    expect(brief).toContain("**Screenshots**: 0 captured");
  });

  test("omits the screenshots section entirely when there are none and none were requested", () => {
    const brief = formatReportBrief({ report: {}, path: "r.json" });
    expect(brief).not.toContain("Screenshots");
  });

  test("ignores a screenshots field that is not an array", () => {
    const brief = formatReportBrief({ report: { screenshots: "not-an-array" }, path: "r.json" });
    expect(brief).not.toContain("Screenshots");
  });
});

describe("formatReportsListBrief", () => {
  test("says plainly when there are no reports", () => {
    expect(formatReportsListBrief({ reports: [], count: 0 })).toContain(
      "No reports recorded for this run.",
    );
  });

  test("counts screenshots per report and shows the suffix only when relevant", () => {
    const brief = formatReportsListBrief({
      reports: [
        { name: "with-shots", path: "a.json", data: { screenshots: ["x.png", "y.png"] } },
        { name: "no-shots", path: "b.json", data: {} },
      ],
      count: 2,
    });

    expect(brief).toContain("**`with-shots`** (2 screenshots): `a.json`");
    expect(brief).toContain("**`no-shots`**: `b.json`");
  });

  test("forces the screenshots suffix on every row when requested, even at zero", () => {
    const brief = formatReportsListBrief({
      reports: [{ name: "bare", path: "a.json" }],
      count: 1,
      showScreenshots: true,
    });

    expect(brief).toContain("**`bare`** (0 screenshots): `a.json`");
  });

  test("lists up to ten reports and summarises the remainder", () => {
    const reports = Array.from({ length: 11 }, (_, index) => ({
      name: `r${index}`,
      path: `${index}.json`,
    }));
    const brief = formatReportsListBrief({ reports, count: 11 });

    expect(brief).toContain("`r0`");
    expect(brief).toContain("`r9`");
    expect(brief).not.toContain("`r10`");
    expect(brief).toContain("... and 1 more reports.");
  });
});

describe("formatEvidenceBrief", () => {
  test("renders a fully populated command evidence record", () => {
    const brief = formatEvidenceBrief({
      evidence: {
        command_id: "C-1",
        exit_code: 0,
        duration_ms: 1234,
        actor: "worker-1",
        argv: ["bun", "test"],
        screenshot_records: [{ path: "a.png" }],
      },
      path: "commands/C-1",
    });

    expect(brief).toContain("### Evidence: `C-1`");
    expect(brief).toContain("**Command**: `bun test`");
    expect(brief).toContain("**Actor**: `worker-1` | **Exit Code**: `0` | **Duration**: `1234ms`");
    expect(brief).toContain("**Screenshots**: 1 captured");
    expect(brief).toContain("`a.png`");
  });

  test("falls back to id when command_id is absent, and admits every other unknown", () => {
    const brief = formatEvidenceBrief({ evidence: { id: "fallback-id" }, path: "commands/x" });

    expect(brief).toContain("### Evidence: `fallback-id`");
    expect(brief).toContain("**Command**: ``");
    expect(brief).toContain("**Duration**: `N/A`");
    expect(brief).toContain("**Actor**: `unknown`");
  });

  test("ignores an argv or screenshot_records field that is not an array", () => {
    const brief = formatEvidenceBrief({
      evidence: { argv: "not-an-array", screenshot_records: "not-an-array" },
      path: "x",
    });
    expect(brief).toContain("**Command**: ``");
    expect(brief).not.toContain("Screenshots");
  });
});

describe("formatEvidenceListBrief", () => {
  test("says plainly when there is no evidence", () => {
    expect(formatEvidenceListBrief({ evidence: [], count: 0 })).toContain(
      "No evidence recorded for this run.",
    );
  });

  test("truncates argv to 50 characters and shows a screenshot suffix only when relevant", () => {
    const brief = formatEvidenceListBrief({
      evidence: [
        {
          command_id: "C-1",
          exit_code: 0,
          argv: [Array.from({ length: 10 }, () => "arg").join(" ")],
          screenshot_records: [{ path: "a.png" }],
        },
        { command_id: "C-2", exit_code: 1, argv: ["short"] },
      ],
      count: 2,
    });

    expect(brief).toContain("(1 screenshots)");
    expect(brief).not.toContain("C-2`** (exit: `1` (");
  });

  test("lists up to ten records and summarises the remainder", () => {
    const evidence = Array.from({ length: 11 }, (_, index) => ({ command_id: `C-${index}` }));
    const brief = formatEvidenceListBrief({ evidence, count: 11 });

    expect(brief).toContain("`C-0`");
    expect(brief).toContain("`C-9`");
    expect(brief).not.toContain("`C-10`");
    expect(brief).toContain("... and 1 more evidence records.");
  });

  test("forces the screenshot suffix on every row when requested, even at zero", () => {
    const brief = formatEvidenceListBrief({
      evidence: [{ command_id: "C-1" }],
      count: 1,
      showScreenshots: true,
    });
    expect(brief).toContain("(0 screenshots)");
  });
});
