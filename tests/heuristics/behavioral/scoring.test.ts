/**
 * @file scoring.test.ts
 * Unit tests for Quantitative Efficiency Scoring (0.0% - 100.0%), Proposals, and Formatting.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeBehavioralForensics,
  calculateForensicsEfficiencyScore,
  createIncident,
  formatBehavioralForensicsReport,
  renderBehavioralForensicsAsciiTable,
  serializeProposalsToFeedbackJson,
  synthesizePlanInjectionProposals,
} from "../../../olt/scripts/src/heuristics/index.ts";

describe("Behavioral Forensics: Quantitative Efficiency Scoring (0.0% - 100.0%)", () => {
  it("yields 100.0% efficiency on perfectly clean run", () => {
    const report = calculateForensicsEfficiencyScore({
      incidents: [],
      fileReadCount: 5,
      fileWriteCount: 5,
      readToWriteRatio: 1.0,
      pollingCallsCount: 0,
      sequentialWaveBottlenecks: 0,
    });

    expect(report.boundedScore).toBe(100.0);
    expect(report.formattedScore).toBe("100.0%");
    expect(report.deductions.length).toBe(0);
  });

  it("applies accurate severity deductions (CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3)", () => {
    const incidents = [
      createIncident({
        category: "ROLE_BOUNDARY_DEVIATION",
        target: "c1",
        title: "Crit",
        observation: "Crit obs",
        severity: "CRITICAL",
      }),
      createIncident({
        category: "TOKEN_BURNING",
        target: "h1",
        title: "High",
        observation: "High obs",
        severity: "HIGH",
      }),
      createIncident({
        category: "POLLING_WASTE",
        target: "m1",
        title: "Med",
        observation: "Med obs",
        severity: "MEDIUM",
      }),
      createIncident({
        category: "STRAGGLER",
        target: "l1",
        title: "Low",
        observation: "Low obs",
        severity: "LOW",
      }),
    ];

    const report = calculateForensicsEfficiencyScore({
      incidents,
      fileReadCount: 10,
      fileWriteCount: 2,
      readToWriteRatio: 5.0,
      pollingCallsCount: 0,
      sequentialWaveBottlenecks: 0,
    });

    // 100 - (25 + 15 + 8 + 3) = 49.0
    expect(report.boundedScore).toBe(49.0);
    expect(report.formattedScore).toBe("49.0%");
    expect(report.deductions.length).toBe(4);
  });

  it("bounds catastrophic deductions strictly to 0.0%", () => {
    const incidents = Array.from({ length: 10 }, (_, i) =>
      createIncident({
        category: "ROLE_BOUNDARY_DEVIATION",
        target: `target-${i}`,
        title: `Crit-${i}`,
        observation: "Catastrophic violation",
        severity: "CRITICAL",
      }),
    );

    const report = calculateForensicsEfficiencyScore({
      incidents,
      fileReadCount: 100,
      fileWriteCount: 0,
      readToWriteRatio: 100,
      pollingCallsCount: 50,
      sequentialWaveBottlenecks: 5,
    });

    expect(report.rawScore).toBe(-200.0);
    expect(report.boundedScore).toBe(0.0);
    expect(report.formattedScore).toBe("0.0%");
  });

  it("calculates exploration ratio penalty if reads disproportionately outpace writes", () => {
    const report = calculateForensicsEfficiencyScore({
      incidents: [],
      fileReadCount: 35,
      fileWriteCount: 1,
      readToWriteRatio: 35.0,
      pollingCallsCount: 0,
      sequentialWaveBottlenecks: 0,
    });

    expect(report.boundedScore).toBeLessThan(100.0);
    expect(report.deductions.some((d) => d.category === "EFFICIENCY_RATIO")).toBe(true);
  });
});

describe("Behavioral Forensics: Plan Injection Proposals & Feedback JSON", () => {
  it("synthesizes actionable plan proposals for detected incidents", () => {
    const incidents = [
      createIncident({
        category: "FALSE_SERIALIZATION",
        target: "wave-2",
        title: "Disjoint writes serialized",
        observation: "Task A and Task B had disjoint scopes.",
        severity: "HIGH",
      }),
      createIncident({
        category: "TOKEN_BURNING",
        target: "agent-1",
        title: "Over-exploration",
        observation: "Read 25 files before first edit.",
        severity: "HIGH",
      }),
    ];

    const proposals = synthesizePlanInjectionProposals(incidents);
    expect(proposals.length).toBe(2);
    expect(proposals[0].priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
    expect(proposals[0].remediationDirective).toBeDefined();

    const feedbackJson = serializeProposalsToFeedbackJson(proposals);
    const parsed = JSON.parse(feedbackJson);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].directive).toBeDefined();
  });
});

describe("Behavioral Forensics: Markdown & ASCII Report Formatting", () => {
  it("formats comprehensive markdown and ASCII reports", () => {
    const result = analyzeBehavioralForensics({
      runId: "run-clean-formatting",
    });

    const reportMd = formatBehavioralForensicsReport(result);
    expect(reportMd).toContain("# Behavioral Forensics & Token Burn Analysis Report");
    expect(reportMd).toContain("100.0%");
    expect(reportMd).toContain("CLEAN / HIGH EFFICIENCY");

    const cleanAscii = renderBehavioralForensicsAsciiTable([]);
    expect(cleanAscii).toContain("No forensics incidents detected");

    const dirtyAscii = renderBehavioralForensicsAsciiTable([
      createIncident({
        category: "TOKEN_BURNING",
        target: "t1",
        title: "Excessive reads",
        observation: "Obs",
        severity: "HIGH",
      }),
    ]);
    expect(dirtyAscii).toContain("TOKEN_BURNING");
    expect(dirtyAscii).toContain("HIGH");
  });
});

describe("Behavioral Forensics: Static Invariants & Modularity", () => {
  it("enforces strict directory density (<= 10 files) in behavioral-forensics", () => {
    const dirPath = join(
      import.meta.dir,
      "../../../olt/scripts/src/heuristics/behavioral-forensics",
    );
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeLessThanOrEqual(10);
    expect(files.length).toBe(10);
  });

  it("enforces strict line count (<= 300 lines) per file in behavioral-forensics", () => {
    const dirPath = join(
      import.meta.dir,
      "../../../olt/scripts/src/heuristics/behavioral-forensics",
    );
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".ts"));

    for (const file of files) {
      const content = readFileSync(join(dirPath, file), "utf-8");
      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(300);
    }
  });

  it("verifies zero any annotations and zero compiler suppressions across all domain files", () => {
    const dirPath = join(
      import.meta.dir,
      "../../../olt/scripts/src/heuristics/behavioral-forensics",
    );
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".ts"));

    const forbiddenAnyTokens = [
      ":" + " any",
      "as" + " any",
      "<" + "any>",
      "Array<" + "any>",
      "Record<string," + " any>",
      "Promise<" + "any>",
    ];
    const forbiddenSuppressionTokens = [
      "@" + "ts-ignore",
      "@" + "ts-expect-error",
      "@" + "ts-nocheck",
      "eslint-" + "disable",
      "oxlint-" + "disable",
    ];

    for (const file of files) {
      const content = readFileSync(join(dirPath, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const token of forbiddenAnyTokens) {
          expect({ file, line: i + 1, text: line, tokenFound: line.includes(token) }).toEqual({
            file,
            line: i + 1,
            text: line,
            tokenFound: false,
          });
        }
        for (const token of forbiddenSuppressionTokens) {
          expect({ file, line: i + 1, text: line, tokenFound: line.includes(token) }).toEqual({
            file,
            line: i + 1,
            text: line,
            tokenFound: false,
          });
        }
      }
    }
  });
});
