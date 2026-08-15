import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("doctor diagnostics and gitignore policy", () => {
  test("ignoredByGit returns null without .git and handles success, non-zero, and exceptions", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-git-doc-"));
    roots.push(repo);
    const runRoot = join(repo, ".capsules", "run-1");

    // No .git directory -> returns null
    expect(ignoredByGit(runRoot)).toBeNull();

    // With .git directory
    await mkdir(join(repo, ".git"));
    const mockSuccess = () => ({ status: 0, stdout: "", stderr: "" });
    expect(ignoredByGit(runRoot, mockSuccess)).toBe(true);

    const mockFailure = () => ({ status: 1, stdout: "", stderr: "" });
    expect(ignoredByGit(runRoot, mockFailure)).toBe(false);

    const mockThrow = () => {
      throw new Error("git exec failure");
    };
    expect(ignoredByGit(runRoot, mockThrow)).toBe(false);
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
    await mkdir(join(repo, ".git"));
    const runRoot = initRun(
      repo,
      "unignored-run",
      new TextEncoder().encode("Doctor prompt"),
      "file",
      true,
    );
    const report = await runDoctor(runRoot);
    expect(report.gitignored).toBe(false);
    expect(report.issues).toContain("run capsule is not gitignored");
  });
});
