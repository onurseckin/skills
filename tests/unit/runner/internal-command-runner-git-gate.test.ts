import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInternalCommandRunner } from "../../../olt/scripts/src/runner/internal-command-runner.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("internal command runner git-gate policy", () => {
  test("rejects an unrestricted git invocation as a gate command before observing the repository", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "internal-runner-git-gate-"));
    roots.push(repositoryRoot);
    const runRoot = join(repositoryRoot, ".olt", "capsules");
    await mkdir(runRoot, { recursive: true });
    const commandDir = join(runRoot, "commands");
    let observed = false;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        observed = true;
        throw new Error("must not observe the repository for a rejected gate command");
      },
      attempt: async () => {
        throw new Error("must not run");
      },
    });

    await expect(
      runner.prepareCommand({
        argv: ["git", "status"],
        cwd: repositoryRoot,
        repositoryRoot,
        runRoot,
        commandDir,
        actor: "validator",
        gateId: "G-git-status",
      }),
    ).rejects.toThrow("gate command is not an accepted verification command");
    expect(observed).toBeFalse();
  });

  test("still accepts the same argv as a non-gate command", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "internal-runner-git-non-gate-"));
    roots.push(repositoryRoot);
    const runRoot = join(repositoryRoot, ".olt", "capsules");
    await mkdir(runRoot, { recursive: true });
    const commandDir = join(runRoot, "commands");
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        throw new Error("must not observe for a non-gate command");
      },
      attempt: async () => {
        throw new Error("must not run");
      },
    });

    const prepared = await runner.prepareCommand({
      argv: ["git", "status"],
      cwd: repositoryRoot,
      repositoryRoot,
      runRoot,
      commandDir,
      actor: "validator",
    });
    expect(prepared.record.gate_id).toBeNull();
  });
});
