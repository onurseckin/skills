import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ignoredByGit,
  runDoctor,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/doctor.ts";
import { initRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

const exitCode = (status: number) => () => ({ status, bytes: Buffer.alloc(0) });
const throwingGitCommand = () => {
  throw new Error("git exec failure");
};

describe("doctor diagnostics and gitignore policy", () => {
  test("ignoredByGit answers true, false, or unknown and never guesses", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-git-doc-"));
    roots.push(repo);
    const runRoot = join(repo, ".capsules", "run-1");

    // Nothing to ask: the directory is not a repository.
    expect(ignoredByGit(runRoot)).toBeNull();

    await mkdir(join(repo, ".git"));
    expect(ignoredByGit(runRoot, exitCode(0))).toBe(true);
    expect(ignoredByGit(runRoot, exitCode(1))).toBe(false);

    // A probe that could not run is unknown, not "tracked".
    expect(ignoredByGit(runRoot, throwingGitCommand)).toBeNull();
  });

  test("runDoctor collects command, packet, and workflow issues", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doc-full-"));
    roots.push(repo);
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

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(report.run_root).toBe(runRoot);
    expect(report.bun_supported).toBe(true);
    expect(Array.isArray(report.command_issues)).toBe(true);
    expect(Array.isArray(report.workflow_issues)).toBe(true);
    expect(report.workflow_issues).toContain("task task-1 is proposed, not done");
  });

  test("runDoctor flags run capsule when not gitignored", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doc-unignored-"));
    roots.push(repo);
    // A `.git` entry present, and an injected probe answering "not ignored" the way a fresh
    // repository with no matching gitignore rule would.
    await mkdir(join(repo, ".git"));
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
    const repo = await mkdtemp(join(tmpdir(), "harness-doc-unknown-ignore-"));
    roots.push(repo);
    // A `.git` entry the probe cannot read: present enough to be asked, broken enough to fail.
    await mkdir(join(repo, ".git"));
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
    const repo = await mkdtemp(join(tmpdir(), "harness-doc-socratic-"));
    roots.push(repo);
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
