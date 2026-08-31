import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { undeclaredEntries } from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import {
  classifyIssueSeverity,
  runDoctor,
  tierDoctorIssues,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import {
  auditTierConfinement,
  summarizeTierConfinement,
} from "../../../olt/scripts/src/reporting/doctor/tier-confinement/index.ts";
import { formatDoctorBrief } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";

export const doctorSeverityTieringSuiteName = "Doctor Severity Tiering & Cosmetic Classification Suite";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function crashedPulseState(): JsonObject {
  return { pulse: { last: { outcome: "crashed", terminal_reason: "crashed" } } };
}

describe(doctorSeverityTieringSuiteName, () => {
  test("a freshly initialised capsule that has brainstorming.json reports Healthy: yes", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doc-tiering-brainstorm-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));
    const runRoot = initRun(
      repo,
      "brainstorm-default-run",
      new TextEncoder().encode("Build a slugify helper."),
      "file",
      true,
    );

    writeFileSync(
      join(runRoot, "brainstorming.json"),
      JSON.stringify({
        schema: "harness.brainstorming",
        version: 1,
        prompt: "Build a slugify helper.",
        rounds: 1,
        vectors: [],
        total_expanded_items: 0,
      }),
    );

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(true);
    expect(report.issues).not.toContain(
      "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json",
    );
  });

  test("classifyIssueSeverity marks a real undeclared-entry note cosmetic and a real tier-confinement finding critical", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doc-tiering-classify-"));
    roots.push(repo);
    const runRoot = initRun(
      repo,
      "classify-run",
      new TextEncoder().encode("Prompt."),
      "file",
      true,
    );
    writeFileSync(join(runRoot, "random-extra-file.txt"), "cosmetic noise");

    const cosmeticIssues = undeclaredEntries(runRoot);
    expect(cosmeticIssues.length).toBe(1);
    const cosmeticIssue = cosmeticIssues[0];
    expect(cosmeticIssue).toBeDefined();
    const cosmeticText = `${cosmeticIssue?.code}: ${cosmeticIssue?.message}`;
    expect(classifyIssueSeverity(cosmeticText)).toBe("cosmetic");

    const findings = auditTierConfinement("", crashedPulseState());
    expect(findings.length).toBe(1);
    expect(findings[0]?.severity).toBe("critical");
    const summary = summarizeTierConfinement(findings);
    const criticalText = summary.issues[0];
    expect(criticalText).toBeDefined();
    expect(criticalText).toContain(
      'Subagent "unknown" terminated mind pulse loop with outcome "crashed"',
    );
    expect(classifyIssueSeverity(criticalText === undefined ? "" : criticalText)).toBe("critical");
  });

  test("tierDoctorIssues keeps a critical finding unhealthy even alongside a cosmetic note, and keeps the two lists separate", () => {
    const findings = auditTierConfinement("", crashedPulseState());
    const { issues: criticalTexts } = summarizeTierConfinement(findings);
    const cosmeticText = "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json";

    const cosmeticOnly = tierDoctorIssues([cosmeticText]);
    expect(cosmeticOnly.healthy).toBe(true);
    expect(cosmeticOnly.cosmeticIssues).toEqual([cosmeticText]);
    expect(cosmeticOnly.criticalIssues).toEqual([]);

    const criticalOnly = tierDoctorIssues(criticalTexts);
    expect(criticalOnly.healthy).toBe(false);
    expect(criticalOnly.criticalIssues).toEqual(criticalTexts);

    const both = tierDoctorIssues([...criticalTexts, cosmeticText]);
    expect(both.healthy).toBe(false);
    expect(both.criticalIssues).toEqual(criticalTexts);
    expect(both.cosmeticIssues).toEqual([cosmeticText]);
  });

  test("formatDoctorBrief renders the critical finding in a visibly-flagged section the cosmetic note cannot mask", () => {
    const findings = auditTierConfinement("", crashedPulseState());
    const { issues: criticalTexts } = summarizeTierConfinement(findings);
    const criticalText = criticalTexts[0];
    expect(criticalText).toBeDefined();
    const cosmeticText = "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json";
    const combined = criticalText === undefined ? [cosmeticText] : [criticalText, cosmeticText];
    const tiered = tierDoctorIssues(combined);

    const brief = formatDoctorBrief("run-x", {
      healthy: tiered.healthy,
      bun_version: "1.3.14",
      bun_supported: true,
      gitignored: true,
      issues: combined,
      critical_issues: tiered.criticalIssues,
      cosmetic_issues: tiered.cosmeticIssues,
    });

    expect(brief).toContain("- **Healthy**: no");
    expect(brief).toContain("- **Critical Issues**:");
    expect(brief).toContain("- **Notices**");
    if (criticalText !== undefined) {
      expect(brief).toContain(`  - ${criticalText}`);
    }
    expect(brief).toContain(`  - ${cosmeticText}`);

    const criticalHeaderIndex = brief.indexOf("- **Critical Issues**:");
    const noticesHeaderIndex = brief.indexOf("- **Notices**");
    expect(criticalHeaderIndex).toBeGreaterThan(-1);
    expect(noticesHeaderIndex).toBeGreaterThan(criticalHeaderIndex);
  });

  test("a cosmetic-only integrity issue does not suppress computation of a real critical finding via runDoctor", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doc-tiering-mask-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));
    const runRoot = initRun(repo, "mask-run", new TextEncoder().encode("Prompt."), "file", true);

    transact(runRoot, "mind-gen-1", "pulse-recorded", {}, (state) => {
      state.pulse = { last: { outcome: "crashed", terminal_reason: "crashed" } };
    });
    writeFileSync(join(runRoot, "random-extra-file.txt"), "cosmetic noise");

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    const critical = report.critical_issues;
    const cosmetic = report.cosmetic_issues;
    expect(Array.isArray(critical)).toBe(true);
    expect(Array.isArray(cosmetic)).toBe(true);
    const criticalList = critical as string[];
    const cosmeticList = cosmetic as string[];
    expect(criticalList.some((issue) => issue.includes("tier-confinement [critical]"))).toBe(true);
    expect(cosmeticList.some((issue) => issue.startsWith("LAYOUT_UNDECLARED"))).toBe(true);
  });
});
