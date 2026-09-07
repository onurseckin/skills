import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { undeclaredEntries } from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import * as doc from "../../../olt/scripts/src/reporting/doctor.ts";
import * as tc from "../../../olt/scripts/src/reporting/doctor/tier-confinement/index.ts";
import { formatDoctorBrief } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import * as agentCanonical from "../../../olt/scripts/src/reporting/doctor/agent-canonical-engine.ts";
import * as socratic2 from "../../../olt/scripts/src/reporting/socratic-validator/evaluators-2.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  mockSubprocess,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const doctorSeverityTieringSuiteName =
  "Doctor Severity Tiering & Cosmetic Classification Suite";

let vfs: VirtualMemoryFS = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let subprocMock: { mockRestore: () => void } | null = null;
let canonicalSpy: { mockRestore: () => void } | null = null;
let socraticSpy: { mockRestore: () => void } | null = null;

function setupVirtualFs(): void {
  if (session) session.cleanup();
  if (subprocMock) subprocMock.mockRestore();
  if (canonicalSpy) canonicalSpy.mockRestore();
  if (socraticSpy) socraticSpy.mockRestore();

  vfs = new VirtualMemoryFS();
  vfs.mkdirSync(process.cwd(), { recursive: true });
  vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
  vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
  session = createVirtualFSSession(vfs);

  subprocMock = mockSubprocess(() => ({
    status: 0,
    stdout: "",
    stderr: "",
    error: undefined,
  }));
  canonicalSpy = spyOn(agentCanonical, "checkAgentCanonicalAlignment").mockReturnValue({
    engine: "checkAgentCanonicalAlignment",
    findings: [],
  });
  socraticSpy = spyOn(socratic2, "evaluateTwoKeyValidatorPairing").mockReturnValue([]);
}

afterEach(() => {
  if (session) {
    session.cleanup();
    session = null;
  }
  if (subprocMock) {
    subprocMock.mockRestore();
    subprocMock = null;
  }
  if (canonicalSpy) {
    canonicalSpy.mockRestore();
    canonicalSpy = null;
  }
  if (socraticSpy) {
    socraticSpy.mockRestore();
    socraticSpy = null;
  }
});

const initTestRun = (n: string) => {
  const r = `/virtual/repo-${n}`;
  vfs.mkdirSync(r, { recursive: true });
  vfs.mkdirSync(join(r, ".git"), { recursive: true });
  return initRun(r, `${n}-run`, new TextEncoder().encode("P"), "file", true);
};

const CRASHED = { pulse: { last: { outcome: "crashed", terminal_reason: "crashed" } } };
const crashedCritical = () =>
  tc.summarizeTierConfinement(tc.auditTierConfinement("", CRASHED)).issues;

describe(doctorSeverityTieringSuiteName, () => {
  test("a freshly initialised capsule that has brainstorming.json reports Healthy: yes", async () => {
    setupVirtualFs();
    const runRoot = initTestRun("tiering-brainstorm");
    vfs.writeFileSync(
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
    const report = await doc.runDoctor(runRoot);
    expect(
      report.healthy &&
        !report.issues.includes(
          "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json",
        ),
    ).toBe(true);
  });

  test("classifyIssueSeverity marks a real undeclared-entry note cosmetic and a real tier-confinement finding critical", () => {
    setupVirtualFs();
    const runRoot = initTestRun("tiering-classify");
    vfs.writeFileSync(join(runRoot, "random-extra-file.txt"), "cosmetic noise");
    const cosmeticIssues = undeclaredEntries(runRoot);
    expect(
      cosmeticIssues.length === 1 &&
        doc.classifyIssueSeverity(`${cosmeticIssues[0]?.code}: ${cosmeticIssues[0]?.message}`) ===
          "cosmetic",
    ).toBe(true);
    const criticalText = crashedCritical()[0] ?? "";
    expect(
      criticalText.includes(
        'Subagent "unknown" terminated mind pulse loop with outcome "crashed"',
      ) && doc.classifyIssueSeverity(criticalText) === "critical",
    ).toBe(true);
  });

  test("tierDoctorIssues keeps a critical finding unhealthy even alongside a cosmetic note, and keeps the two lists separate", () => {
    const criticalTexts = crashedCritical();
    const cosmeticText = "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json";
    const cosmeticOnly = doc.tierDoctorIssues([cosmeticText]);
    expect(
      cosmeticOnly.healthy &&
        cosmeticOnly.cosmeticIssues.length === 1 &&
        cosmeticOnly.criticalIssues.length === 0,
    ).toBe(true);

    const criticalOnly = doc.tierDoctorIssues(criticalTexts);
    expect(
      !criticalOnly.healthy && criticalOnly.criticalIssues.length === criticalTexts.length,
    ).toBe(true);

    const both = doc.tierDoctorIssues([...criticalTexts, cosmeticText]);
    expect(
      !both.healthy &&
        both.criticalIssues.length === criticalTexts.length &&
        both.cosmeticIssues.length === 1,
    ).toBe(true);
  });

  test("formatDoctorBrief renders the critical finding in a visibly-flagged section the cosmetic note cannot mask", () => {
    const c1 = crashedCritical()[0] ?? "";
    const c2 = "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json";
    const comb = [c1, c2].filter(Boolean);
    const t = doc.tierDoctorIssues(comb);
    const brief = formatDoctorBrief("run-x", {
      healthy: t.healthy,
      bun_version: "1.3.14",
      bun_supported: true,
      gitignored: true,
      issues: comb,
      critical_issues: t.criticalIssues,
      cosmetic_issues: t.cosmeticIssues,
    });
    expect(brief).toContain("- **Healthy**: no");
    expect(brief).toContain(`  - ${c1}`);
    expect(brief).toContain(`  - ${c2}`);
    expect(brief.indexOf("- **Critical Issues**:")).toBeLessThan(brief.indexOf("- **Notices**"));
  });

  test("a cosmetic-only integrity issue does not suppress computation of a real critical finding via runDoctor", async () => {
    setupVirtualFs();
    const runRoot = initTestRun("tiering-mask");
    transact(runRoot, "mind-gen-1", "pulse-recorded", {}, (state) => {
      state.pulse = { last: { outcome: "crashed", terminal_reason: "crashed" } };
    });
    vfs.writeFileSync(join(runRoot, "random-extra-file.txt"), "cosmetic noise");

    const report = await doc.runDoctor(runRoot);
    expect(
      !report.healthy &&
        (report.critical_issues as string[]).some((i) =>
          i.includes("tier-confinement [critical]"),
        ) &&
        (report.cosmetic_issues as string[]).some((i) => i.startsWith("LAYOUT_UNDECLARED")),
    ).toBe(true);
  });
});
