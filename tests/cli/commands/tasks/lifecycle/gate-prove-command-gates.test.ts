import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerSessionGrant,
  revokeSessionGrant,
} from "../../../../../olt/scripts/src/authority/session/index.ts";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { isJsonObject } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

function clearCallerSession(run?: string, agentId = "worker-1"): void {
  try {
    revokeSessionGrant({ runRoot: run, agentId, pid: process.pid, ppid: process.ppid });
  } catch {
    // Ignore when running under VFS
  }
}

beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
  clearCallerSession();
});

afterEach(async () => {
  disableInMemoryAgentMetadata();
  clearCallerSession();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

function git(repo: string, argv: readonly string[]): void {
  spawnSync("git", [...argv], { cwd: repo });
}

async function compiledSingleTaskRun(
  name: string,
  gate: string,
): Promise<{ repo: string; run: string }> {
  setupVirtualCliFS();
  const repo = `/virtual/cli/gate-prove-cmd-${name}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".olt/capsules/\nprompt.txt\n");
  writeFileSync(join(repo, "README.md"), "hi\n");

  writeFileSync(join(repo, "prompt.txt"), "Add a feature file.\n");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run-id",
    name,
    "--prompt-file",
    join(repo, "prompt.txt"),
  ]);
  const run = String(init.run_root);
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-1",
    "--label",
    "Add feature file",
    "--scope",
    "feature.ts",
    "--gate",
    gate,
    "--actor",
    "planner",
  ]);
  await execute(["plan:brainstorm", "--run", run, "--actor", "coordinator"]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "coordinator",
    "--completion-gate",
    "bun test tests",
  ]);
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    "coordinator",
    "--role",
    "coordinator",
    "--host",
    "antigravity",
  ]);
  return { repo, run };
}

describe("gate:prove - Gate Bindings, Policies and Options", () => {
  test("defaults --base to sha task:claim recorded, not HEAD, once work landed", async () => {
    const { repo, run } = await compiledSingleTaskRun("claimed-base", "test -f feature.ts");
    const shaAtClaim = String(
      spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      }).stdout,
    ).trim();

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
      "--parent-agent",
      "coordinator",
      "--actor",
      "coordinator",
    ]);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    registerSessionGrant({
      runRoot: run,
      agentId: "coordinator",
      role: "coordinator",
      host: "antigravity",
    });

    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--quiet", "-m", "feature landed"]);

    const result = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect(result.base).toBe(shaAtClaim);
    expect(result.falsifiable).toBe(true);
  });

  test("accepts explicit --base ref and integer --timeout-ms / --max-files", async () => {
    const { repo, run } = await compiledSingleTaskRun("explicit-base", "test -f feature.ts");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const result = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
      "--base",
      "HEAD",
      "--timeout-ms",
      "60000",
      "--max-files",
      "10000",
    ]);
    expect(result.base).toBe("HEAD");
    expect(result.falsifiable).toBe(true);
  });

  test("refuses to spawn compiled gate that fails gate-command-policy re-check at execution time", async () => {
    const { repo, run } = await compiledSingleTaskRun("policy-escape", "test -f feature.ts");
    const marker = join(repo, "policy-escape-marker.txt");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");

    transact(run, "coordinator", "test-corrupt-compiled-gate", {}, (draft) => {
      if (!isJsonObject(draft.graph) || !Array.isArray(draft.graph.gates)) {
        throw new Error("expected draft.graph.gates to be an array");
      }
      draft.graph.gates = draft.graph.gates.map((gate) =>
        isJsonObject(gate) && gate.id === "gate-1"
          ? { ...gate, command: ["bash", "-c", `: > ${JSON.stringify(marker)}`] }
          : gate,
      );
    });

    await expect(
      execute(["gate:prove", "--run", run, "--task", "task-1", "--actor", "coordinator"]),
    ).rejects.toThrow(/fails the gate-command-policy re-check/);
    expect(existsSync(marker)).toBe(false);
  });

  test("refuses an --actor with no registered grant", async () => {
    const { repo, run } = await compiledSingleTaskRun("no-grant", "test -f feature.ts");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    clearCallerSession(run, "coordinator");

    await expect(
      execute(["gate:prove", "--run", run, "--task", "task-1", "--actor", "an-unregistered-actor"]),
    ).rejects.toThrow(
      "gate:prove requires a verified caller session backed by an active run grant; explicit identity flags cannot establish authority",
    );
  });
});
