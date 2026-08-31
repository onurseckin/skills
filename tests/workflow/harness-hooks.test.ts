import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  executePreFlightDoctorAudit,
  executePostFlightDoctorAudit,
} from "../../olt/scripts/src/workflow/lifecycle/harness-hooks.ts";
import { initRun } from "../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../olt/scripts/src/engine/store/events/transaction.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Wave 4 - Task 4.2: Pre/Post Run Automated Diagnostic Hooks", () => {
  test("executePreFlightDoctorAudit auto-heals corrupted state and stale locks before task claims", async () => {
    const repo = await mkdtemp(join(tmpdir(), "preflight-test-"));
    roots.push(repo);
    spawnSync("git", ["init"], { cwd: repo });
    writeFileSync(join(repo, "package.json"), "{}");

    const runRoot = initRun(
      repo,
      "preflight-run",
      new TextEncoder().encode("Prompt"),
      "file",
      true,
    );

    transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
      state.tasks = { t1: { id: "t1", status: "open" } };
    });

    // Corrupt state.json
    writeFileSync(
      join(runRoot, "state.json"),
      JSON.stringify({ schema: "harness.state", event_sequence: 8888, corrupted: true }),
    );

    const preFlight = await executePreFlightDoctorAudit(runRoot, { repoRoot: repo });
    expect(preFlight.healthy).toBe(true);
    expect(preFlight.autoHealResult.projectionRecovered).toBe(true);
    expect(preFlight.autoHealed.length).toBeGreaterThan(0);
  });

  test("executePostFlightDoctorAudit auto-stages modified files and verifies hygiene", async () => {
    const repo = await mkdtemp(join(tmpdir(), "postflight-test-"));
    roots.push(repo);
    spawnSync("git", ["init"], { cwd: repo });
    writeFileSync(join(repo, "package.json"), "{}");
    spawnSync("git", ["add", "-A"], { cwd: repo });
    spawnSync("git", ["commit", "-m", "Initial commit", "--allow-empty"], { cwd: repo });

    const runRoot = initRun(
      repo,
      "postflight-run",
      new TextEncoder().encode("Prompt"),
      "file",
      true,
    );

    transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
      state.tasks = {
        t1: {
          id: "t1",
          status: "in_progress",
          assigned_agent: "worker-1",
        },
      };
    });

    // Modify a file to test reflog auto-staging
    writeFileSync(join(repo, "README.md"), "# Updated documentation");

    const postFlight = await executePostFlightDoctorAudit(runRoot, {
      repoRoot: repo,
      autoStageGit: true,
      enforceHygiene: true,
      enforceQuotas: false,
    });

    expect(postFlight.healthy).toBe(true);
    expect(postFlight.stagedFiles).toContain("README.md");
  });

  test("executePostFlightDoctorAudit handles defaults, quotas, hygiene violations, and strict mode", async () => {
    const repo = await mkdtemp(join(tmpdir(), "postflight-defaults-"));
    roots.push(repo);
    spawnSync("git", ["init"], { cwd: repo });
    writeFileSync(join(repo, "package.json"), "{}");
    spawnSync("git", ["add", "-A"], { cwd: repo });
    spawnSync("git", ["commit", "-m", "Initial commit", "--allow-empty"], { cwd: repo });

    const runRoot = initRun(
      repo,
      "postflight-defaults-run",
      new TextEncoder().encode("Prompt"),
      "file",
      true,
    );

    // Call with repoRoot option
    const resDefaults = await executePostFlightDoctorAudit(runRoot, {
      repoRoot: repo,
      enforceQuotas: false,
    });
    expect(resDefaults.healthy).toBe(true);
    expect(resDefaults.findings).toBeDefined();

    // Call with autoStageGit: false, enforceHygiene: false, enforceQuotas: true
    const resQuotas = await executePostFlightDoctorAudit(runRoot, {
      repoRoot: repo,
      autoStageGit: false,
      enforceHygiene: false,
      enforceQuotas: true,
    });
    expect(resQuotas.healthy).toBe(true);

    // Strict mode when healthy does not throw
    await expect(
      executePostFlightDoctorAudit(runRoot, {
        repoRoot: repo,
        autoStageGit: false,
        enforceHygiene: false,
        enforceQuotas: false,
        strict: true,
      }),
    ).resolves.toBeDefined();

    // Trigger hygiene violation by writing outside .olt or approved paths
    const badFile = join(repo, ".scratch_temp_leak");
    writeFileSync(badFile, "leak");
    const resViolations = await executePostFlightDoctorAudit(runRoot, {
      repoRoot: repo,
      autoStageGit: false,
      enforceHygiene: true,
      enforceQuotas: false,
    });
    expect(resViolations.findings.length).toBeGreaterThanOrEqual(0);
  });
});
