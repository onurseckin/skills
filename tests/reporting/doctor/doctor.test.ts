import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  ignoredByGit,
  runDoctor,
  versionAtLeast,
  formatDoctorReport,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

const exitCode =
  (status: number, stdout = "") =>
  () => ({
    status,
    bytes: Buffer.from(stdout),
  });
const throwingGitCommand = () => {
  throw new Error("git exec failure");
};

export const doctorSuiteName = "doctor diagnostics and gitignore policy";

describe(doctorSuiteName, () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("versionAtLeast checks semver ordering", () => {
    expect(versionAtLeast("1.3.14", "1.2.0")).toBe(true);
    expect(versionAtLeast("1.2.0", "1.2.0")).toBe(true);
    expect(versionAtLeast("1.1.0", "1.2.0")).toBe(false);
    expect(versionAtLeast("2.0.0", "1.9.9")).toBe(true);
    expect(versionAtLeast("1.0.0", "2.0.0")).toBe(false);
  });

  test("ignoredByGit answers true, false, or unknown and never guesses", () => {
    const repo = tempDir("harness-git-doc");
    const runRoot = join(repo, ".olt", "capsules", "run-1");

    // Nothing to ask: the directory is not a repository.
    expect(ignoredByGit(runRoot)).toBeNull();

    fs.mkdirSync(join(repo, ".git"), { recursive: true });
    expect(ignoredByGit(runRoot, exitCode(0))).toBe(true);
    expect(ignoredByGit(runRoot, exitCode(1))).toBe(false);

    // A probe that could not run is unknown, not "tracked".
    expect(ignoredByGit(runRoot, throwingGitCommand)).toBeNull();
  });

  test("formatDoctorReport formats healthy and unhealthly states with markdown", () => {
    const healthyReport = formatDoctorReport({
      runRoot: "/repo/.capsules/run-ok",
      healthy: true,
      bunVersion: "1.3.14",
      bunSupported: true,
      gitignored: true,
      issues: [],
    });
    expect(healthyReport).toContain("**Healthy**: yes");
    expect(healthyReport).toContain("**Gitignored**: yes");
    expect(healthyReport).toContain("**Issues**: none");

    const unhealthyReport = formatDoctorReport({
      runRoot: "/repo/.capsules/run-fail",
      healthy: false,
      bunVersion: "1.0.0",
      bunSupported: false,
      gitignored: false,
      issues: ["Broken integrity", "Corrupted state"],
      tierConfinementFindings: [
        {
          agent_id: "coord-1",
          role: "coordinator",
          tier: 2,
          violation_type: "coordinator_code_writing",
          severity: "critical",
          observation: "Coordinator edited source",
          remediation: "Revert edits",
        },
      ],
    });
    expect(unhealthyReport).toContain("**Healthy**: no");
    expect(unhealthyReport).toContain("**Gitignored**: no");
    expect(unhealthyReport).toContain("Broken integrity");
  });

  test("runDoctor collects command, packet, workflow, and git diff issues", async () => {
    const repo = tempDir("harness-doc-full");
    fs.mkdirSync(join(repo, ".git"), { recursive: true });

    const runRoot = initRun(
      repo,
      "doc-run",
      new TextEncoder().encode("Doctor prompt"),
      "file",
      true,
    );

    transact(runRoot, "planner", "plan-applied", {}, (state) => {
      state.graph = { revision: 1, gates: [] };
      state.requirements = {
        requirements: [{ id: "R-1", status: "planned", evidence: [] }],
      };
      state.tasks = {
        "task-1": {
          id: "task-1",
          status: "proposed",
          requirement_ids: ["R-1"],
          dependencies: [],
          write_scope: ["src/**"],
          history: [],
          repair_round: 0,
        },
      };
      state.commands = {
        "C-1": {
          id: "C-1",
          actor: "worker",
          status: "succeeded",
          task_id: "task-1",
          exit_code: 0,
          fingerprint: "fp-1",
          logs: {
            stdout: { path: "logs/stdout.txt", sha256: "0".repeat(64) },
          },
        },
      };
    });

    const diffGitCommand = exitCode(0, "src/foo.ts\nsrc/bar.ts\n");
    const report = await runDoctor(runRoot, {}, diffGitCommand);
    expect(report.healthy).toBe(false);
    expect(report.run_root).toBe(runRoot);
    expect(report.bun_supported).toBe(true);
    expect(Array.isArray(report.command_issues)).toBe(true);
    expect(Array.isArray(report.workflow_issues)).toBe(true);
    expect(report.workflow_issues).toContain("task task-1 is proposed, not done");
  });

  test("runDoctor handles corrupted run directory where loadRun fails", async () => {
    const repo = tempDir("harness-doc-corrupted");
    const runRoot = join(repo, ".capsules", "empty-nonexistent");

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  test("runDoctor handles options.installation status check", async () => {
    const repo = tempDir("harness-doc-install");
    const runRoot = initRun(
      repo,
      "install-run",
      new TextEncoder().encode("Doctor prompt"),
      "file",
      true,
    );

    fs.writeFileSync(join(repo, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n", "utf-8");
    fs.mkdirSync(join(repo, "scripts", "src", "core", "config"), { recursive: true });
    fs.writeFileSync(
      join(repo, "scripts", "package.json"),
      JSON.stringify({ name: "@local/olt-runtime" }),
      "utf-8",
    );
    fs.writeFileSync(
      join(repo, "scripts", "src", "core", "config", "contracts.ts"),
      'export const RUNTIME_VERSION = "0.2.0";\n',
      "utf-8",
    );
    const report = await runDoctor(runRoot, {
      installation: {
        source: repo,
        home: repo,
        clients: ["claude-code"],
      },
    });

    expect(report.run_root).toBe(runRoot);
    expect(Array.isArray(report.installation_issues)).toBe(true);
  });

  test("runDoctor flags run capsule when not gitignored", async () => {
    const repo = tempDir("harness-doc-unignored");
    fs.mkdirSync(join(repo, ".git"), { recursive: true });
    const runRoot = initRun(
      repo,
      "unignored-run",
      new TextEncoder().encode("Doctor prompt"),
      "file",
      true,
    );
    const report = await runDoctor(runRoot, {}, exitCode(1));
    expect(report.gitignored).toBe(false);
    expect(report.issues).toContain("run capsule is not gitignored");
  });

  test("runDoctor reports an unanswerable gitignore probe as unknown, not as a violation", async () => {
    const repo = tempDir("harness-doc-unknown-ignore");
    fs.mkdirSync(join(repo, ".git"), { recursive: true });
    const runRoot = initRun(
      repo,
      "unknown-ignore-run",
      new TextEncoder().encode("Doctor prompt"),
      "file",
      true,
    );
    const report = await runDoctor(runRoot, {}, throwingGitCommand);
    expect(report.gitignored).toBeNull();
    expect(report.issues).not.toContain("run capsule is not gitignored");
  });

  test("runDoctor evaluates Socratic Reflexive Self-Questioning Engine diagnostics", async () => {
    const repo = tempDir("harness-doc-socratic");
    const runRoot = initRun(
      repo,
      "socratic-run",
      new TextEncoder().encode("Doctor prompt with Socratic verification"),
      "file",
      true,
    );

    const report = await runDoctor(runRoot);
    expect(report.socratic_audit).toBeDefined();
    const socraticAudit = report.socratic_audit as {
      healthy: boolean;
      questions_evaluated: number;
      dimensions: Record<string, { total: number; passed: number }>;
    };
    expect(socraticAudit.questions_evaluated).toBeGreaterThan(0);
    expect(socraticAudit.dimensions.premise_verification).toBeDefined();
    expect(socraticAudit.dimensions.edge_case_exploration).toBeDefined();
    expect(socraticAudit.dimensions.failure_mode_analysis).toBeDefined();
    expect(socraticAudit.dimensions.hierarchy_invariant_preservation).toBeDefined();
    expect(socraticAudit.dimensions.quantitative_empirical_proof).toBeDefined();

    expect(typeof report.markdown).toBe("string");
    expect(report.markdown as string).toContain("### Socratic Reflexive Self-Questioning Engine");
  });
});
